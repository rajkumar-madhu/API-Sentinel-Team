import React, { useMemo, useState } from 'react';
import { ArrowLeft, Bell, CheckCircle2, Plug, Trash2, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import GlassCard from '@/components/ui/GlassCard';
import QueryError from '@/components/shared/QueryError';
import TableSkeleton from '@/components/shared/TableSkeleton';
import {
  useCreateIntegration,
  useDeleteIntegration,
  useIntegrations,
  useTestIntegration,
  useUpdateIntegration,
} from '@/hooks/use-integrations';
import { INTEGRATION_EVENT_OPTIONS, type IntegrationType } from '@/services/integrations.service';
import { toast } from '@/hooks/use-toast';

interface ConfigField {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}

const TYPE_OPTIONS: { value: IntegrationType; label: string; fields: ConfigField[] }[] = [
  { value: 'slack', label: 'Slack', fields: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
  ] },
  { value: 'webhook', label: 'Generic webhook', fields: [
    { key: 'url', label: 'URL', placeholder: 'https://example.com/hooks/sentinel' },
    { key: 'secret', label: 'Signing secret (optional)' },
    { key: 'method', label: 'HTTP method', defaultValue: 'POST' },
  ] },
  { value: 'pagerduty', label: 'PagerDuty', fields: [
    { key: 'routing_key', label: 'Routing key' },
  ] },
  { value: 'jira', label: 'Jira', fields: [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://yourorg.atlassian.net' },
    { key: 'email', label: 'Account email' },
    { key: 'api_token', label: 'API token' },
    { key: 'project_key', label: 'Project key', placeholder: 'SEC' },
  ] },
  { value: 'splunk', label: 'Splunk (HEC)', fields: [
    { key: 'hec_url', label: 'HEC URL' },
    { key: 'hec_token', label: 'HEC token' },
    { key: 'index', label: 'Index', defaultValue: 'main' },
  ] },
  { value: 'datadog', label: 'Datadog', fields: [
    { key: 'api_key', label: 'API key' },
    { key: 'app_key', label: 'App key' },
    { key: 'site', label: 'Site', defaultValue: 'datadoghq.com' },
  ] },
  { value: 'azure_boards', label: 'Azure Boards', fields: [
    { key: 'organization', label: 'Organization' },
    { key: 'project', label: 'Project' },
    { key: 'personal_access_token', label: 'Personal access token' },
  ] },
  { value: 'sentinel', label: 'Microsoft Sentinel', fields: [
    { key: 'endpoint_url', label: 'Endpoint URL' },
  ] },
  { value: 'qradar', label: 'IBM QRadar', fields: [
    { key: 'endpoint_url', label: 'Endpoint URL' },
    { key: 'format', label: 'Format', defaultValue: 'LEEF' },
  ] },
  { value: 'elastic', label: 'Elastic', fields: [
    { key: 'endpoint_url', label: 'Endpoint URL' },
    { key: 'api_key', label: 'API key' },
  ] },
  { value: 'chronicle', label: 'Google Chronicle', fields: [
    { key: 'endpoint_url', label: 'Endpoint URL' },
    { key: 'api_key', label: 'API key' },
  ] },
  { value: 'bigquery', label: 'BigQuery export', fields: [
    { key: 'project_id', label: 'Project ID' },
    { key: 'dataset_id', label: 'Dataset ID' },
  ] },
];

const DEFAULT_EVENTS = ['vulnerability_found', 'test_complete', 'alert.created'];

const IntegrationsSettings: React.FC = () => {
  const navigate = useNavigate();
  const { data: integrations, isLoading, isError, refetch } = useIntegrations();
  const createIntegration = useCreateIntegration();
  const updateIntegration = useUpdateIntegration();
  const deleteIntegration = useDeleteIntegration();
  const testIntegration = useTestIntegration();

  const [selectedType, setSelectedType] = useState<IntegrationType>('slack');
  const [name, setName] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [testingId, setTestingId] = useState<string | null>(null);

  const activeTypeDef = useMemo(
    () => TYPE_OPTIONS.find((option) => option.value === selectedType) ?? TYPE_OPTIONS[0],
    [selectedType],
  );

  const items = integrations ?? [];
  const enabledCount = items.filter((item) => item.enabled).length;

  const toggleEvent = (event: string) => {
    setEvents((current) => (
      current.includes(event) ? current.filter((entry) => entry !== event) : [...current, event]
    ));
  };

  const handleTypeChange = (type: IntegrationType) => {
    setSelectedType(type);
    setFieldValues({});
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: 'Name required', description: 'Give the integration a descriptive name.', variant: 'destructive' });
      return;
    }
    const config: Record<string, unknown> = {};
    for (const field of activeTypeDef.fields) {
      const value = fieldValues[field.key] ?? field.defaultValue;
      if (value) config[field.key] = value;
    }
    try {
      await createIntegration.mutateAsync({ type: selectedType, name: name.trim(), config, events });
      toast({ title: 'Integration created', description: `${activeTypeDef.label} destination saved.` });
      setName('');
      setFieldValues({});
    } catch {
      toast({ title: 'Failed to create integration', description: 'Check the destination fields and try again.', variant: 'destructive' });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await updateIntegration.mutateAsync({ id, payload: { enabled } });
    } catch {
      toast({ title: 'Update failed', description: 'Could not change integration status.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteIntegration.mutateAsync(id);
      toast({ title: 'Integration removed' });
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await testIntegration.mutateAsync(id);
      toast({
        title: result.success ? 'Test succeeded' : 'Test failed',
        description: result.detail,
        variant: result.success ? undefined : 'destructive',
      });
    } catch {
      toast({ title: 'Test failed', description: 'The backend rejected the test request.', variant: 'destructive' });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in w-full pb-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/settings')}
            className="w-9 h-9 rounded-xl border border-border-subtle bg-bg-surface flex items-center justify-center text-text-muted hover:text-text-primary hover:border-brand/20 transition-all"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-sm font-bold text-text-primary">Alert Destinations & Integrations</h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              Send vulnerability, test, and alert events to Slack, PagerDuty, webhooks, and your SIEM.
            </p>
          </div>
        </div>
        <div className="rounded-full border border-border-subtle bg-bg-elevated px-3 py-1 text-[11px] font-semibold text-text-secondary">
          {enabledCount} active
        </div>
      </div>

      {isError && <QueryError message="Failed to load integrations" onRetry={() => refetch()} />}

      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <GlassCard variant="elevated" className="p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            <Plug size={12} />
            Add destination
          </div>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Type</label>
              <select
                value={selectedType}
                onChange={(event) => handleTypeChange(event.target.value as IntegrationType)}
                className="w-full rounded-xl border border-border-subtle bg-bg-base px-4 py-3 text-sm text-text-primary outline-none transition-all focus:border-brand/30 focus:ring-1 focus:ring-brand/20"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={`${activeTypeDef.label} destination`}
                className="w-full rounded-xl border border-border-subtle bg-bg-base px-4 py-3 text-sm text-text-primary outline-none transition-all focus:border-brand/30 focus:ring-1 focus:ring-brand/20"
              />
            </div>

            {activeTypeDef.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{field.label}</label>
                <input
                  value={fieldValues[field.key] ?? field.defaultValue ?? ''}
                  onChange={(event) => setFieldValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full rounded-xl border border-border-subtle bg-bg-base px-4 py-3 text-sm text-text-primary outline-none transition-all focus:border-brand/30 focus:ring-1 focus:ring-brand/20"
                />
              </div>
            ))}

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Events</div>
              <div className="space-y-2">
                {INTEGRATION_EVENT_OPTIONS.map((event) => (
                  <label key={event} className="flex items-center justify-between rounded-xl border border-border-subtle bg-bg-base px-3 py-2.5">
                    <span className="text-sm font-medium text-text-primary">{event}</span>
                    <input
                      type="checkbox"
                      checked={events.includes(event)}
                      onChange={() => toggleEvent(event)}
                      className="h-4 w-4 rounded"
                      style={{ accentColor: 'var(--brand)' }}
                    />
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={createIntegration.isPending}
              className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {createIntegration.isPending ? 'Saving...' : 'Add destination'}
            </button>
          </div>
        </GlassCard>

        <GlassCard variant="elevated" className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Configured destinations</div>
              <div className="mt-1 text-sm font-bold text-text-primary">Test each destination after saving credentials.</div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {isLoading && <TableSkeleton columns={4} rows={3} />}

            {!isLoading && items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border-subtle bg-bg-base px-5 py-10 text-center">
                <Bell size={26} className="mx-auto text-text-muted" />
                <p className="mt-3 text-sm font-semibold text-text-primary">No alert destinations yet</p>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">
                  Add Slack, PagerDuty, or a webhook so your team gets notified on new findings.
                </p>
              </div>
            )}

            {items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-border-subtle bg-bg-base px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-text-primary">{item.name}</span>
                      <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-text-secondary">
                        {item.type}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${item.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700'}`}>
                        {item.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.events.map((event) => (
                        <span key={event} className="rounded-full border border-border-subtle px-2 py-1 text-[11px] text-text-secondary">
                          {event}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleTest(item.id)}
                      disabled={testingId === item.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-brand/20 transition-colors disabled:opacity-60"
                    >
                      {testingId === item.id ? 'Testing...' : 'Send test'}
                    </button>
                    <button
                      onClick={() => handleToggle(item.id, !item.enabled)}
                      className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-brand/20 transition-colors"
                    >
                      {item.enabled ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                      {item.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default IntegrationsSettings;
