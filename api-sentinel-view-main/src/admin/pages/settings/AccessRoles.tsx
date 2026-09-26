import React, { useMemo, useState } from 'react';
import { ArrowLeft, Pencil, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import GlassCard from '@/components/ui/GlassCard';
import QueryError from '@/components/shared/QueryError';
import TableSkeleton from '@/components/shared/TableSkeleton';
import {
  useAccessRoles,
  useAvailablePermissions,
  useCreateAccessRole,
  useDeleteAccessRole,
  useUpdateAccessRole,
} from '@/hooks/use-access-roles';
import { toast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-client';

const FIXED_ROLES = ['ADMIN', 'SECURITY_ENGINEER', 'DEVELOPER', 'MEMBER', 'AUDITOR', 'VIEWER', 'PLATFORM_ADMIN', 'GUEST'];

const INPUT_CLASS =
  'w-full rounded-xl border border-border-subtle bg-bg-base px-4 py-3 text-sm text-text-primary outline-none transition-all focus:border-brand/30 focus:ring-1 focus:ring-brand/20';

function groupPermissions(permissions: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const perm of permissions) {
    const [resource] = perm.split(':');
    groups.set(resource, [...(groups.get(resource) ?? []), perm]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const PermissionPicker: React.FC<{
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}> = ({ available, selected, onChange }) => {
  const groups = useMemo(() => groupPermissions(available), [available]);
  const toggle = (perm: string) =>
    onChange(selected.includes(perm) ? selected.filter((p) => p !== perm) : [...selected, perm]);
  const toggleGroup = (perms: string[]) => {
    const allOn = perms.every((p) => selected.includes(p));
    onChange(allOn ? selected.filter((p) => !perms.includes(p)) : [...new Set([...selected, ...perms])]);
  };

  return (
    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
      {groups.map(([resource, perms]) => {
        const allOn = perms.every((p) => selected.includes(p));
        return (
          <div key={resource} className="rounded-xl border border-border-subtle bg-bg-base px-3 py-2.5">
            <label className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-text-primary">{resource.replace(/_/g, ' ')}</span>
              <input
                type="checkbox"
                checked={allOn}
                onChange={() => toggleGroup(perms)}
                className="h-4 w-4 rounded"
                style={{ accentColor: 'var(--brand)' }}
                aria-label={`All ${resource} permissions`}
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {perms.map((perm) => (
                <label
                  key={perm}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    selected.includes(perm)
                      ? 'border-brand/40 bg-brand/10 text-text-primary'
                      : 'border-border-subtle text-text-muted'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={selected.includes(perm)} onChange={() => toggle(perm)} />
                  {perm.split(':')[1]}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AccessRoles: React.FC = () => {
  const navigate = useNavigate();
  const { data: roles, isLoading, isError, refetch } = useAccessRoles();
  const { data: available = [] } = useAvailablePermissions();
  const createRole = useCreateAccessRole();
  const updateRole = useUpdateAccessRole();
  const deleteRole = useDeleteAccessRole();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);

  const items = roles ?? [];

  const handleCreate = async () => {
    const normalized = name.trim().toUpperCase().replace(/\s+/g, '_');
    if (!normalized) {
      toast({ title: 'Role name required', variant: 'destructive' });
      return;
    }
    if (FIXED_ROLES.includes(normalized)) {
      toast({ title: `${normalized} is a built-in role`, description: 'Pick a different name.', variant: 'destructive' });
      return;
    }
    if (permissions.length === 0) {
      toast({ title: 'Select at least one permission', variant: 'destructive' });
      return;
    }
    try {
      await createRole.mutateAsync({ name: normalized, permissions, description: description.trim() || undefined });
      toast({ title: 'Role created', description: `${normalized} can now be assigned in User & Role Administration.` });
      setName('');
      setDescription('');
      setPermissions([]);
    } catch (err) {
      toast({ title: 'Could not create role', description: apiErrorMessage(err, 'The backend rejected the role.'), variant: 'destructive' });
    }
  };

  const startEdit = (id: string, current: string[]) => {
    setEditingId(id);
    setEditPermissions(current);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (editPermissions.length === 0) {
      toast({ title: 'A role needs at least one permission', variant: 'destructive' });
      return;
    }
    try {
      await updateRole.mutateAsync({ id: editingId, payload: { permissions: editPermissions } });
      toast({ title: 'Role updated', description: 'Takes effect on each user\'s next request.' });
      setEditingId(null);
    } catch (err) {
      toast({ title: 'Update failed', description: apiErrorMessage(err, 'Could not update role.'), variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string, roleName: string) => {
    if (!window.confirm(`Delete role ${roleName}?`)) return;
    try {
      await deleteRole.mutateAsync(id);
      toast({ title: 'Role deleted' });
    } catch (err) {
      toast({ title: 'Delete failed', description: apiErrorMessage(err, 'Could not delete role.'), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-5 animate-fade-in w-full pb-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/settings')}
            className="w-9 h-9 rounded-xl border border-border-subtle bg-bg-surface flex items-center justify-center text-text-muted hover:text-text-primary hover:border-brand/20 transition-all"
            aria-label="Back to settings"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-sm font-bold text-text-primary">Custom Roles</h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              Define roles with exactly the permissions your team needs, beyond the built-in roles.
            </p>
          </div>
        </div>
        <div className="rounded-full border border-border-subtle bg-bg-elevated px-3 py-1 text-[11px] font-semibold text-text-secondary">
          {items.length} custom {items.length === 1 ? 'role' : 'roles'}
        </div>
      </div>

      {isError && <QueryError message="Failed to load custom roles" onRetry={() => refetch()} />}

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <GlassCard variant="elevated" className="p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            <UserCog size={12} />
            Create role
          </div>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="COMPLIANCE_REVIEWER" className={INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Description (optional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Read-only access to compliance and audit" className={INPUT_CLASS} />
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Permissions ({permissions.length} selected)
              </div>
              <PermissionPicker available={available} selected={permissions} onChange={setPermissions} />
            </div>
            <button
              onClick={handleCreate}
              disabled={createRole.isPending}
              className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {createRole.isPending ? 'Creating...' : 'Create role'}
            </button>
          </div>
        </GlassCard>

        <GlassCard variant="elevated" className="p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Custom roles</div>
          <div className="mt-1 text-sm font-bold text-text-primary">Assign these to users from User & Role Administration.</div>

          <div className="mt-4 space-y-3">
            {isLoading && <TableSkeleton columns={3} rows={2} />}

            {!isLoading && items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border-subtle bg-bg-base px-5 py-10 text-center">
                <ShieldCheck size={26} className="mx-auto text-text-muted" />
                <p className="mt-3 text-sm font-semibold text-text-primary">No custom roles yet</p>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">Users can still be given any of the built-in roles.</p>
              </div>
            )}

            {items.map((role) => (
              <div key={role.id} className="rounded-2xl border border-border-subtle bg-bg-base px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold text-text-primary">{role.name}</div>
                    {role.description && <div className="mt-1 text-[11px] text-text-muted">{role.description}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {editingId === role.id ? (
                      <>
                        <button
                          onClick={saveEdit}
                          disabled={updateRole.isPending}
                          className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {updateRole.isPending ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-semibold text-text-secondary"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => startEdit(role.id, role.permissions)}
                        className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-brand/20 transition-colors"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(role.id, role.name)}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  {editingId === role.id ? (
                    <PermissionPicker available={available} selected={editPermissions} onChange={setEditPermissions} />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {role.permissions.map((perm) => (
                        <span key={perm} className="rounded-full border border-border-subtle px-2 py-1 font-mono text-[11px] text-text-secondary">
                          {perm}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default AccessRoles;
