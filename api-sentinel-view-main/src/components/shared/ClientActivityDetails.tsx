import React from 'react';

import { describeUserAgent, formatAbsolute, formatLatency, statusTone } from '@/lib/format';
import type { ClientActivity, CountedValue, RequestLogRecord } from '@/services/client-activity.service';

/**
 * Client context for a request, security event, or threat actor.
 *
 * `variant` matches the surrounding page: 'evidence' for the Evidence system
 * (Live Feed), 'glass' for the GlassCard pages (Security Events, Threat Actors).
 */
type Variant = 'evidence' | 'glass';

const STYLES: Record<Variant, { heading: string; label: string; value: string; row: string; muted: string; mono: string }> = {
  evidence: {
    heading: 'evd-mono text-[10px] tracking-[0.14em]',
    label: 'evd-mono text-[10px] uppercase tracking-[0.06em]',
    value: 'evd-mono text-[11px]',
    row: 'border-t',
    muted: 'evd-mono text-[10px]',
    mono: 'evd-mono',
  },
  glass: {
    heading: 'text-[11px] font-semibold uppercase tracking-wider text-text-muted',
    label: 'text-[11px] uppercase tracking-wider text-text-muted',
    value: 'text-[12px] text-text-primary',
    row: 'border-t border-border-subtle',
    muted: 'text-[11px] text-text-muted',
    mono: 'font-mono',
  },
};

function toneStyle(variant: Variant, tone: 'ink' | 'muted' | 'line'): React.CSSProperties | undefined {
  if (variant !== 'evidence') return undefined;
  if (tone === 'ink') return { color: 'var(--evd-paper)' };
  if (tone === 'muted') return { color: 'var(--evd-ink-muted)' };
  return { borderColor: 'var(--evd-line)' };
}

export const ClientField: React.FC<{ variant: Variant; label: string; children: React.ReactNode; title?: string }> = ({
  variant,
  label,
  children,
  title,
}) => {
  const s = STYLES[variant];
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 items-start">
      <dt className={s.label} style={toneStyle(variant, 'muted')}>{label}</dt>
      <dd className={`${s.value} m-0 break-words`} style={toneStyle(variant, 'ink')} title={title}>
        {children}
      </dd>
    </div>
  );
};

/** The client fields of a single request: IP, identity, user agent, application. */
export const RequestClientFields: React.FC<{ variant: Variant; log: RequestLogRecord }> = ({ variant, log }) => {
  const ua = describeUserAgent(log.user_agent);
  return (
    <dl className="grid gap-2">
      <ClientField variant={variant} label="Client IP">{log.client_ip || log.ip || '—'}</ClientField>
      {log.ip && log.client_ip && log.ip !== log.client_ip && (
        <ClientField variant={variant} label="Actor">{log.ip}</ClientField>
      )}
      <ClientField variant={variant} label="Client ID">{log.client_id || 'anonymous'}</ClientField>
      <ClientField variant={variant} label="User agent" title={log.user_agent ?? undefined}>
        {ua.label}
        {log.user_agent && (
          <span className={`block ${STYLES[variant].muted} break-all`} style={toneStyle(variant, 'muted')}>
            {log.user_agent}
          </span>
        )}
      </ClientField>
      <ClientField variant={variant} label="Application">
        {log.application ? log.application.name : 'Unassigned'}
      </ClientField>
      <ClientField variant={variant} label="Host">{log.host || '—'}</ClientField>
    </dl>
  );
};

const TopList: React.FC<{ variant: Variant; title: string; items: CountedValue[]; render?: (v: string) => React.ReactNode }> = ({
  variant,
  title,
  items,
  render,
}) => {
  const s = STYLES[variant];
  return (
    <div>
      <div className={s.heading} style={toneStyle(variant, 'muted')}>{title}</div>
      {items.length === 0 ? (
        <p className={`${s.muted} mt-1`} style={toneStyle(variant, 'muted')}>None recorded</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((item) => (
            <li key={item.value} className="flex items-start justify-between gap-3">
              <span className={`${s.value} min-w-0 break-words`} style={toneStyle(variant, 'ink')} title={item.value}>
                {render ? render(item.value) : item.value}
              </span>
              <span className={`${s.muted} ${s.mono} shrink-0 tabular-nums`} style={toneStyle(variant, 'muted')}>
                {item.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const STATUS_ORDER = ['2xx', '3xx', '4xx', '5xx'];

function glassStatusClass(code: number | null): string {
  if (!code) return 'text-text-muted';
  if (code >= 500) return 'text-sev-critical';
  if (code >= 400) return 'text-sev-medium';
  if (code >= 300) return 'text-sev-info';
  return 'text-sev-low';
}

export const ClientActivityDetails: React.FC<{ variant: Variant; activity: ClientActivity }> = ({ variant, activity }) => {
  const s = STYLES[variant];
  const statuses = STATUS_ORDER.filter((k) => activity.status_classes[k]).map((k) => `${k} ${activity.status_classes[k]}`);
  return (
    <div className="space-y-4">
      <div>
        <div className={s.heading} style={toneStyle(variant, 'muted')}>
          CLIENT ACTIVITY · LAST {activity.window_days} DAYS
        </div>
        <dl className="mt-2 grid gap-2">
          <ClientField variant={variant} label="Requests">
            {activity.request_count.toLocaleString()}
            {activity.truncated ? '+' : ''}
          </ClientField>
          <ClientField variant={variant} label="First seen">
            {activity.first_seen ? formatAbsolute(activity.first_seen) : '—'}
          </ClientField>
          <ClientField variant={variant} label="Last seen">
            {activity.last_seen ? formatAbsolute(activity.last_seen) : '—'}
          </ClientField>
          <ClientField variant={variant} label="Avg latency">{formatLatency(activity.avg_latency_ms)}</ClientField>
          <ClientField variant={variant} label="Status mix">{statuses.length ? statuses.join(' · ') : '—'}</ClientField>
          {activity.client_ids.length > 0 && (
            <ClientField variant={variant} label="Client IDs">{activity.client_ids.join(', ')}</ClientField>
          )}
        </dl>
      </div>

      <div className={`grid gap-4 ${variant === 'glass' ? 'sm:grid-cols-2' : ''}`}>
        <TopList variant={variant} title="APPLICATIONS" items={activity.applications} />
        <TopList variant={variant} title="HOSTS" items={activity.hosts} />
        <TopList
          variant={variant}
          title="USER AGENTS"
          items={activity.user_agents}
          render={(value) => describeUserAgent(value).label}
        />
        <TopList variant={variant} title="TOP ENDPOINTS" items={activity.endpoints} />
      </div>

      {activity.recent_requests.length > 0 && (
        <div>
          <div className={s.heading} style={toneStyle(variant, 'muted')}>RECENT REQUESTS</div>
          <table className="mt-1 w-full table-fixed">
            <tbody>
              {activity.recent_requests.map((req) => (
                <tr key={req.id} className={s.row} style={toneStyle(variant, 'line')}>
                  <td className={`${s.muted} ${s.mono} w-[38%] py-1 pr-2 align-top`} style={toneStyle(variant, 'muted')}>
                    {req.timestamp ? formatAbsolute(req.timestamp) : '—'}
                  </td>
                  <td className={`${s.value} ${s.mono} py-1 pr-2 align-top break-all`} style={toneStyle(variant, 'ink')}>
                    {req.method} {req.path}
                    <span className={`block ${s.muted}`} style={toneStyle(variant, 'muted')}>
                      {[req.application?.name, describeUserAgent(req.user_agent).label].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td
                    className={`${s.value} ${s.mono} w-12 py-1 text-right align-top ${variant === 'glass' ? glassStatusClass(req.status) : ''}`}
                    style={variant === 'evidence' ? { color: statusTone(req.status ?? 0) } : undefined}
                  >
                    {req.status ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ClientActivityDetails;
