# Enabling Row-Level Security

`TENANT_RLS_ENABLED=true` is **not** a safe flag to flip on its own. This
document is the checklist that makes it safe.

## Why it is not a flag flip

RLS is the backstop for the tenancy invariant: application code filters every
query on `account_id`, and RLS turns a forgotten filter into an empty result
instead of a cross-tenant leak. That only works if the database actually has
policies. As of the 2026-08-23 audit it did not:

| Check | State found | Why it mattered |
|---|---|---|
| Policies in the live database | **0** | `enable_rls_on_all_tables()` was never called from startup or a migration |
| Tenant tables with policies defined | **4 of 69** | `api_endpoints`, `vulnerabilities`, `test_runs`, `test_accounts` only |
| `FORCE ROW LEVEL SECURITY` | **absent** | The app connects as `appsentinel`, which **owns all 74 tables**. Postgres exempts a table's owner from its policies unless FORCE is set, so every policy would have been bypassed |
| Unset-tenant behaviour | **raises** | Single-argument `current_setting` raises `undefined_object`, turning a missing tenant context into a 500 on every query |
| `SET LOCAL` placement | **outside a transaction** | Postgres warns and discards it, so the tenant was never actually set |

Turning the flag on in that state would have been either a no-op that looked
like security, or an outage. Both have since been fixed in
`server/modules/rls/row_level_security.py`, but the database still has to be
migrated before the flag means anything.

## What changed

- Policies are generated from **ORM metadata**, so every mapped table with an
  `account_id` column is covered — currently **69 tables, 690 statements** — and
  a new tenant table is covered the moment it is defined.
- Every table gets `FORCE ROW LEVEL SECURITY`.
- Policies use `NULLIF(current_setting(name, true), '')::bigint`, so an unset
  tenant yields **no rows** rather than an error.
- `apply_tenant_context` opens the transaction before `SET LOCAL`, and
  `ensure_tenant_context` re-stamps the tenant for routes that declare `db`
  before their auth dependency.
- `verify_rls_coverage()` reports which tables are genuinely protected.

## Rollout

Do this in a maintenance window, on a database you have restore-tested.

1. **Restore-test a backup first.** Do not start without a restore you have
   actually performed and timed. See the DR checklist.

2. **Apply policies on a copy.** Restore production into a scratch database and
   run `enable_rls_on_all_tables()` against it. Every table must report
   `success`; investigate any `error` rather than proceeding.

3. **Verify coverage on the copy.** `verify_rls_coverage()` must return
   `fully_covered: true`. This is the check that would have caught the 4-of-69
   state.

4. **Exercise the app against the copy** with `TENANT_RLS_ENABLED=true`. Watch
   specifically for:
   - endpoints returning empty where they should return data — a route whose
     tenant context is not being stamped;
   - background workers failing — the scheduler, ingestion queue, archiver and
     stream pipeline run **without a request-scoped tenant**, so they see no
     rows under RLS unless they set the tenant explicitly or run as a role with
     `BYPASSRLS`. Treat this as the main integration risk;
   - sensor ingest on `/v1/events`, which resolves a sensor key rather than a
     user JWT and must stamp the sensor's account.

5. **Only then** set `TENANT_RLS_ENABLED=true` in production, with the policies
   already applied by migration.

## Rollback

`disable_rls_on_all_tables()` drops the policies and clears FORCE. Setting the
flag to `false` alone does **not** remove policies — if policies are applied and
a background worker has no tenant, it will still see no rows. Roll back the
policies, not just the flag.

## Open question before step 5

Background workers are the unresolved piece. Decide deliberately between:

- giving workers an explicit per-tenant loop that stamps the tenant, or
- running them as a separate database role with `BYPASSRLS`.

The second is simpler and is the usual answer, but it means the worker role is
outside the backstop — which is fine as long as that is a decision on record
rather than an accident.
