import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Shield, Ban, Zap, Download, X, RefreshCw, Search, Filter, Copy, Pause, Play,
} from 'lucide-react';
import QueryError from '@/components/shared/QueryError';
import { fetchWithSession, get } from '@/lib/api-client';
import { clientFieldsFromRaw, useLiveTraffic, type LiveLogEntry } from '@/lib/realtime';
import { useRequestLogDetail } from '@/hooks/use-client-activity';
import { ClientActivityDetails, RequestClientFields } from '@/components/shared/ClientActivityDetails';
import {
  describeUserAgent, formatAbsolute, formatClock, formatLatency, formatProtocol, formatRelative, methodTone, statusTone,
} from '@/lib/format';
import EvidencePanel from '@/components/ui/EvidencePanel';
import EvidenceSectionHead from '@/components/ui/EvidenceSectionHead';
import EvidenceStamp from '@/components/ui/EvidenceStamp';
import EvidenceLedgerItem from '@/components/ui/EvidenceLedger';

type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM';
type MethodFilter = 'ALL' | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OTHER';

function maxEntrySeverity(attacks: LiveLogEntry['attacks']): string {
  if (!attacks.length) return '';
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  for (const sev of order) {
    if (attacks.some((a) => a.severity === sev)) return sev;
  }
  return attacks[0].severity;
}

function severityColor(sev: string): string {
  const map: Record<string, string> = {
    CRITICAL: 'var(--evd-critical)',
    HIGH: 'var(--evd-high)',
    MEDIUM: 'var(--evd-medium)',
    LOW: 'var(--evd-low)',
  };
  return map[sev.toUpperCase()] ?? 'var(--evd-ink-muted)';
}

function methodBucket(method: string): MethodFilter {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'POST' || upper === 'PUT' || upper === 'DELETE') return upper;
  return 'OTHER';
}

function exportCsv(rows: LiveLogEntry[]): void {
  const header = 'Timestamp,IP,ClientIP,ClientID,UserAgent,Application,Host,Method,Path,Status,Protocol,LatencyMs,Threats\n';
  const body = rows
    .map((r) => {
      const threats = r.attacks.map((a) => `${a.category}(${a.severity})`).join('; ');
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [
        cell(r.timestamp), cell(r.ip), cell(r.clientIp), cell(r.clientId), cell(r.userAgent), cell(r.application?.name),
        cell(r.host), cell(r.method), cell(r.path), r.status, cell(r.protocol), r.latencyMs ?? '', cell(threats),
      ].join(',');
    })
    .join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-feed-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function computeStats(rows: LiveLogEntry[], activeSensors: number) {
  const now = Date.now();
  const recent = rows.filter((r) => new Date(r.timestamp).getTime() >= now - 60_000);
  const threats = rows.filter((r) => r.attacks.length > 0).length;
  const blockedIps = new Set(rows.filter((r) => r.attacks.length > 0).map((r) => r.ip)).size;
  return { reqPerMin: recent.length, threats, blockedIps, sensors: activeSensors };
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* ignore */
  }
}

const METHOD_FILTERS: MethodFilter[] = ['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'OTHER'];

/** Client / application section of the inspector, enriched from the server when the row is persisted. */
const LiveEntryClientDetail: React.FC<{ entry: LiveLogEntry }> = ({ entry }) => {
  // Frames that never hit the database carry a client-generated id (see genId in realtime.ts).
  const persisted = !/^\d{13}-[a-z0-9]{5}$/.test(entry.id);
  const { data, isLoading } = useRequestLogDetail(persisted ? entry.id : null);
  const log = data?.log ?? {
    id: entry.id,
    ip: entry.ip,
    client_ip: entry.clientIp || null,
    client_id: entry.clientId || null,
    user_agent: entry.userAgent || null,
    method: entry.method,
    path: entry.path,
    host: entry.host ?? '',
    status: entry.status,
    latency_ms: entry.latencyMs ?? null,
    timestamp: entry.timestamp,
    endpoint_id: null,
    application: entry.application ? { ...entry.application } : null,
  };
  return (
    <div className="space-y-4 border-t pt-3" style={{ borderColor: 'var(--evd-line)' }}>
      <span className="evd-mono text-[10px] tracking-[0.14em]" style={{ color: 'var(--evd-ink-muted)' }}>
        CLIENT & APPLICATION
      </span>
      <RequestClientFields variant="evidence" log={log} />
      {data?.endpoint && (
        <dl className="evd-kv">
          <div><dt>Endpoint</dt><dd>{data.endpoint.method} {data.endpoint.path_pattern}</dd></div>
          <div><dt>Risk</dt><dd>{data.endpoint.risk_score ?? '—'}</dd></div>
          <div><dt>Auth</dt><dd>{data.endpoint.auth_types.length ? data.endpoint.auth_types.join(', ') : 'none seen'}</dd></div>
        </dl>
      )}
      {isLoading && (
        <p className="evd-mono text-[10px]" style={{ color: 'var(--evd-ink-muted)' }}>Loading client activity…</p>
      )}
      {data?.client_activity && <ClientActivityDetails variant="evidence" activity={data.client_activity} />}
    </div>
  );
};

const LiveFeed: React.FC = () => {
  const { connected, recentLogs, clearLogs, seedLogs } = useLiveTraffic();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const tableBodyRef = useRef<HTMLDivElement>(null);

  const { data: sensorsData } = useQuery({
    queryKey: ['live-feed', 'sensors'],
    queryFn: () => get<{ sensors: { status: string }[] }>('/sensors/').catch(() => ({ sensors: [] })),
    refetchInterval: 30_000,
  });
  const activeSensors = (sensorsData?.sensors ?? []).filter((s) => s.status === 'ONLINE').length;

  const { isLoading: initialLoading, isError, refetch } = useQuery({
    queryKey: ['live-feed', 'recent'],
    queryFn: async ({ signal }) => {
      const res = await fetchWithSession('/stream/recent?limit=100', { signal });
      const json = await res.json();
      const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      const items: LiveLogEntry[] = rows.map((d: Record<string, unknown>) => ({
        id: typeof d.id === 'string' ? d.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ip: String(d.ip ?? ''),
        method: String(d.method ?? ''),
        path: String(d.path ?? ''),
        status: Number(d.status ?? 0),
        bytes: (d.bytes as string | number) ?? '-',
        timestamp: String(d.timestamp ?? new Date().toISOString()),
        attacks: Array.isArray(d.attacks) ? (d.attacks as LiveLogEntry['attacks']) : [],
        host: d.host ? String(d.host) : '',
        protocol: d.protocol ? String(d.protocol) : '',
        latencyMs: typeof d.latency_ms === 'number' ? d.latency_ms : null,
        source: d.source ? String(d.source) : '',
        ...clientFieldsFromRaw(d),
      }));
      seedLogs(items);
      return items;
    },
    staleTime: 15_000,
    refetchOnMount: 'always',
    retry: 1,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!paused && tableBodyRef.current) tableBodyRef.current.scrollTop = 0;
  }, [recentLogs, paused]);

  const handleScroll = useCallback(() => {
    if (!tableBodyRef.current || paused) return;
    if (tableBodyRef.current.scrollTop > 50) setPaused(true);
  }, [paused]);

  const filteredEntries = useMemo(() => {
    return recentLogs.filter((e) => {
      if (severityFilter !== 'ALL') {
        const topSev = maxEntrySeverity(e.attacks);
        if (topSev !== severityFilter) return false;
      }
      if (methodFilter !== 'ALL' && methodBucket(e.method) !== methodFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const hay = `${e.ip} ${e.clientIp ?? ''} ${e.clientId ?? ''} ${e.userAgent ?? ''} ${e.application?.name ?? ''} ${e.path} ${e.host ?? ''} ${e.method} ${e.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recentLogs, severityFilter, methodFilter, searchQuery]);

  const selected = filteredEntries.find((e) => e.id === selectedId) ?? filteredEntries[0] ?? null;
  const stats = useMemo(() => computeStats(recentLogs, activeSensors), [recentLogs, activeSensors]);
  const newest = recentLogs[0];

  return (
    <div className="space-y-5 w-full p-4 pb-10 animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="evd-display text-xl" style={{ color: 'var(--evd-paper)' }}>
            LIVE TRAFFIC FEED
          </h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <EvidenceStamp tone={connected ? 'ok' : 'warn'} pulse>
              {connected ? 'STREAM NOMINAL' : 'RECONNECTING'}
            </EvidenceStamp>
            {paused && <EvidenceStamp tone="warn">PAUSED</EvidenceStamp>}
            <span className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
              eBPF → /v1/events · {filteredEntries.length}/{recentLogs.length} ROWS
              {newest ? ` · last ${formatRelative(newest.timestamp, now)}` : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="evd-ledger">
        <EvidenceLedgerItem icon={Activity} color="var(--evd-signal)" label="Requests / min" value={stats.reqPerMin} />
        <EvidenceLedgerItem icon={Shield} color="var(--evd-critical)" label="Threats" value={stats.threats} />
        <EvidenceLedgerItem icon={Ban} color="var(--evd-medium)" label="Flagged IPs" value={stats.blockedIps} />
        <EvidenceLedgerItem icon={Zap} color="var(--evd-low)" label="Active Sensors" value={stats.sensors} />
      </div>

      <EvidencePanel exhibit="EXH-LIVE">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <EvidenceSectionHead code="§LF" title="Event Stream" desc="HTTP ONLY · WS FRAMES SUPPRESSED" />
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="flex items-center gap-2 px-3 py-1.5"
              style={{ border: '1px solid var(--evd-line)', background: 'var(--evd-panel-raised)' }}
            >
              <Filter size={12} style={{ color: 'var(--evd-ink-muted)' }} />
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
                className="evd-mono text-[11px] bg-transparent outline-none cursor-pointer"
                style={{ color: 'var(--evd-paper)' }}
              >
                <option value="ALL">All severity</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
              </select>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 flex-1 min-w-[180px]"
              style={{ border: '1px solid var(--evd-line)', background: 'var(--evd-panel-raised)' }}
            >
              <Search size={12} style={{ color: 'var(--evd-ink-muted)' }} />
              <input
                type="text"
                placeholder="IP, app, client, user agent, path…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="evd-mono text-[11px] bg-transparent outline-none w-full"
                style={{ color: 'var(--evd-paper)' }}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} style={{ color: 'var(--evd-ink-muted)' }}>
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              className="evd-btn"
              title={paused ? 'Resume live scroll' : 'Pause live scroll'}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button type="button" onClick={clearLogs} className="evd-btn" aria-label="Clear feed" title="Clear">
              <X size={14} />
            </button>
            <button
              type="button"
              onClick={() => exportCsv(filteredEntries)}
              className="evd-btn"
              aria-label="Export CSV"
              title="Export CSV"
            >
              <Download size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {METHOD_FILTERS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => setMethodFilter(method)}
              className="evd-mono text-[10px] px-2 py-1"
              style={{
                border: '1px solid var(--evd-line)',
                background: methodFilter === method ? 'var(--evd-signal-dim)' : 'transparent',
                color: methodFilter === method ? 'var(--evd-signal)' : 'var(--evd-ink-muted)',
              }}
            >
              {method}
            </button>
          ))}
        </div>

        {isError && <QueryError message="Failed to load recent traffic" onRetry={() => refetch()} />}

        {paused && (
          <button
            type="button"
            onClick={() => {
              setPaused(false);
              tableBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="evd-link mb-3"
          >
            <RefreshCw size={11} /> RESUME LIVE SCROLL
          </button>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div ref={tableBodyRef} onScroll={handleScroll} className="overflow-auto" style={{ maxHeight: 580 }}>
            <table className="evd-table min-w-[720px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  {['Time', 'Source', 'Method', 'Host / Path', 'Status', 'Proto', 'Latency', 'Threat'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {initialLoading &&
                  recentLogs.length === 0 &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j}>
                          <div className="h-3 rounded" style={{ width: j === 3 ? '80%' : '60%', background: 'var(--evd-line)' }} />
                        </td>
                      ))}
                    </tr>
                  ))}

                {!initialLoading && filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12">
                      <div className="space-y-2">
                        <p className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
                          {connected
                            ? 'No HTTP request logs for this tenant yet.'
                            : 'Disconnected — reconnecting via shared socket…'}
                        </p>
                        <p className="text-[12px]" style={{ color: 'var(--evd-ink-muted)' }}>
                          Live Feed shows decrypted HTTPS from the node eBPF sensor. Generate traffic to a
                          wecrew ingress host, then this table fills.
                        </p>
                        <button type="button" onClick={() => refetch()} className="evd-link mt-2">
                          <RefreshCw size={11} /> RELOAD RECENT
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {filteredEntries.map((entry) => {
                  const attacks = entry.attacks ?? [];
                  const topAttack = attacks[0] ?? null;
                  const mc = methodTone(entry.method);
                  const sc = statusTone(entry.status);
                  const isSelected = selected?.id === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      data-selected={isSelected || undefined}
                      onClick={() => setSelectedId(entry.id)}
                      style={attacks.length ? { background: 'var(--evd-signal-dim)' } : undefined}
                    >
                      <td className="whitespace-nowrap">
                        <div className="evd-mono text-[11px] tabular-nums">{formatClock(entry.timestamp)}</div>
                        <div className="evd-mono text-[10px]" style={{ color: 'var(--evd-ink-muted)' }}>
                          {formatRelative(entry.timestamp, now)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="evd-mono text-[12px]">{entry.clientIp || entry.ip || '—'}</div>
                        {entry.userAgent ? (
                          <div className="evd-mono text-[10px] max-w-[150px] truncate" style={{ color: 'var(--evd-ink-muted)' }} title={entry.userAgent}>
                            {describeUserAgent(entry.userAgent).label}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className="evd-mono text-[10px] font-bold px-2 py-0.5" style={{ background: mc.bg, color: mc.text }}>
                          {entry.method}
                        </span>
                      </td>
                      <td className="max-w-[320px]">
                        {entry.host || entry.application ? (
                          <div className="evd-mono text-[10px] truncate" style={{ color: 'var(--evd-ink-muted)' }}>
                            {[entry.application?.name, entry.host].filter(Boolean).join(' · ')}
                          </div>
                        ) : null}
                        <div className="evd-mono text-[12px] truncate">{entry.path}</div>
                      </td>
                      <td className="evd-mono text-[12px] font-bold tabular-nums" style={{ color: sc }}>
                        {entry.status || '—'}
                      </td>
                      <td className="evd-mono text-[10px] whitespace-nowrap" style={{ color: 'var(--evd-ink-muted)' }}>
                        {formatProtocol(entry.protocol)}
                      </td>
                      <td className="evd-mono text-[11px] tabular-nums whitespace-nowrap" style={{ color: 'var(--evd-ink-muted)' }}>
                        {formatLatency(entry.latencyMs)}
                      </td>
                      <td>
                        {topAttack ? (
                          <span className="evd-badge" style={{ color: severityColor(topAttack.severity) }}>
                            {topAttack.category}
                          </span>
                        ) : (
                          <span className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <aside className="evd-inspector">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="evd-mono text-[10px] tracking-[0.14em]" style={{ color: 'var(--evd-ink-muted)' }}>
                    EVENT DETAIL
                  </span>
                  <button type="button" className="evd-link" onClick={() => copyText(`${selected.method} ${selected.host ?? ''}${selected.path}`)}>
                    <Copy size={11} /> COPY
                  </button>
                </div>
                <dl className="evd-kv">
                  <div><dt>Observed</dt><dd>{formatAbsolute(selected.timestamp)}</dd></div>
                  <div><dt>Age</dt><dd>{formatRelative(selected.timestamp, now)}</dd></div>
                  <div><dt>Source IP</dt><dd>{selected.ip || '—'}</dd></div>
                  <div><dt>Host</dt><dd>{selected.host || '—'}</dd></div>
                  <div><dt>Method</dt><dd>{selected.method}</dd></div>
                  <div><dt>Path</dt><dd className="break-all">{selected.path}</dd></div>
                  <div><dt>Status</dt><dd style={{ color: statusTone(selected.status) }}>{selected.status || '—'}</dd></div>
                  <div><dt>Protocol</dt><dd>{formatProtocol(selected.protocol)}</dd></div>
                  <div><dt>Latency</dt><dd>{formatLatency(selected.latencyMs)}</dd></div>
                  <div><dt>Source</dt><dd>{selected.source || 'ebpf'}</dd></div>
                  <div>
                    <dt>Threat</dt>
                    <dd>
                      {selected.attacks.length
                        ? selected.attacks.map((a) => `${a.severity} ${a.category}`).join(', ')
                        : 'none'}
                    </dd>
                  </div>
                </dl>
                <LiveEntryClientDetail entry={selected} />
              </div>
            ) : (
              <p className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
                Select a row to inspect host, timing, and threat overlay.
              </p>
            )}
          </aside>
        </div>
      </EvidencePanel>
    </div>
  );
};

export default LiveFeed;
