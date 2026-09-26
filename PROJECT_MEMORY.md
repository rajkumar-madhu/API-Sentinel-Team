# API Sentinel / API Security Engine — Project Memory

Last reviewed: 2026-09-22  
Purpose: persistent context for humans and agents working in this repository.  
Full E2E guide: [`docs/PROJECT_END_TO_END.md`](docs/PROJECT_END_TO_END.md)

---

## What this project is

**API-Sentinel-Team** is a full-stack **API security platform** (branded in code as **“API Security Engine”** / AppSentinel-style). It provides:

- **API inventory** and endpoint lifecycle management  
- **Vulnerability and security testing** driven by a large **tests library** (YAML templates, remediation docs; lineage from **Akto**-style patterns)  
- **Runtime monitoring**: traffic/stream ingestion, sensors, alerts, evidence, playbooks  
- **Detection pipeline** (unified “engine” with shadow/active modes)  
- **LLM/agent-adjacent controls**: agent guard, MCP shield, agentic sessions  
- **ML-assisted detection** (scikit-learn, PyOD, anomaly-oriented workflows)  
- **Enforcement** (blocks, adaptive rate limiting, policies)  
- **Compliance / PII / governance / audit** surfaces  
- **Pentest orchestration** (profiles, Nuclei integration, safe/balanced/aggressive modes)  
- **Recon** scheduling and external findings  

North star: evidence-grade continuous API red team — see `docs/API_PENTESTING_NORTH_STAR.md`.

---

## Active working state (agents: read this first)

| Field | Value |
|-------|--------|
| **Branch** | `main` |
| **Primary docs** | `docs/PROJECT_END_TO_END.md`, this file, `AGENTS.md`, `k8s/README.md` |
| **WIP focus** | Live traffic → inventory → tests on `https://sentinel.wecrew.in/` |
| **Cluster** | kind `wecrew`, ns `api-sentinel`, Harbor `harbor.wecrew.in/finspot/api-sentinel-{backend,frontend,sensor}` |

**Live status (2026-08-16):** backend/frontend/postgres/redis Running; eBPF sensor DaemonSet `api-sentinel-sensor` Ready; LE cert Ready; `/healthz` + `/api/health/ready` OK. Sensor `wecrew-ebpf` (account_id=1) ingesting via in-cluster `POST /v1/events`. Console self-traffic (`/api/*` with blank host, `sentinel.wecrew.in`) is dropped from Live Feed.

**Shipped on this branch:**

1. Production Dockerfiles (multi-stage backend + non-root nginx frontend on `:8080`)  
2. `k8s/` manifests + secrets/build scripts + **sensor DaemonSet** (`k8s/35-sensor.yaml`)  
3. Fix: Alembic greenfield stamp uses `version_num` varchar(128) (long revision ids)  
4. Fix: `CICD_GATE_SIGNING_SECRET` required in prod secrets  
5. eBPF ingest unwraps session-4 `{MsgHeader, Batch}` envelopes on `/v1/events` and **upserts `APIEndpoint` inventory**. `request_logs.host` is persisted. OCI blob digests collapse to `{digest}`.  
6. Request-guard lookup is host-aware so duplicate catalogue rows cannot 500 every API.  
7. Ingest skips this product's own console polls so Live Feed shows cluster apps, not `/api/stream/recent`.  
8. Request logs capture client IP, user agent, and a fingerprinted client id; Live Feed, Security Events, Threat Actors, and Audit Logs show client/application detail. Tailwind surface/text/border colors map to the theme CSS variables (dark mode on legacy pages was unreadable before), and the workspace uses a layered `.app-backdrop`.  

**Recent commits:** OpenAPI drift processor + Schema Validation UI + fan-out caps; Evidence UI polish on main.

**B2B/enterprise-readiness pass (2026-09-22):**

1. Postgres RLS on by default (`TENANT_RLS_ENABLED=True`); policy coverage expanded from 4 hardcoded tables to all ~68 `account_id`-scoped tables (`server/modules/rls/row_level_security.py`, generated + idempotent), applied automatically at startup for Postgres deployments.
2. Generic OIDC and SAML 2.0 SSO added alongside the existing GitHub-only OAuth (`server/modules/auth/oauth_oidc.py`, `oauth_saml.py`; `python3-saml` dependency), configurable per tenant via `OAuthProvider.config`.
3. Custom RBAC roles: `CustomRole` model + `/api/custom-roles` CRUD, resolved by `RBAC.require_auth` alongside the fixed roles. Admin UIs for SSO and roles: `/admin/settings/sso` (IdP setup URLs, provider add/enable/remove) and `/admin/settings/roles` (permission picker); custom roles are assignable in User Management and map to the customer workspace in `auth-context.tsx`.
4. Billing: Stripe Checkout session creation (`POST /api/billing/checkout/{account_id}`) and quota enforcement (`server/modules/billing/quota.py`) against plan limits at write time; fixed a cross-tenant authorization bug in the billing router.
5. Compliance reports now cover all 7 frameworks (OWASP/GDPR/HIPAA/PCI/SOC2/NIST/EU AI Act) via `ComplianceMapper` instead of an incomplete duplicate table.
6. DSAR endpoints (`server/api/routers/privacy.py`): self-service and admin-driven data export/erasure.
7. Customer-facing integrations settings UI (`api-sentinel-view-main/src/admin/pages/settings/IntegrationsSettings.tsx`) — the backend Slack/webhook/PagerDuty/SIEM API already existed and just had no frontend.
8. Public marketing landing page at `/welcome` (`src/pages/Landing.tsx`) linking into the existing `/login` page's sign-up/sign-in toggle (now also supports `?mode=signup` to open directly in signup mode). Self-serve signup itself (`POST /api/auth/signup`) already existed on both backend and `/login` — it just had no public entry point before `/welcome`.

See `rajkumar-madhu/API-Sentinel-Team#2` for the full diff.

---

## Repository layout (high level)

| Path | Role |
|------|------|
| `server/` | Python backend (FastAPI app, routers, business logic, modules) |
| `api-sentinel-view-main/` | Frontend: **Vite + React 18 + TypeScript**, Radix/shadcn-style UI, TanStack Query, Playwright/Vitest |
| `tests-library/` | Massive catalog of security **test templates** and **remediation** markdown |
| `migrations/` | Alembic migration scripts (`versions/`, `env.py`) |
| `tests/` | `unit/`, `integration/`, `e2e/`, `security/`, `load/` (Locust), `benchmark/` |
| `docs/` | Architecture + north-star + detection engine + plans |
| `infra/` | Helm, Terraform AWS, nginx, Flink, sensor-external, K8s examples |
| `docker-compose.yml` | **Postgres 16**, **Redis 7**, **Kafka**, FastAPI |
| `Dockerfile` | Python 3.11; uvicorn; copies `server/`, `migrations/`, `tests-library/` |
| `Makefile` | Test targets: unit, integration, e2e, load, security |
| `requirements.txt` | Python dependencies |
| `api_security.db` | Local SQLite DB artifact (dev; also via `DATABASE_URL`) |

---

## Backend stack

- **Framework:** FastAPI (`server.api.main:app`)  
- **ASGI:** Uvicorn  
- **DB:** SQLAlchemy 2.x async; SQLite default locally; Postgres + `asyncpg` in compose/prod  
- **Migrations:** Alembic (`migrations/`); keep `alembic.ini` for Docker builds  
- **Cache / queue:** Redis (optional)  
- **Streaming:** Kafka + `aiokafka`; optional Flink when `STREAM_ENGINE=FLINK`  
- **Auth:** JWT, bcrypt, API keys, sensor keys (HMAC); tenant RLS on by default on Postgres. SSO: GitHub OAuth, generic OIDC, SAML 2.0 (`server/modules/auth/oauth_*.py`), plus per-account custom RBAC roles (`server/api/routers/custom_roles.py`)  
- **Rate limiting:** `slowapi` + AdaptiveRequestGuard  
- **Scheduling:** APScheduler components  
- **Logging:** `structlog`  

**Config:** `server/config.py` — key flags:

- `UNIFIED_PIPELINE_MODE`: `off` | `shadow` | `active` (compose default: **shadow**)  
- `STREAM_ENGINE`: `IN_PROCESS` | `FLINK`  
- `TESTS_LIBRARY_PATH` → `./tests-library`  
- Startup toggles: demo bootstrap, template refresh, playbooks, analytics, archiver, ingestion queue, stream pipeline  

**API prefix:** REST under **`/api`**. Sensor ingest also at `POST /v1/events` and `POST /`.

**Models:** almost everything lives in `server/models/core.py` with `account_id` tenancy.

---

## Main Python packages (`server/`)

- **`server/api/`** — `main.py`, `routers/` (~50+), websocket live feed, rate limiter  
- **`server/models/`** — ORM entities (accounts, endpoints, tests, vulns, sensors, evidence, agentic, ML, …)  
- **`server/modules/`** — Feature implementations:  
  - `ingestion/`, `streaming/`, `threat_engine/`, `detection/`, `enforcement/`  
  - `test_executor/`, `pentest/`, `nuclei/`, `schemathesis/`, `zap/`  
  - `analytics/`, `recon/`, `ml/`, `api_inventory/`, `identity/`  
  - `response/`, `storage/`, `scheduler/`, `agentic/`, `sensors/`, `auth/`, `rls/`, `tenancy/`  

---

## Detection engine (conceptual)

`docs/detection-engine/README.md`:

`source adapters → NormalizationAgent → DetectionEnvelope → RuleDetectionAgent → DetectionSignal[] → CorrelationAgent → IncidentDecision → EnforcementAgent`

**Modes:** `off` (legacy), `shadow` (observe only), `active` (unified owns alerts/evidence/enforcement).

---

## Frontend (`api-sentinel-view-main/`)

- **Vite 5**, **React 18**, **TypeScript**, Tailwind, Radix/shadcn  
- **Data:** TanStack React Query (zustand listed but unused)  
- **Workspaces:** `/app` (customer), `/admin` (org admin), `/platform` (PLATFORM_ADMIN)  
- **Public routes:** `/welcome` (marketing landing), `/login` (sign-in + self-serve sign-up toggle, `?mode=signup` opens signup mode directly)  
- **Auth:** cookie session + optional in-memory Bearer; `GET /api/auth/me` bootstrap  
- **Pattern:** pages → hooks → services → `lib/api-client.ts`  
- **Realtime:** `lib/realtime.ts` → `/api/stream/live` invalidates query namespaces  
- **UI:** GlassCard (legacy) + Evidence\* system under `.evd-root`  
- Dev commonly via Vite proxy to backend (check `vite.config.ts` port)

---

## Tests library (`tests-library/`)

- Large YAML/YML corpus + remediation markdown (OWASP API / LLM Top 10 style)  
- Loaded via WordlistManager when `STARTUP_REFRESH_TEMPLATE_LIBRARY` is true  
- Not pytest — runtime scanner input  

---

## How to run (typical)

1. **Backend:** `pip install -r requirements.txt`, `.env` from `.env.example`, `alembic upgrade head` (Postgres), `uvicorn server.api.main:app --reload --host 127.0.0.1 --port 8000`  
2. **Frontend:** `cd api-sentinel-view-main && npm install && npm run dev`  
3. **Health:** `/api/health/ready`  
4. **Compose:** FastAPI **8000**, Redis **6380**, Kafka **9092**

### eBPF sensor

- Ingest: `POST /v1/events` (`Authorization: Bearer <sensor_key>`)  
- Register Sensor in app; account_id must match  
- Ops: `infra/SENSOR-RUNBOOK.md`, `infra/sensor-external/build-and-push-sensor.sh`

---

## Testing commands (`Makefile`)

- `make test-unit` / `test-integration` / `test-e2e` / `test-security` / `test-load` / `test-all`  
- Frontend: `npm run lint`, `npm test`, `npm run test:e2e`

---

## Security / ops notes

- Production secrets: `JWT_SECRET`, `API_KEY`, `ENCRYPTION_KEY`, `SENSOR_KEY_HASH_PEPPER`, CI gate signing  
- Demo users only with DEBUG + bootstrap flags  
- Multi-tenant: `account_id` filter on every query + Postgres RLS (`TENANT_RLS_ENABLED`, on by default; no-op on SQLite)  
- Pentest: allowlist, target_guard, auth profile scopes, worker isolation  
- Do not commit `.env`, cookies, or generated DBs  

---

## Quick “what file do I touch?”

| Task | Likely location |
|------|------------------|
| New REST endpoint | `server/api/routers/<feature>.py`, register in `routers/__init__.py` |
| DB schema change | `server/models/core.py`, `migrations/versions/` |
| Detection / pipeline | `server/modules/detection/`, `threat_engine/`, `streaming/` |
| Security test template | `tests-library/` |
| Customer UI | `api-sentinel-view-main/src/customer/` |
| Admin UI | `api-sentinel-view-main/src/admin/` |
| Evidence / realtime UI | `src/components/ui/Evidence*.tsx`, `src/lib/realtime.ts`, `index.css` |
| Nuclei | `server/modules/nuclei/`, `server/api/routers/nuclei.py` |
| Env / defaults | `server/config.py`, `.env.example` |
| Sensor / deploy | `infra/` |

---

## Agent working agreements for this repo

1. Keep routers thin; put logic in `server/modules/`.  
2. Always respect `account_id` tenancy and RBAC.  
3. UI: use existing workspace routes; prefer services/hooks over raw fetch in pages.  
4. Do not invent purple/glow redesigns that fight Evidence or GlassCard systems — extend the active language.  
5. Update this file + `docs/PROJECT_END_TO_END.md` when topology or major contracts change.  
6. Prefer `/context-restore` after long gaps; checkpoints live under gstack project `api-sentinel-team`.  

---

*Working snapshot of architecture and conventions. Refreshed 2026-08-09 after full E2E analysis.*
