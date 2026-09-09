import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Shield, Ban, Zap, Download, X, RefreshCw, Search, Filter, Copy, Pause, Play,
} from 'lucide-react';
import QueryError from '@/components/shared/QueryError';
import PageHeader from '@/components/shared/PageHeader';
import { fetchWithSession } from '@/lib/api-client';
import { useLiveTraffic, type LiveLogEntry } from '@/lib/realtime';
import {
  formatAbsolute, formatClock, formatLatency, formatProtocol, formatRelative, methodTone, statusTone,
} from '@/lib/format';
import EvidencePanel from '@/components/ui/EvidencePanel';
import EvidenceSectionHead from '@/components/ui/EvidenceSectionHead';
import EvidenceStamp from '@/components/ui/EvidenceStamp';
import EvidenceLedgerItem from '@/components/ui/EvidenceLedger';
import { useApiCollections } from '@/hooks/use-discovery';
import type { AktoApiCollection } from '@/services/discovery.service';

type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM';
type MethodFilter = 'ALL' | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OTHER';

const KNOWN_APP_LABELS: Record<string, string> = {
  harbor: 'Harbor Registry',
  'api-sentinel': 'API Sentinel',
  'api-sentinel-frontend': 'API Sentinel Console',
  'api-sentinel-backend': 'API Sentinel API',
  sentinel: 'API Sentinel',
  n8n: 'n8n',
  'n8n-admin': 'n8n Admin',
  hermes: 'Hermes',
  dashboard: 'Hermes Dashboard',
  keycloak: 'Keycloak',
};

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().split(':')[0];
}

function titleCaseToken(token: string): string {
  return token
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Prefer inventory display name; otherwise a readable label from the host. */
function resolveApplicationName(host: string | undefined, collections: AktoApiCollection[]): string {
  if (!host?.trim()) return 'Unknown application';
  const normalized = normalizeHost(host);
  const match = collections.find((collection) => {
    const collectionHost = normalizeHost(collection.hostName || '');
    if (!collectionHost || collectionHost === 'all-hosts' || collectionHost === 'internal') return false;
    return (
      collectionHost === normalized
      || normalized.endsWith(`.${collectionHost}`)
      || collectionHost.endsWith(`.${normalized}`)
    );
  });
  if (match?.displayName?.trim()) return match.displayName.trim();

  const labels = normalized.split('.').filter(Boolean);
  for (const label of labels) {
    if (KNOWN_APP_LABELS[label]) return KNOWN_APP_LABELS[label];
  }
  if (labels[0]) return titleCaseToken(labels[0]);
  return host;
}

/** Shorten digests / UUIDs so the path stays scannable in the table. */
function summarizePath(path: string): string {
  if (!path) return '—';
  return path
    .replace(/sha256:[a-f0-9]{16,}/gi, (match) => `${match.slice(0, 15)}…`)
    .replace(/\/[a-f0-9]{24,}/gi, (match) => `/${match.slice(1, 9)}…`);
}

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

function exportCsv(rows: LiveLogEntry[], collections: AktoApiCollection[]): void {
  const header = 'Timestamp,Application,IP,Host,Method,Path,Status,Protocol,LatencyMs,Threats\n';
  const body = rows
    .map((r) => {
      const threats = r.attacks.map((a) => `${a.category}(${a.severity})`).join('; ');
      const application = resolveApplicationName(r.host, collections);
      return `"${r.timestamp}","${application}","${r.ip}","${r.host ?? ''}","${r.method}","${r.path}",${r.status},"${r.protocol ?? ''}",${r.latencyMs ?? ''},"${threats}"`;
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

function computeStats(rows: LiveLogEntry[], streamConnected: boolean) {
  const now = Date.now();
  const recent = rows.filter((r) => new Date(r.timestamp).getTime() >= now - 60_000);
  const threats = rows.filter((r) => r.attacks.length > 0).length;
  const blockedIps = new Set(rows.filter((r) => r.attacks.length > 0).map((r) => r.ip)).size;
  return { reqPerMin: recent.length, threats, blockedIps, streamConnected };
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* ignore */
  }
}

const METHOD_FILTERS: MethodFilter[] = ['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'OTHER'];

const LiveFeed: React.FC = () => {
  const { connected, recentLogs, clearLogs, seedLogs } = useLiveTraffic();
  const { data: collectionsData } = useApiCollections();
  const collections = useMemo(() => collectionsData?.apiCollections ?? [], [collectionsData?.apiCollections]);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const tableBodyRef = useRef<HTMLDivElement>(null);
  const mobileTableBodyRef = useRef<HTMLDivElement>(null);

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
        userId: d.user_id ? String(d.user_id) : null,
        hasBody: Boolean(d.has_body),
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
        const application = resolveApplicationName(e.host, collections).toLowerCase();
        const hay = `${e.ip} ${e.path} ${e.host ?? ''} ${application} ${e.method} ${e.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recentLogs, severityFilter, methodFilter, searchQuery, collections]);

  const selected = filteredEntries.find((e) => e.id === selectedId) ?? filteredEntries[0] ?? null;
  const selectedApplication = selected ? resolveApplicationName(selected.host, collections) : '';
  const stats = useMemo(() => computeStats(recentLogs, connected), [recentLogs, connected]);
  const newest = recentLogs[0];

  return (
    <div className="space-y-5 w-full max-w-[1600px] p-3 sm:p-4 lg:p-6 pb-10 animate-fade-in mx-auto">
      <PageHeader
        eyebrow="Monitoring"
        title="Live traffic"
        description="Observe HTTP requests captured by the connected eBPF sensor pipeline."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceStamp tone={connected ? 'ok' : 'warn'} pulse>
              {connected ? 'Stream nominal' : 'Reconnecting'}
            </EvidenceStamp>
            {paused && <EvidenceStamp tone="warn">Paused</EvidenceStamp>}
            <span className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
              {filteredEntries.length}/{recentLogs.length} rows
              {newest ? ` · last ${formatRelative(newest.timestamp, now)}` : ''}
            </span>
          </div>
        }
      />

      <div className="evd-ledger">
        <EvidenceLedgerItem icon={Activity} color="var(--evd-signal)" label="Requests / min" value={stats.reqPerMin} />
        <EvidenceLedgerItem icon={Shield} color="var(--evd-critical)" label="Flagged events" value={stats.threats} />
        <EvidenceLedgerItem icon={Ban} color="var(--evd-medium)" label="Flagged IPs" value={stats.blockedIps} />
        <EvidenceLedgerItem icon={Zap} color={stats.streamConnected ? 'var(--evd-low)' : 'var(--evd-medium)'} label="Realtime" value={stats.streamConnected ? 'ON' : 'OFF'} />
      </div>

      <EvidencePanel exhibit="EXH-LIVE">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <EvidenceSectionHead code="§LF" title="Event Stream" desc="HTTP ONLY · WS FRAMES SUPPRESSED" />
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="flex items-center gap-2 px-3 py-1.5 w-full sm:w-auto"
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
              className="flex items-center gap-2 px-3 py-1.5 w-full sm:flex-1 sm:min-w-[180px]"
              style={{ border: '1px solid var(--evd-line)', background: 'var(--evd-panel-raised)' }}
            >
              <Search size={12} style={{ color: 'var(--evd-ink-muted)' }} />
              <input
                type="text"
                placeholder="App, host, path, method…"
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
              onClick={() => exportCsv(filteredEntries, collections)}
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
              mobileTableBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="evd-link mb-3"
          >
            <RefreshCw size={11} /> RESUME LIVE SCROLL
          </button>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div ref={tableBodyRef} onScroll={handleScroll} className="hidden md:block overflow-auto" style={{ maxHeight: 580 }}>
            <table className="evd-table min-w-[720px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  {['Date / time', 'Source IP', 'Method', 'Application', 'Status', 'Proto', 'Latency', 'Threat'].map((h) => (
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
                  const application = resolveApplicationName(entry.host, collections);
                  const pathSummary = summarizePath(entry.path);
                  return (
                    <tr
                      key={entry.id}
                      data-selected={isSelected || undefined}
                      onClick={() => setSelectedId(entry.id)}
                      style={attacks.length ? { background: 'var(--evd-signal-dim)' } : undefined}
                    >
                      <td className="whitespace-nowrap">
                        <div className="evd-mono text-[10px] tabular-nums" title={formatAbsolute(entry.timestamp)}>
                          {formatAbsolute(entry.timestamp)}
                        </div>
                        <div className="evd-mono text-[11px] tabular-nums">{formatClock(entry.timestamp)}</div>
                        <div className="evd-mono text-[10px]" style={{ color: 'var(--evd-ink-muted)' }}>
                          {formatRelative(entry.timestamp, now)}
                        </div>
                      </td>
                      <td className="evd-mono text-[12px] whitespace-nowrap">{entry.ip || '—'}</td>
                      <td>
                        <span className="evd-mono text-[10px] font-bold px-2 py-0.5" style={{ background: mc.bg, color: mc.text }}>
                          {entry.method}
                        </span>
                      </td>
                      <td className="max-w-[340px]">
                        <div className="truncate text-[12px] font-semibold" title={application} style={{ color: 'var(--evd-paper)' }}>
                          {application}
                        </div>
                        <div
                          className="evd-mono text-[11px] truncate"
                          title={entry.path}
                          style={{ color: 'var(--evd-ink-muted)' }}
                        >
                          {pathSummary}
                        </div>
                        {entry.host ? (
                          <div
                            className="evd-mono text-[10px] truncate"
                            title={entry.host}
                            style={{ color: 'var(--evd-ink-muted)' }}
                          >
                            {entry.host}
                          </div>
                        ) : null}
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

          <div className="md:hidden space-y-2" ref={mobileTableBodyRef} onScroll={handleScroll}>
            {initialLoading && recentLogs.length === 0 &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse" style={{ background: 'var(--evd-panel-raised)', border: '1px solid var(--evd-line)' }} />
              ))}
            {!initialLoading && filteredEntries.length === 0 && (
              <div className="p-6 text-center" style={{ border: '1px solid var(--evd-line)' }}>
                <p className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
                  {connected ? 'No HTTP request logs for this tenant yet.' : 'Disconnected — reconnecting…'}
                </p>
              </div>
            )}
            {filteredEntries.map((entry) => {
              const attacks = entry.attacks ?? [];
              const topAttack = attacks[0] ?? null;
              const isSelected = selected?.id === entry.id;
              const application = resolveApplicationName(entry.host, collections);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  className="w-full text-left p-3 transition-colors"
                  style={{
                    border: `1px solid ${isSelected ? 'var(--evd-signal)' : 'var(--evd-line)'}`,
                    background: attacks.length ? 'var(--evd-signal-dim)' : 'var(--evd-panel-raised)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="evd-mono text-[10px] font-bold" style={{ color: methodTone(entry.method).text }}>
                          {entry.method}
                        </span>
                        <span className="evd-mono text-[10px]" style={{ color: statusTone(entry.status) }}>
                          {entry.status || '—'}
                        </span>
                        {entry.hasBody && <span className="evd-badge" style={{ color: 'var(--evd-signal)' }}>BODY</span>}
                      </div>
                      <div className="truncate mt-1 text-[12px] font-semibold" style={{ color: 'var(--evd-paper)' }}>
                        {application}
                      </div>
                      <div className="evd-mono text-[11px] truncate mt-0.5" style={{ color: 'var(--evd-ink-muted)' }}>
                        {summarizePath(entry.path)}
                      </div>
                      <div className="evd-mono text-[10px] truncate mt-1" style={{ color: 'var(--evd-ink-muted)' }}>
                        {entry.host || entry.ip || 'unknown source'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="evd-mono text-[10px]" title={formatAbsolute(entry.timestamp)} style={{ color: 'var(--evd-ink-muted)' }}>
                        {formatAbsolute(entry.timestamp)}
                      </div>
                      <div className="evd-mono text-[10px]" style={{ color: 'var(--evd-ink-muted)' }}>{formatRelative(entry.timestamp, now)}</div>
                      {topAttack && <div className="evd-badge mt-2" style={{ color: severityColor(topAttack.severity) }}>{topAttack.category}</div>}
                    </div>
                  </div>
                </button>
              );
            })}
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
                  <div><dt>Application</dt><dd>{selectedApplication}</dd></div>
                  <div><dt>Observed</dt><dd>{formatAbsolute(selected.timestamp)}</dd></div>
                  <div><dt>Age</dt><dd>{formatRelative(selected.timestamp, now)}</dd></div>
                  <div><dt>Source IP</dt><dd>{selected.ip || '—'}</dd></div>
                  <div><dt>Host</dt><dd className="break-all">{selected.host || '—'}</dd></div>
                  <div><dt>Method</dt><dd>{selected.method}</dd></div>
                  <div><dt>Path</dt><dd className="break-all">{selected.path}</dd></div>
                  <div><dt>Status</dt><dd style={{ color: statusTone(selected.status) }}>{selected.status || '—'}</dd></div>
                  <div><dt>Protocol</dt><dd>{formatProtocol(selected.protocol)}</dd></div>
                  <div><dt>Latency</dt><dd>{formatLatency(selected.latencyMs)}</dd></div>
                  <div><dt>Source</dt><dd>{selected.source || 'ebpf'}</dd></div>
                  <div><dt>Identity</dt><dd className="break-all">{selected.userId || '—'}</dd></div>
                  <div><dt>Evidence</dt><dd>{selected.hasBody ? 'Request/response body captured' : 'Headers and metadata only'}</dd></div>
                  <div>
                    <dt>Threat</dt>
                    <dd>
                      {selected.attacks.length
                        ? selected.attacks.map((a) => `${a.severity} ${a.category}`).join(', ')
                        : 'none'}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
                Select a row to inspect application, host, timing, and threat overlay.
              </p>
            )}
          </aside>
        </div>
      </EvidencePanel>
    </div>
  );
};

export default LiveFeed;
