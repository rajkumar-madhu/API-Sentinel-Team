import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import GlassCard from '@/components/ui/GlassCard';
import { useCustomRoles, useTeamData } from '@/hooks/use-admin';
import { useAccessRoles } from '@/hooks/use-access-roles';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from '@/hooks/use-toast';
import { deleteUserById, inviteUser, updateUserRole } from '@/services/admin.service';

type CreateMode = 'customer' | 'admin';

const CUSTOMER_ROLES = ['DEVELOPER', 'MEMBER', 'AUDITOR', 'VIEWER'] as const;
const ADMIN_ROLES = ['SECURITY_ENGINEER', 'ADMIN'] as const;
const ALL_DISPLAY_ROLES = [...ADMIN_ROLES, ...CUSTOMER_ROLES] as const;
const FIXED_ROLES: readonly string[] = [...ALL_DISPLAY_ROLES, 'PLATFORM_ADMIN'];

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-brand/10 text-brand border-brand/20',
  SECURITY_ENGINEER: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  DEVELOPER: 'bg-green-500/10 text-green-600 border-green-500/20',
  MEMBER: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  AUDITOR: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  VIEWER: 'bg-gray-400/10 text-gray-500 border-gray-400/20',
  PLATFORM_ADMIN: 'bg-red-500/10 text-red-600 border-red-500/20',
};
const CUSTOM_ROLE_COLOR = 'bg-purple-500/10 text-purple-600 border-purple-500/20';

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_COLORS[role] || CUSTOM_ROLE_COLOR;
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${cls}`}>{role.replace('_', ' ')}</span>;
}

function accessSummary(role: string) {
  if (role === 'ADMIN' || role === 'SECURITY_ENGINEER') {
    return {
      title: 'Admin + Customer',
      detail: 'Can use admin setup screens and tenant-facing customer pages.',
    };
  }
  if (role === 'PLATFORM_ADMIN') {
    return {
      title: 'Platform',
      detail: 'Internal-only control-plane access.',
    };
  }
  if (!FIXED_ROLES.includes(role)) {
    return {
      title: 'Custom Role',
      detail: 'Customer workspace, limited to the permissions defined for this role.',
    };
  }
  return {
    title: 'Customer Only',
    detail: 'Restricted to the customer workspace under /app.',
  };
}

const UserManagement: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { data: teamData, isLoading: teamLoading } = useTeamData();
  const { data: rolesData, isLoading: rolesLoading } = useCustomRoles();
  const { data: accessRoles } = useAccessRoles();

  const [showInvite, setShowInvite] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('customer');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('MEMBER');
  const [inviting, setInviting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);

  const users = teamData?.users ?? [];
  const pendingInvites = teamData?.pendingInvitees ?? [];
  const roles = rolesData?.customRoles ?? [];
  const adminUsers = users.filter((user) => ADMIN_ROLES.includes(user.role as typeof ADMIN_ROLES[number]));
  // Tenant-defined custom roles live in the customer workspace alongside the fixed customer roles.
  const customerUsers = users.filter((user) => !FIXED_ROLES.includes(user.role) || CUSTOMER_ROLES.includes(user.role as typeof CUSTOMER_ROLES[number]));
  const customRoleNames = useMemo(() => (accessRoles ?? []).map((role) => role.name), [accessRoles]);

  const roleOptions = useMemo(
    () => (createMode === 'customer' ? [...CUSTOMER_ROLES, ...customRoleNames] : [...ADMIN_ROLES]),
    [createMode, customRoleNames],
  );

  // Keep the user's current role selectable even if it is not (or no longer) in the list.
  const assignableRoles = (current: string) => [...new Set([...ALL_DISPLAY_ROLES, ...customRoleNames, current])];

  const openCreateModal = (mode: CreateMode) => {
    setCreateMode(mode);
    setInviteRole(mode === 'customer' ? 'MEMBER' : 'SECURITY_ENGINEER');
    setInviteEmail('');
    setInviteName('');
    setTempPassword(null);
    setCreatedEmail(null);
    setCopied(false);
    setShowInvite(true);
  };

  const resetInviteModal = () => {
    setShowInvite(false);
    setInviteEmail('');
    setInviteName('');
    setInviteRole('MEMBER');
    setTempPassword(null);
    setCreatedEmail(null);
    setCopied(false);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await inviteUser({
        email: inviteEmail.trim(),
        role: inviteRole,
        name: inviteName.trim(),
      });
      setTempPassword(res.temp_password);
      setCreatedEmail(res.email);
      qc.invalidateQueries({ queryKey: ['admin', 'team'] });
      toast({
        title: `${createMode === 'customer' ? 'Customer' : 'Admin'} user created`,
        description: `${res.email} can now sign in with the temporary password.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create user';
      toast({ title: 'Create user failed', description: msg, variant: 'destructive' });
    } finally {
      setInviting(false);
    }
  };

  const handleCopyCredentials = async () => {
    if (!tempPassword || !createdEmail) return;
    const loginUrl = `${window.location.origin}/login`;
    await navigator.clipboard.writeText(`Email: ${createdEmail}\nTemporary password: ${tempPassword}\nLogin: ${loginUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemove = async (userId: string, email: string) => {
    if (!confirm(`Remove user ${email}?`)) return;
    setRemovingId(userId);
    try {
      await deleteUserById(userId);
      qc.invalidateQueries({ queryKey: ['admin', 'team'] });
      toast({ title: 'User removed', description: `${email} has been removed from the organization.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove user';
      toast({ title: 'Remove failed', description: msg, variant: 'destructive' });
    } finally {
      setRemovingId(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateUserRole(userId, newRole);
      qc.invalidateQueries({ queryKey: ['admin', 'team'] });
      toast({ title: 'Role updated', description: `User role changed to ${newRole.replace('_', ' ')}.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update role';
      toast({ title: 'Role update failed', description: msg, variant: 'destructive' });
    } finally {
      setEditingRole(null);
    }
  };

  const creationSummary = accessSummary(inviteRole);

  return (
    <div className="mx-auto max-w-6xl space-y-5 animate-fade-in pb-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/settings')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface text-text-muted transition-all hover:text-text-primary hover:border-brand/20"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-sm font-bold text-text-primary">User & Workspace Access</h2>
            <p className="text-[11px] text-text-muted">Create customer users, tenant admins, and manage role-based workspace access.</p>
          </div>
        </div>
        <button
          data-testid="create-customer-user"
          onClick={() => openCreateModal('customer')}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand/90"
        >
          <UserPlus size={14} />
          Create Customer User
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {[
          { label: 'Total users', value: users.length, detail: 'Active accounts in this tenant' },
          { label: 'Customer users', value: customerUsers.length, detail: 'Customer-workspace only roles' },
          { label: 'Admin users', value: adminUsers.length, detail: 'Admin + customer access roles' },
          { label: 'Pending invites', value: pendingInvites.length, detail: 'Outstanding invite records' },
        ].map((item) => (
          <GlassCard key={item.label} variant="elevated" className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{item.label}</div>
            <div className="mt-2 text-2xl font-bold text-text-primary">{item.value}</div>
            <div className="mt-1 text-[11px] leading-5 text-text-muted">{item.detail}</div>
          </GlassCard>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard variant="elevated" className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Customer Workspace Access</div>
              <h3 className="mt-1 text-sm font-bold text-text-primary">Create customer-only tenant users</h3>
            </div>
            <Users size={18} className="text-brand" />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-text-muted">
            Use these roles for engineers, members, auditors, and viewers who should stay in the customer workspace under <span className="font-mono">/app</span>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {CUSTOMER_ROLES.map((role) => <RoleBadge key={role} role={role} />)}
          </div>
          <button
            data-testid="quick-create-customer-user"
            onClick={() => openCreateModal('customer')}
            className="mt-5 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-dark"
          >
            Create Customer User
          </button>
        </GlassCard>

        <GlassCard variant="elevated" className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Admin Workspace Access</div>
              <h3 className="mt-1 text-sm font-bold text-text-primary">Create tenant operators and admins</h3>
            </div>
            <Shield size={18} className="text-brand" />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-text-muted">
            These roles can operate both the org-admin workspace under <span className="font-mono">/admin</span> and the customer workspace under <span className="font-mono">/app</span>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ADMIN_ROLES.map((role) => <RoleBadge key={role} role={role} />)}
          </div>
          <button
            data-testid="create-admin-user"
            onClick={() => openCreateModal('admin')}
            className="mt-5 w-full rounded-xl border border-border-subtle bg-bg-base px-4 py-3 text-sm font-bold text-text-primary transition-colors hover:border-brand/20 hover:bg-brand/5"
          >
            Create Admin User
          </button>
        </GlassCard>
      </div>

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={resetInviteModal} />
          <div className="relative w-full max-w-lg rounded-xl border border-border-subtle bg-bg-surface p-5 shadow-2xl animate-scale-in">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Create User</div>
                <h3 className="mt-1 text-sm font-bold text-text-primary">
                  {tempPassword ? 'User Created Successfully' : createMode === 'customer' ? 'Create Customer User' : 'Create Admin User'}
                </h3>
              </div>
              {!tempPassword && (
                <div className="inline-flex rounded-full border border-border-subtle bg-bg-base p-1">
                  {(['customer', 'admin'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setCreateMode(mode);
                        setInviteRole(mode === 'customer' ? 'MEMBER' : 'SECURITY_ENGINEER');
                      }}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                        createMode === mode ? 'bg-brand text-white' : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {mode === 'customer' ? 'Customer' : 'Admin'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tempPassword ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4">
                  <div className="text-sm font-semibold text-emerald-700">{createdEmail}</div>
                  <div className="mt-1 text-[11px] text-emerald-800/80">{accessSummary(inviteRole).title}</div>
                </div>
                <div className="rounded-xl border border-border-subtle bg-bg-base px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Temporary password</div>
                  <div data-testid="temp-password" className="mt-2 font-mono text-sm text-text-primary break-all">{tempPassword}</div>
                </div>
                <div className="rounded-xl border border-border-subtle bg-bg-base px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Login</div>
                  <div className="mt-2 text-sm text-text-primary">{`${window.location.origin}/login`}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    data-testid="copy-user-credentials"
                    onClick={() => void handleCopyCredentials()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border-subtle px-3 py-2.5 text-xs font-semibold text-text-primary transition-colors hover:border-brand/20 hover:bg-brand/5"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy credentials'}
                  </button>
                  <button
                    onClick={resetInviteModal}
                    className="flex-1 rounded-lg bg-brand px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand/90"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Email *</label>
                    <input
                      data-testid="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="user@company.com"
                      className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-base px-3 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-brand/40"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Display name</label>
                    <input
                      data-testid="invite-name"
                      type="text"
                      value={inviteName}
                      onChange={(event) => setInviteName(event.target.value)}
                      placeholder="Optional"
                      className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-base px-3 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-brand/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Role</label>
                  <select
                    data-testid="invite-role"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-base px-3 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-brand/40"
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  {createMode === 'customer' && (
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      Need a tailored permission set?{' '}
                      <button
                        type="button"
                        onClick={() => navigate('/admin/settings/roles')}
                        className="font-semibold text-brand hover:underline"
                      >
                        Create a custom role
                      </button>
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-border-subtle bg-bg-base px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Workspace access</div>
                      <div data-testid="invite-workspace-summary" className="mt-1 text-sm font-bold text-text-primary">
                        {creationSummary.title}
                      </div>
                    </div>
                    <RoleBadge role={inviteRole} />
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-text-muted">{creationSummary.detail}</div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={resetInviteModal}
                    className="flex-1 rounded-lg border border-border-subtle px-3 py-2.5 text-xs font-semibold text-text-muted transition-colors hover:bg-bg-elevated"
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="submit-invite-user"
                    onClick={handleInvite}
                    disabled={!inviteEmail.trim() || inviting}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
                  >
                    {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    {inviting ? 'Creating...' : `Create ${createMode === 'customer' ? 'Customer' : 'Admin'} User`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
        <div className="flex items-center gap-2 border-b border-border-subtle p-3">
          <Users size={14} className="text-brand" />
          <span className="text-xs font-bold text-text-primary">Organization Users</span>
          <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[11px] text-text-muted">{users.length}</span>
        </div>
        {teamLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
          </div>
        ) : users.length === 0 ? (
          <div className="py-10 text-center text-xs text-text-muted">No users yet. Create the first customer or admin user above.</div>
        ) : isMobile ? (
          <div className="divide-y divide-border-subtle">
            {users.map((user) => {
              const access = accessSummary(user.role);
              return (
                <div key={user.id} className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-text-primary">{user.name || user.login}</div>
                      <div className="text-[11px] text-text-muted">{user.login}</div>
                    </div>
                    <RoleBadge role={user.role} />
                  </div>
                  <div className="text-[11px] text-text-muted">{access.title} · {access.detail}</div>
                  <div className="flex items-center gap-2">
                    <select
                      value={user.role}
                      onChange={(event) => void handleRoleChange(user.id, event.target.value)}
                      className="flex-1 rounded-lg border border-border-subtle bg-bg-base px-3 py-2 text-[11px] text-text-primary"
                    >
                      {assignableRoles(user.role).map((role) => (
                        <option key={role} value={role}>
                          {role.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void handleRemove(user.id, user.login)}
                      disabled={removingId === user.id}
                      className="rounded-md p-2 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      {removingId === user.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-base/50">
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">User</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Role</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Workspace Access</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Joined</th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {users.map((user) => {
                  const access = accessSummary(user.role);
                  return (
                    <tr key={user.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-text-primary">{user.name || user.login}</div>
                          <div className="truncate text-[11px] text-text-muted">{user.login}</div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {editingRole === user.id ? (
                          <select
                            autoFocus
                            value={user.role}
                            onChange={(event) => void handleRoleChange(user.id, event.target.value)}
                            onBlur={() => setEditingRole(null)}
                            className="rounded border border-brand/30 bg-bg-base px-2 py-1 text-[11px] text-text-primary outline-none"
                          >
                            {assignableRoles(user.role).map((role) => (
                              <option key={role} value={role}>
                                {role.replace('_', ' ')}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button onClick={() => setEditingRole(user.id)} className="transition-opacity hover:opacity-80">
                            <RoleBadge role={user.role} />
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-xs font-semibold text-text-primary">{access.title}</div>
                        <div className="mt-1 text-[11px] text-text-muted">{access.detail}</div>
                      </td>
                      <td className="px-5 py-3 text-[11px] text-text-muted">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => void handleRemove(user.id, user.login)}
                          disabled={removingId === user.id}
                          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                        >
                          {removingId === user.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendingInvites.length > 0 && (
        <GlassCard variant="default" className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border-subtle p-3">
            <Shield size={14} className="text-brand" />
            <span className="text-xs font-bold text-text-primary">Pending Invitations</span>
            <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[11px] text-text-muted">{pendingInvites.length}</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {pendingInvites.map((email) => (
              <div key={email} className="px-5 py-3 text-xs font-mono text-text-muted">{email}</div>
            ))}
          </div>
        </GlassCard>
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
        <div className="flex items-center gap-2 border-b border-border-subtle p-3">
          <Shield size={14} className="text-brand" />
          <span className="text-xs font-bold text-text-primary">Available Roles</span>
          <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[11px] text-text-muted">{roles.length + (accessRoles?.length ?? 0)}</span>
          <button
            onClick={() => navigate('/admin/settings/roles')}
            className="ml-auto text-[11px] font-semibold text-brand hover:underline"
          >
            Manage custom roles
          </button>
        </div>
        {rolesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
          </div>
        ) : roles.length === 0 && !accessRoles?.length ? (
          <div className="py-10 text-center text-xs text-text-muted">No roles defined.</div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {roles.map((role) => (
              <div key={role.name} className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <RoleBadge role={role.name} />
                  {role.baseRole && <span className="text-[11px] text-text-muted">Base: {role.baseRole}</span>}
                </div>
                <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
                  {role.apiCollectionIds?.length ?? 0} collections
                </span>
              </div>
            ))}
            {(accessRoles ?? []).map((role) => (
              <div key={role.id} className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <RoleBadge role={role.name} />
                  <span className="text-[11px] text-text-muted">Custom</span>
                </div>
                <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
                  {role.permissions.length} permissions
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserManagement;
