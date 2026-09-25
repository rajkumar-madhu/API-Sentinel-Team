import React, { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Copy, Fingerprint, KeyRound, Trash2, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import GlassCard from '@/components/ui/GlassCard';
import QueryError from '@/components/shared/QueryError';
import TableSkeleton from '@/components/shared/TableSkeleton';
import {
  useCreateSsoProvider,
  useDeleteSsoProvider,
  useSetSsoProviderEnabled,
  useSsoProviders,
  useSsoSetupInfo,
} from '@/hooks/use-sso';
import { toast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-client';
import type { SsoProviderType, SsoSetupUrls } from '@/services/sso.service';

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  target: 'config' | 'client_id' | 'client_secret';
  multiline?: boolean;
  secret?: boolean;
}

const PROVIDER_TYPES: { value: SsoProviderType; label: string; hint: string; fields: FieldDef[] }[] = [
  {
    value: 'oidc',
    label: 'OpenID Connect',
    hint: 'Okta, Azure AD / Entra ID, Google Workspace, Auth0, or any OIDC-compliant IdP.',
    fields: [
      { key: 'issuer', label: 'Issuer URL', placeholder: 'https://yourorg.okta.com', target: 'config' },
      { key: 'client_id', label: 'Client ID', target: 'client_id' },
      { key: 'client_secret', label: 'Client secret', target: 'client_secret', secret: true },
    ],
  },
  {
    value: 'saml',
    label: 'SAML 2.0',
    hint: 'Okta, Azure AD, OneLogin, PingFederate, ADFS, or any SAML 2.0 IdP.',
    fields: [
      { key: 'idp_entity_id', label: 'IdP entity ID', placeholder: 'http://www.okta.com/exk…', target: 'config' },
      { key: 'idp_sso_url', label: 'IdP SSO URL', placeholder: 'https://yourorg.okta.com/app/…/sso/saml', target: 'config' },
      { key: 'idp_x509_cert', label: 'IdP signing certificate (X.509)', placeholder: 'MIIDpDCCAoygAwIBAgIGAX…', target: 'config', multiline: true },
    ],
  },
  {
    value: 'github',
    label: 'GitHub',
    hint: 'GitHub OAuth app sign-in.',
    fields: [
      { key: 'client_id', label: 'Client ID', target: 'client_id' },
      { key: 'client_secret', label: 'Client secret', target: 'client_secret', secret: true },
    ],
  },
];

const SETUP_LABELS: Record<keyof SsoSetupUrls, string> = {
  callback_url: 'Redirect / callback URL',
  acs_url: 'ACS (reply) URL',
  sp_entity_id: 'SP entity ID (audience)',
  metadata_url: 'SP metadata URL',
};

const INPUT_CLASS =
  'w-full rounded-xl border border-border-subtle bg-bg-base px-4 py-3 text-sm text-text-primary outline-none transition-all focus:border-brand/30 focus:ring-1 focus:ring-brand/20';

const copy = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: 'Copied', description: value });
  } catch {
    toast({ title: 'Copy failed', description: 'Clipboard access was denied by the browser.', variant: 'destructive' });
  }
};

const SetupUrlList: React.FC<{ urls: SsoSetupUrls | undefined }> = ({ urls }) => {
  const entries = Object.entries(urls ?? {}).filter(([, v]) => Boolean(v)) as [keyof SsoSetupUrls, string][];
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-xl border border-border-subtle bg-bg-base px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{SETUP_LABELS[key]}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="break-all font-mono text-[11px] text-text-primary">{value}</span>
            <button
              type="button"
              onClick={() => copy(value)}
              className="shrink-0 rounded-md border border-border-subtle p-1.5 text-text-muted hover:text-text-primary"
              aria-label={`Copy ${SETUP_LABELS[key]}`}
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const SsoSettings: React.FC = () => {
  const navigate = useNavigate();
  const { data: providers, isLoading, isError, refetch } = useSsoProviders();
  const { data: setupInfo } = useSsoSetupInfo();
  const createProvider = useCreateSsoProvider();
  const setEnabled = useSetSsoProviderEnabled();
  const deleteProvider = useDeleteSsoProvider();

  const [type, setType] = useState<SsoProviderType>('oidc');
  const [values, setValues] = useState<Record<string, string>>({});
  const [allowedDomains, setAllowedDomains] = useState('');

  const items = useMemo(() => providers ?? [], [providers]);
  const configuredTypes = useMemo(() => new Set(items.map((p) => p.provider)), [items]);
  const typeDef = PROVIDER_TYPES.find((t) => t.value === type) ?? PROVIDER_TYPES[0];
  const alreadyConfigured = configuredTypes.has(type);

  const handleTypeChange = (next: SsoProviderType) => {
    setType(next);
    setValues({});
  };

  const handleCreate = async () => {
    const missing = typeDef.fields.find((f) => !values[f.key]?.trim());
    if (missing) {
      toast({ title: `${missing.label} is required`, variant: 'destructive' });
      return;
    }
    const config: Record<string, string> = {};
    let clientId = '';
    let clientSecret = '';
    for (const field of typeDef.fields) {
      const value = values[field.key].trim();
      if (field.target === 'config') config[field.key] = value;
      if (field.target === 'client_id') clientId = value;
      if (field.target === 'client_secret') clientSecret = value;
    }
    const domains = allowedDomains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    try {
      await createProvider.mutateAsync({
        provider: type,
        client_id: clientId,
        client_secret: clientSecret,
        allowed_domains: domains,
        config,
      });
      toast({ title: 'Identity provider added', description: `${typeDef.label} sign-in is now configured.` });
      setValues({});
      setAllowedDomains('');
    } catch (err) {
      toast({ title: 'Could not add provider', description: apiErrorMessage(err, 'Check the fields and try again.'), variant: 'destructive' });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await setEnabled.mutateAsync({ id, enabled });
    } catch (err) {
      toast({ title: 'Update failed', description: apiErrorMessage(err, 'Could not change provider status.'), variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`Remove ${label} sign-in? Users will no longer be able to log in with it.`)) return;
    try {
      await deleteProvider.mutateAsync(id);
      toast({ title: 'Identity provider removed' });
    } catch (err) {
      toast({ title: 'Delete failed', description: apiErrorMessage(err, 'Could not remove provider.'), variant: 'destructive' });
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
            <h2 className="text-sm font-bold text-text-primary">Single Sign-On</h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              Let your team sign in through your identity provider with OIDC or SAML.
            </p>
          </div>
        </div>
        <div className="rounded-full border border-border-subtle bg-bg-elevated px-3 py-1 text-[11px] font-semibold text-text-secondary">
          {items.filter((p) => p.enabled).length} active
        </div>
      </div>

      {isError && <QueryError message="Failed to load identity providers" onRetry={() => refetch()} />}

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <GlassCard variant="elevated" className="p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            <Fingerprint size={12} />
            Add identity provider
          </div>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Protocol</label>
              <select value={type} onChange={(e) => handleTypeChange(e.target.value as SsoProviderType)} className={INPUT_CLASS}>
                {PROVIDER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}{configuredTypes.has(t.value) ? ' (configured)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-text-muted">{typeDef.hint}</p>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                1. Register these in your IdP
              </div>
              <SetupUrlList urls={setupInfo?.urls[type]} />
            </div>

            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              2. Paste the IdP's details
            </div>

            {alreadyConfigured ? (
              <div className="rounded-xl border border-dashed border-border-subtle bg-bg-base px-4 py-4 text-[12px] text-text-secondary">
                A {typeDef.label} provider is already configured. Remove it first to replace it.
              </div>
            ) : (
              <>
                {typeDef.fields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <label htmlFor={`sso-${field.key}`} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{field.label}</label>
                    {field.multiline ? (
                      <textarea
                        id={`sso-${field.key}`}
                        rows={5}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className={`${INPUT_CLASS} font-mono text-[11px]`}
                      />
                    ) : (
                      <input
                        id={`sso-${field.key}`}
                        type={field.secret ? 'password' : 'text'}
                        autoComplete="off"
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className={INPUT_CLASS}
                      />
                    )}
                  </div>
                ))}

                <div className="space-y-1.5">
                  <label htmlFor="sso-allowed-domains" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Allowed email domains (optional)
                  </label>
                  <input
                    id="sso-allowed-domains"
                    value={allowedDomains}
                    onChange={(e) => setAllowedDomains(e.target.value)}
                    placeholder="yourcompany.com, subsidiary.com"
                    className={INPUT_CLASS}
                  />
                  <p className="text-[11px] text-text-muted">Leave empty to accept any address your IdP authenticates.</p>
                </div>

                <button
                  onClick={handleCreate}
                  disabled={createProvider.isPending}
                  className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                >
                  {createProvider.isPending ? 'Saving...' : `Add ${typeDef.label}`}
                </button>
              </>
            )}
          </div>
        </GlassCard>

        <GlassCard variant="elevated" className="p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Configured providers</div>
          <div className="mt-1 text-sm font-bold text-text-primary">
            New SSO users join as <span className="font-mono">MEMBER</span>. Change roles in User & Role Administration.
          </div>

          <div className="mt-4 space-y-3">
            {isLoading && <TableSkeleton columns={3} rows={2} />}

            {!isLoading && items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border-subtle bg-bg-base px-5 py-10 text-center">
                <KeyRound size={26} className="mx-auto text-text-muted" />
                <p className="mt-3 text-sm font-semibold text-text-primary">No identity providers yet</p>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">
                  Users sign in with email and password until you add one.
                </p>
              </div>
            )}

            {items.map((item) => {
              const label = PROVIDER_TYPES.find((t) => t.value === item.provider)?.label ?? item.provider;
              const identity = item.config.issuer || item.config.idp_entity_id || item.client_id;
              const loginPath = setupInfo?.login[item.provider];
              return (
                <div key={item.id} className="rounded-2xl border border-border-subtle bg-bg-base px-4 py-4 space-y-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-text-primary">{label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${item.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700'}`}>
                          {item.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      {identity && <div className="mt-1 break-all font-mono text-[11px] text-text-muted">{identity}</div>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(item.allowed_domains.length ? item.allowed_domains : ['any domain']).map((d) => (
                          <span key={d} className="rounded-full border border-border-subtle px-2 py-1 text-[11px] text-text-secondary">{d}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleToggle(item.id, !item.enabled)}
                        className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-brand/20 transition-colors"
                      >
                        {item.enabled ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                        {item.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleDelete(item.id, label)}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10"
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                  <SetupUrlList urls={item.setup} />
                  {loginPath && (
                    <div className="text-[11px] text-text-muted">
                      Sign-in entry point: <span className="font-mono text-text-secondary">{loginPath}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default SsoSettings;
