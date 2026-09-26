import React, { useState, useMemo } from 'react';
import { RefreshCw, Download, Filter, Calendar, Shield, Zap, AlertTriangle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Toggle } from '@/components/shared/Toggle';
import TimeFilter from '@/components/shared/TimeFilter';
import DonutChart from '@/components/charts/DonutChart';
import AreaChartComponent from '@/components/charts/AreaChart';
import { SeverityBadge, MethodBadge } from '@/components/shared/Badges';
import TableSkeleton from '@/components/shared/TableSkeleton';
import QueryError from '@/components/shared/QueryError';
import MetricWidget from '@/components/ui/MetricWidget';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedCounter from '@/components/ui/AnimatedCounter';
import ResponseActions from '@/components/widgets/ResponseActions';
import { useSecurityEvents, useSeverityCount, useThreatCategoryCount } from '@/hooks/use-protection';
import { useQueryClient } from '@tanstack/react-query';
import type { AktoMaliciousEvent } from '@/services/protection.service';
import { useSecurityEventDetail } from '@/hooks/use-client-activity';
import { ClientActivityDetails, ClientField, RequestClientFields } from '@/components/shared/ClientActivityDetails';

function formatTs(epoch: number) {
  if (!epoch) return '-';
  const d = new Date(epoch > 1e10 ? epoch : epoch * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function mapSev(s: string): 'critical' | 'major' | 'medium' | 'low' | 'info' {
  const l = (s || '').toLowerCase();
  if (l === 'critical' || l === 'high') return 'critical';
  if (l === 'major' || l === 'medium') return 'major';
  if (l === 'minor' || l === 'low') return 'low';
  return 'info';
}

function daysAgoTs(days: number) {
  return Math.floor((Date.now() - days * 86400_000) / 1000);
}

const sevBorderColors: Record<string, string> = { critical: '#EF4444', major: '#632CA6', medium: '#EAB308', low: '#22C55E', info: '#3B82F6' };

/** Client, application, and payload context for one event (loaded on open). */
const SecurityEventClientSection: React.FC<{ eventId: string; fallbackIp: string }> = ({ eventId, fallbackIp }) => {
  const { data, isLoading, isError } = useSecurityEventDetail(eventId);
  if (isLoading) {
    return <p className="text-[11px] text-text-muted">Loading client details…</p>;
  }
  if (isError || !data) {
    return (
      <dl className="grid gap-2">
        <ClientField variant="glass" label="Source IP">{fallbackIp}</ClientField>
      </dl>
    );
  }
  const { event, request, client_activity: activity } = data;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-subtle bg-bg-base p-3 space-y-3">
        <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Client & application</p>
        {request ? (
          <RequestClientFields variant="glass" log={request} />
        ) : (
          <dl className="grid gap-2">
            <ClientField variant="glass" label="Client IP">{event.ip || '—'}</ClientField>
            <ClientField variant="glass" label="Host">{event.host || '—'}</ClientField>
          </dl>
        )}
        <dl className="grid gap-2">
          {event.session_id && <ClientField variant="glass" label="Session">{event.session_id}</ClientField>}
          {event.context_source && <ClientField variant="glass" label="Detected by">{event.context_source}</ClientField>}
          {(event.country_code || event.dest_country_code) && (
            <ClientField variant="glass" label="Geo">
              {[event.country_code, event.dest_country_code].filter(Boolean).join(' → ')}
            </ClientField>
          )}
          {event.successful_exploit && <ClientField variant="glass" label="Exploit">Confirmed successful</ClientField>}
        </dl>
      </div>
      {event.payload && (
        <div>
          <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-2">Payload (redacted)</p>
          <pre className="max-h-40 overflow-auto rounded-lg border border-border-subtle bg-bg-base p-3 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all">
            {event.payload}
          </pre>
        </div>
      )}
      {activity && activity.request_count > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-base p-3">
          <ClientActivityDetails variant="glass" activity={activity} />
        </div>
      )}
    </div>
  );
};

const SecurityEvents: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d'>('24h');
  const [showResolved, setShowResolved] = useState(false);
  const [showAgg, setShowAgg] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<AktoMaliciousEvent | null>(null);
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const pageSize = 10;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const days = timeRange === '24h' ? 1 : 7;
  const startTs = useMemo(() => daysAgoTs(days === 1 ? 90 : 7), [days]);
  const endTs = useMemo(() => Math.floor(Date.now() / 1000), []);

  const { data, isLoading, isError, refetch } = useSecurityEvents(page, pageSize, 'timestamp', -1, undefined, startTs, endTs);
  const sevCount = useSeverityCount();
  const categoryCount = useThreatCategoryCount();

  const rows = data?.securityEvents ?? [];
  const total = data?.total ?? 0;
  const sc = sevCount.data?.severityCount ?? {};

  // Filter rows based on showResolved toggle
  const filteredRows = useMemo(() => {
    if (!showResolved) {
      // Filter out resolved/closed events (assuming status field exists)
      return rows.filter((r) => !r.status || r.status !== 'RESOLVED');
    }
    return rows;
  }, [rows, showResolved]);

  // Export handler
  const handleExport = () => {
    const csvHeaders = ['Severity', 'Action', 'Method', 'Endpoint', 'Timestamp', 'Category', 'Sub Category', 'Summary'];
    const csvRows = filteredRows.map((row) => [
      row.severity,
      row.action || 'DETECTED',
      row.method || 'GET',
      row.url,
      formatTs(row.timestamp),
      row.category,
      row.subCategory,
      row.description,
    ].map(v => `"${v}"`).join(','));
    const csv = [csvHeaders.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security-events-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Real layer split based on actual detection categories
  const layerSplit = useMemo(() => {
    const cats = Object.entries(categoryCount.data?.categoryCount || {});
    const totalCategorized = cats.reduce((sum, [, cnt]) => sum + cnt, 0);
    
    // Map categories to detection layers
    const layers = {
      realtime: 0,
      slidingWindow: 0,
      longWindowML: 0,
      businessLogic: 0,
      agentic: 0,
    };

    cats.forEach(([cat, cnt]) => {
      const c = (cat || '').toLowerCase();
      if (c.includes('injection') || c.includes('xss') || c.includes('traversal')) {
        layers.realtime += cnt;
      } else if (c.includes('rate') || c.includes('brute') || c.includes('auth')) {
        layers.slidingWindow += cnt;
      } else if (c.includes('behavior') || c.includes('anomal')) {
        layers.longWindowML += cnt;
      } else if (c.includes('business') || c.includes('logic') || c.includes('transition')) {
        layers.businessLogic += cnt;
      } else if (c.includes('mcp') || c.includes('agent') || c.includes('prompt')) {
        layers.agentic += cnt;
      } else {
        // Default to realtime for unknown categories
        layers.realtime += cnt;
      }
    });

    return [
      { label: 'Real-time Rules', value: layers.realtime, color: '#632CA6' },
      { label: 'Sliding Window', value: layers.slidingWindow, color: '#3B82F6' },
      { label: 'Long-Window ML', value: layers.longWindowML, color: '#EAB308' },
      { label: 'Business Logic', value: layers.businessLogic, color: '#F97316' },
      { label: 'MCP / Agentic', value: layers.agentic, color: '#22C55E' },
    ].filter(l => l.value > 0);
  }, [categoryCount.data]);

  const sevData = [
    { name: 'Critical', value: sc.CRITICAL ?? sc.HIGH ?? 0, color: '#EF4444' },
    { name: 'Major', value: sc.MEDIUM ?? 0, color: '#F97316' },
    { name: 'Minor', value: sc.LOW ?? 0, color: '#EAB308' },
    { name: 'Info', value: sc.INFO ?? 0, color: '#22C55E' },
  ];
  const totalEvents = filteredRows.length || sevData.reduce((s, d) => s + d.value, 0);

  const categories = Object.entries(categoryCount.data?.categoryCount ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCat = categories.length > 0 ? (categories[0][1] as number) : 1;

  return (
    <div className="space-y-5 animate-fade-in w-full pb-10">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Toggle checked={showResolved} onChange={setShowResolved} label="Show Resolved" />
          <Toggle checked={showAgg} onChange={setShowAgg} label="Aggregated" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="w-7 h-7 rounded-lg border border-border-subtle bg-bg-surface flex items-center justify-center text-muted-foreground hover:text-brand transition-all outline-none">
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <TimeFilter value={timeRange} onChange={setTimeRange} />
          <button onClick={handleExport} className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-all outline-none"><Download size={13} /> Export</button>
          <button onClick={() => setShowFilterModal(true)} className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-all outline-none"><Filter size={13} /> Filter</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricWidget label="Total Events" value={totalEvents} icon={Zap} iconColor="#F97316" iconBg="rgba(249,115,22,0.1)" />

        <GlassCard variant="default" className="p-4 flex items-center gap-4">
          <DonutChart data={sevData} size={90} innerRadius={28} outerRadius={40} centerValue={totalEvents} centerLabel="Total" />
          <div className="flex-1 space-y-1.5">
            <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Severity</span>
            {sevData.map(d => (
              <div key={d.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm" style={{ background: d.color }} /><span className="text-[11px] text-text-secondary">{d.name}</span></div>
                <span className="text-[11px] font-bold text-text-primary tabular-nums">{d.value}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard variant="default" className="p-4">
          <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Top Categories</span>
          <div className="mt-2 space-y-2">
            {categories.map(([cat, cnt]) => (
              <div key={cat} className="space-y-0.5">
                <div className="flex justify-between items-center"><span className="text-[11px] text-text-secondary truncate max-w-[140px]">{cat}</span><span className="text-[11px] font-bold text-brand tabular-nums">{cnt}</span></div>
                <div className="h-1 bg-black/[0.04] rounded-full overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-light transition-all duration-700" style={{ width: `${(cnt / maxCat) * 100}%` }} /></div>
              </div>
            ))}
            {categories.length === 0 && <p className="text-xs text-text-muted mt-2">No data</p>}
          </div>
        </GlassCard>
      </div>

      {/* Detection Layers */}
      <GlassCard variant="default" className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Detection Layers</span>
          <span className="text-[11px] text-text-muted bg-bg-elevated border border-border-subtle px-2 py-0.5 rounded-full">Estimate by pipeline stage</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {layerSplit.map(layer => {
            const pct = totalEvents > 0 ? Math.round((layer.value / totalEvents) * 100) : 0;
            return (
              <div key={layer.label} className="metric-card p-3">
                <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">{layer.label}</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: layer.color }}>{layer.value}</p>
                <div className="h-1.5 bg-black/[0.04] rounded-full overflow-hidden mt-2">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: layer.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {isError && <QueryError message="Failed to load security events" onRetry={() => refetch()} />}

      {/* Table */}
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-bold text-text-primary flex items-center gap-2">Security Events <span className="text-[11px] bg-bg-elevated border border-border-subtle px-2 py-0.5 rounded-full text-text-muted flex items-center gap-1"><Calendar size={10} /> Last 90 days</span></span>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>{page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredRows.length)} of {filteredRows.length}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded-md bg-bg-elevated border border-border-subtle text-[11px] disabled:opacity-30 hover:border-brand/20 transition-all">Prev</button>
            <button disabled={(page + 1) * pageSize >= filteredRows.length} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded-md bg-bg-elevated border border-border-subtle text-[11px] disabled:opacity-30 hover:border-brand/20 transition-all">Next</button>
          </div>
          <button onClick={() => setShowFilterModal(true)} className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated outline-none transition-colors"><Filter size={14} /></button>
        </div>
      </div>

      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden flex flex-col min-h-[400px]">
        {isLoading ? <TableSkeleton columns={8} rows={pageSize} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead className="bg-bg-base/50">
                <tr>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-20">Severity</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-20">Action</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-[28%]">Endpoint</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-28">Timestamp</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-24">Category</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-24">Sub Category</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-[24%]">Summary</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-16">ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredRows.slice(page * pageSize, (page + 1) * pageSize).map((row) => {
                  const sev = mapSev(row.severity);
                  return (
                    <tr 
                      key={row.id} 
                      className="data-row-interactive hover:bg-white/[0.02] transition-colors cursor-pointer"
                      style={{ borderLeftColor: sevBorderColors[sev] || 'transparent' }}
                      onClick={() => {
                        setSelectedEvent(row);
                        setShowDetailsPanel(true);
                      }}
                    >
                      <td className="px-4 py-3"><SeverityBadge severity={sev} /></td>
                      <td className="px-4 py-3"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${row.action === 'BLOCKED' ? 'bg-sev-critical/10 text-sev-critical border border-sev-critical/20' : 'bg-sev-info/10 text-sev-info border border-sev-info/20'}`}>{row.action || 'DETECTED'}</span></td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><MethodBadge method={row.method || 'GET'} /><span className="text-[12px] font-mono text-text-primary truncate">{row.url}</span></div></td>
                      <td className="px-4 py-3 text-[11px] font-mono text-text-muted">{formatTs(row.timestamp)}</td>
                      <td className="px-4 py-3 text-[11px] text-text-secondary">{row.category}</td>
                      <td className="px-4 py-3 text-[11px] text-text-secondary">{row.subCategory}</td>
                      <td className="px-4 py-3 text-[11px] text-text-muted truncate">{row.description}</td>
                      <td className="px-4 py-3 text-[11px] font-mono text-text-muted">{row.eventId?.substring(0, 8)}</td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && !isLoading && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-xs text-text-muted">No security events found in this time range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event Details Side Panel */}
      {showDetailsPanel && selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowDetailsPanel(false)}>
          <div 
            className="w-full max-w-2xl bg-bg-surface border border-border-subtle rounded-xl shadow-2xl animate-slide-up m-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <SeverityBadge severity={mapSev(selectedEvent.severity)} />
                <span className="text-sm font-bold text-text-primary">{selectedEvent.category}</span>
              </div>
              <button 
                onClick={() => setShowDetailsPanel(false)}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-all"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Endpoint</p>
                  <p className="text-sm text-text-primary mt-1 font-mono">{selectedEvent.method} {selectedEvent.url}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Timestamp</p>
                  <p className="text-sm text-text-primary mt-1 font-mono">{formatTs(selectedEvent.timestamp)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Category</p>
                  <p className="text-sm text-text-primary mt-1">{selectedEvent.category}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Sub Category</p>
                  <p className="text-sm text-text-primary mt-1">{selectedEvent.subCategory}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Action</p>
                  <p className="text-sm text-text-primary mt-1">{selectedEvent.action || 'DETECTED'}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Event ID</p>
                  <p className="text-sm text-text-primary mt-1 font-mono">{selectedEvent.eventId}</p>
                </div>
              </div>

              {selectedEvent.description && (
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-2">Summary</p>
                  <p className="text-sm text-text-secondary">{selectedEvent.description}</p>
                </div>
              )}

              <SecurityEventClientSection eventId={selectedEvent.id} fallbackIp={selectedEvent.ip} />

              {/* Response Actions */}
              <ResponseActions
                actorIp={selectedEvent.ip}
                eventId={selectedEvent.id}
                severity={selectedEvent.severity}
                onActionComplete={() => {
                  setShowDetailsPanel(false);
                  refetch();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowFilterModal(false)}>
          <div className="w-full max-w-md bg-bg-surface border border-border-subtle rounded-xl shadow-2xl p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">Filter Security Events</h3>
              <button onClick={() => setShowFilterModal(false)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-all">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Severity</label>
                <select className="w-full mt-1 px-3 py-2 rounded-lg bg-bg-base border border-border-subtle text-sm text-text-primary outline-none focus:border-brand/20">
                  <option value="">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="major">Major</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Category</label>
                <select className="w-full mt-1 px-3 py-2 rounded-lg bg-bg-base border border-border-subtle text-sm text-text-primary outline-none focus:border-brand/20">
                  <option value="">All Categories</option>
                  {categories.map(([cat]) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-4">
                <button onClick={() => setShowFilterModal(false)} className="flex-1 px-4 py-2 rounded-lg bg-bg-elevated text-text-secondary hover:text-text-primary border border-border-subtle transition-all text-sm font-semibold">Cancel</button>
                <button onClick={() => setShowFilterModal(false)} className="flex-1 px-4 py-2 rounded-lg bg-brand text-white hover:bg-brand/90 transition-all text-sm font-semibold">Apply Filters</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityEvents;
