import React, { useState, useMemo } from 'react';
import { RefreshCw, Filter, Calendar, Users, ShieldBan, ShieldCheck, X } from 'lucide-react';
import TimeFilter from '@/components/shared/TimeFilter';
import DonutChart from '@/components/charts/DonutChart';
import GeoMap from '@/components/charts/GeoMap';
import TableSkeleton from '@/components/shared/TableSkeleton';
import QueryError from '@/components/shared/QueryError';
import MetricWidget from '@/components/ui/MetricWidget';
import GlassCard from '@/components/ui/GlassCard';
import ProgressRing from '@/components/ui/ProgressRing';
import { useThreatActors, useActorsGeoCount, useSeverityCount, useModifyActorStatus } from '@/hooks/use-protection';
import { centroidForCountryCode } from '@/lib/country-centroids';
import { useQueryClient } from '@tanstack/react-query';
import { useThreatActorDetail } from '@/hooks/use-client-activity';
import { ClientActivityDetails, ClientField } from '@/components/shared/ClientActivityDetails';
import { SeverityBadge } from '@/components/shared/Badges';
import type { Severity } from '@/types';

function formatTs(epoch: number) {
  if (!epoch) return '-';
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function daysAgoTs(days: number) {
  return Math.floor((Date.now() - days * 86400_000) / 1000);
}

const ThreatActors: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d'>('24h');
  const [page, setPage] = useState(0);
  const [detailIp, setDetailIp] = useState<string | null>(null);
  const pageSize = 10;
  const qc = useQueryClient();

  const startTs = useMemo(() => daysAgoTs(30), []);
  const endTs = useMemo(() => Math.floor(Date.now() / 1000), []);

  const { data, isLoading, isError, refetch } = useThreatActors(page, pageSize, 'lastSeenAt', -1, undefined, startTs, endTs);
  const geoCount = useActorsGeoCount();
  const sevCount = useSeverityCount(startTs, endTs);
  const { mutate: modifyStatus } = useModifyActorStatus();

  const rows = data?.threatActors ?? [];
  const total = data?.total ?? 0;

  const stateCounts = useMemo(() => {
    const c = { BLOCKED: 0, MONITORED: 0, WHITELISTED: 0 };
    rows.forEach(r => { const s = (r.actorStatus || '').toUpperCase(); if (s in c) c[s as keyof typeof c]++; });
    return c;
  }, [rows]);

  const sev = sevCount.data?.severityCount ?? {};
  const geoThreats = useMemo(() => {
    const entries = Object.entries(geoCount.data?.countPerCountry ?? {});
    return entries
      .map(([countryCode, count]) => {
        const centroid = centroidForCountryCode(countryCode);
        if (!centroid) return null;
        return {
          ...centroid,
          label: countryCode,
          severity: count > 100 ? ('critical' as const) : count > 50 ? ('high' as const) : ('medium' as const),
          count,
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [geoCount.data]);

  return (
    <div className="space-y-5 animate-fade-in w-full pb-10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-text-primary">Threat Actors</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => qc.invalidateQueries({ queryKey: ['protection'] })} className="w-7 h-7 rounded-lg border border-border-subtle bg-bg-surface flex items-center justify-center text-muted-foreground hover:text-brand transition-all outline-none">
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <TimeFilter value={timeRange} onChange={setTimeRange} />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricWidget label="Total Actors" value={total} icon={Users} iconColor="#F97316" iconBg="rgba(249,115,22,0.1)" />

        <GlassCard variant="default" className="p-4 flex items-center gap-4">
          <DonutChart data={[
            { name: 'Blocked', value: stateCounts.BLOCKED, color: '#EF4444' },
            { name: 'Monitored', value: stateCounts.MONITORED, color: '#EAB308' },
            { name: 'Whitelisted', value: stateCounts.WHITELISTED, color: '#22C55E' },
          ]} size={90} innerRadius={28} outerRadius={40} centerValue={total} centerLabel="State" />
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center gap-2"><ShieldBan size={12} className="text-sev-critical" /><span className="text-text-secondary">Blocked:</span><span className="font-bold text-text-primary">{stateCounts.BLOCKED}</span></div>
            <div className="flex items-center gap-2"><Users size={12} className="text-sev-medium" /><span className="text-text-secondary">Monitored:</span><span className="font-bold text-text-primary">{stateCounts.MONITORED}</span></div>
            <div className="flex items-center gap-2"><ShieldCheck size={12} className="text-sev-low" /><span className="text-text-secondary">Whitelisted:</span><span className="font-bold text-text-primary">{stateCounts.WHITELISTED}</span></div>
          </div>
        </GlassCard>

        <GlassCard variant="default" className="p-4 flex items-center gap-4">
          <DonutChart data={[
            { name: 'High', value: sev['HIGH'] ?? sev['CRITICAL'] ?? 0, color: '#EF4444' },
            { name: 'Medium', value: sev['MEDIUM'] ?? 0, color: '#F97316' },
            { name: 'Low', value: sev['LOW'] ?? 0, color: '#EAB308' },
          ]} size={90} innerRadius={28} outerRadius={40} centerLabel="Risk" />
          <div className="space-y-1.5 text-[11px] text-text-muted uppercase font-semibold">Threat Level</div>
        </GlassCard>

        <GeoMap threats={geoThreats} height={150} showControls={false} />
      </div>

      {isError && <QueryError message="Failed to load threat actors" onRetry={() => refetch()} />}

      {/* Table */}
      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden flex flex-col min-h-[400px]">
        <div className="p-3 border-b border-border-subtle flex items-center justify-between">
          <span className="text-sm font-bold text-text-primary flex items-center gap-2">Threats <span className="text-[11px] bg-bg-elevated border border-border-subtle px-2 py-0.5 rounded-full text-text-muted flex items-center gap-1"><Calendar size={10} /> Last 30 Days</span></span>
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>{page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total}</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded-md bg-bg-elevated border border-border-subtle text-[11px] disabled:opacity-30 hover:border-brand/20 transition-all">Prev</button>
              <button disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded-md bg-bg-elevated border border-border-subtle text-[11px] disabled:opacity-30 hover:border-brand/20 transition-all">Next</button>
            </div>
            <button className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated outline-none transition-colors"><Filter size={14} /></button>
          </div>
        </div>

        {isLoading ? <TableSkeleton columns={8} rows={pageSize} /> : (
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse min-w-[650px]">
              <thead className="bg-bg-base/50">
                <tr>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-10"><input type="checkbox" className="accent-brand" /></th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-[20%]">Actor / IP</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-16 text-center">Risk</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-20 text-center">Attempts</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-[22%]">Techniques</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-20">Location</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-28">Actions</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted w-24 text-center">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map(row => {
                  const riskColor = (row.severity || '').toUpperCase() === 'HIGH' || (row.severity || '').toUpperCase() === 'CRITICAL' ? '#EF4444' : '#EAB308';
                  return (
                    <tr
                      key={row.id}
                      className="data-row-interactive hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setDetailIp(row.latestApiIp || row.id)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="accent-brand" /></td>
                      <td className="px-4 py-3 text-[12px] font-mono text-text-primary">{row.latestApiIp || row.id}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: riskColor, background: `${riskColor}12`, border: `1px solid ${riskColor}25` }}>{row.severity || '-'}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-[12px] font-mono font-bold text-text-primary">{row.totalRequests}</td>
                      <td className="px-4 py-3 text-[11px] text-text-muted">{(row.latestApiAttackType || []).join(', ') || '-'}</td>
                      <td className="px-4 py-3 text-[11px] text-text-secondary">{row.country || '-'}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {row.actorStatus === 'BLOCKED' ? (
                          <button onClick={() => modifyStatus({ actorId: row.id, status: 'MONITORING' })} className="text-[11px] font-bold px-2 py-1 rounded-md bg-sev-low/10 text-sev-low border border-sev-low/20 hover:bg-sev-low/20 transition-all">Unblock</button>
                        ) : (
                          <div className="flex gap-1.5">
                            <button onClick={() => modifyStatus({ actorId: row.id, status: 'BLOCKED' })} className="text-[11px] font-bold px-2 py-1 rounded-md bg-sev-critical/10 text-sev-critical border border-sev-critical/20 hover:bg-sev-critical/20 transition-all">Block</button>
                            <button onClick={() => modifyStatus({ actorId: row.id, status: 'WHITELISTED' })} className="text-[11px] font-bold px-2 py-1 rounded-md bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 transition-all">Allow</button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] font-mono text-text-muted text-center">{formatTs(row.lastSeenAt)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !isLoading && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-xs text-text-muted">No threat actors detected.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailIp && <ThreatActorDetailModal ip={detailIp} onClose={() => setDetailIp(null)} />}
    </div>
  );
};

function toBadgeSeverity(value: string | null): Severity {
  const v = (value || '').toLowerCase();
  return (['critical', 'high', 'medium', 'low'].includes(v) ? v : 'info') as Severity;
}

const ThreatActorDetailModal: React.FC<{ ip: string; onClose: () => void }> = ({ ip, onClose }) => {
  const { data, isLoading, isError } = useThreatActorDetail(ip);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-bg-surface border border-border-subtle rounded-xl shadow-2xl animate-slide-up m-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Threat actor ${ip}`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <div>
            <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Threat actor</p>
            <p className="text-sm font-bold font-mono text-text-primary">{ip}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-all" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {isLoading && <p className="text-[11px] text-text-muted">Loading actor details…</p>}
          {isError && <p className="text-[11px] text-text-muted">No recorded traffic or events for this actor.</p>}
          {data && (
            <>
              <dl className="grid gap-2 sm:grid-cols-2">
                <ClientField variant="glass" label="Status">{data.actor.status}</ClientField>
                <ClientField variant="glass" label="Risk score">{data.actor.risk_score ?? '—'}</ClientField>
                <ClientField variant="glass" label="Events">{data.actor.event_count ?? data.events.length}</ClientField>
                <ClientField variant="glass" label="Last seen">
                  {data.actor.last_seen ? new Date(data.actor.last_seen.replace(' ', 'T')).toLocaleString() : '—'}
                </ClientField>
              </dl>
              <div className="rounded-lg border border-border-subtle bg-bg-base p-3">
                <ClientActivityDetails variant="glass" activity={data.client_activity} />
              </div>
              <div>
                <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-2">Security events</p>
                {data.events.length === 0 ? (
                  <p className="text-[11px] text-text-muted">No security events recorded.</p>
                ) : (
                  <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                    {data.events.map((event) => (
                      <li key={event.id} className="flex items-start gap-3 px-3 py-2">
                        <SeverityBadge severity={toBadgeSeverity(event.severity)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-text-primary">{event.category || 'Unclassified'}</p>
                          <p className="text-[11px] font-mono text-text-muted break-all">
                            {event.method} {event.host}{event.url}
                          </p>
                        </div>
                        <span className="text-[11px] font-mono text-text-muted shrink-0">
                          {event.detected_at ? new Date(event.detected_at).toLocaleString() : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThreatActors;
