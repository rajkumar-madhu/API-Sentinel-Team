import React, { useMemo, useState } from 'react';
import {
  Activity, Clock, Globe, Radio, RefreshCw, Shield, ShieldAlert, TrendingUp, Users,
} from 'lucide-react';
import DonutChart from '@/components/charts/DonutChart';
import GeoMap from '@/components/charts/GeoMap';
import TimeFilter from '@/components/shared/TimeFilter';
import QueryError from '@/components/shared/QueryError';
import PageHeader from '@/components/shared/PageHeader';
import { useDashboardKPIs, useIssuesTrend, useSeverityBreakdown } from '@/hooks/use-dashboard';
import { useThreatCategoryCount, useActorsGeoCount } from '@/hooks/use-protection';
import { useTestRuns } from '@/hooks/use-security-ops';
import { centroidForCountryCode } from '@/lib/country-centroids';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { DashboardThreatData } from '@/services/dashboard.service';
import EvidencePanel from '@/components/ui/EvidencePanel';
import EvidenceSectionHead from '@/components/ui/EvidenceSectionHead';
import EvidenceLedgerItem from '@/components/ui/EvidenceLedger';
import EvidenceStamp from '@/components/ui/EvidenceStamp';
import { EvidenceStatLine, EvidenceBarLine } from '@/components/ui/EvidenceStatLine';
import EvidenceTrace from '@/components/ui/EvidenceTrace';
import { useLiveTraffic, useRealtimeStatus } from '@/lib/realtime';
import { formatClock, formatProtocol, formatRelative, methodTone, statusTone } from '@/lib/format';

function daysAgoTs(days: number) {
  return Math.floor((Date.now() - days * 86400_000) / 1000);
}

const Dashboard: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d'>('24h');
  const [activeTab, setActiveTab] = useState<'total' | 'blocked' | 'successful'>('total');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const realtime = useRealtimeStatus();
  const { recentLogs } = useLiveTraffic();

  const days = timeRange === '24h' ? 1 : 7;
  const startTs = useMemo(() => daysAgoTs(days), [days]);
  const endTs = Math.floor(Date.now() / 1000);

  const { issues, endpoints, historical, threats, isLoading } = useDashboardKPIs();
  const issuesTrend = useIssuesTrend(startTs, endTs);
  const sevBreakdown = useSeverityBreakdown();
  const categoryCount = useThreatCategoryCount();
  const geoCount = useActorsGeoCount();
  const testRuns = useTestRuns(25);

  type IssueKpis = NonNullable<typeof issues.data> & {
    highIssues?: number;
    mediumIssues?: number;
    lowIssues?: number;
  };
  type TimelineEntry = { date: string; total: number; blocked: number; successful: number };
  const issueKpis = issues.data as IssueKpis | undefined;
  const threatDataResult: DashboardThreatData = threats.data?.threatData ?? {
    totalActors: 0,
    blockedActors: 0,
    whitelistedActors: 0,
    highActors: 0,
    mediumActors: 0,
    lowActors: 0,
  };
  const historicalData = historical.data;

  const kpi = {
    threatActors: threatDataResult.totalActors,
    blocked: threatDataResult.blockedActors,
    securityEvents: historicalData?.totalThreats ?? 0,
    critical: issues.data?.criticalIssues ?? 0,
    resolved: historicalData?.resolvedIssues ?? 0,
    unauth: historicalData?.unauthApis ?? 0,
    whitelisted: threatDataResult.whitelistedActors,
  };

  const totalIssues =
    (issueKpis?.criticalIssues ?? 0) +
    (issueKpis?.highIssues ?? 0) +
    (issueKpis?.mediumIssues ?? 0) +
    (issueKpis?.lowIssues ?? 0);
  const postureDenom = totalIssues + kpi.resolved;
  const postureScore = postureDenom > 0 ? Math.min(100, Math.round((kpi.resolved / postureDenom) * 100)) : 0;
  const endpointCount = Number(endpoints.data?.endpointsCount ?? 0);
  const needsBaseline = postureDenom === 0 && endpointCount === 0;

  const postureTone =
    postureScore >= 80 ? 'var(--evd-low)' : postureScore >= 50 ? 'var(--evd-medium)' : 'var(--evd-critical)';
  const postureLabel =
    postureScore >= 80 ? 'Hardened' : postureScore >= 50 ? 'Watch' : postureDenom === 0 ? 'No baseline' : 'Exposed';
  const postureStampTone =
    postureScore >= 80 ? 'ok' : postureScore >= 50 ? 'warn' : postureDenom === 0 ? 'warn' : 'signal';

  const runs = testRuns.data?.runs ?? [];
  const testsRun = runs.reduce((sum, run) => sum + Number(run.total_tests || 0), 0);
  const vulnsFound = runs.reduce((sum, run) => sum + Number(run.vulnerable_count || 0), 0);
  const lastRunAt = runs
    .map((run) => run.completed_at || run.started_at || run.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const lastRunLabel = lastRunAt
    ? new Date(lastRunAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

  const threatData = [
    { name: 'High', value: threatDataResult.highActors, color: 'var(--evd-high)' },
    { name: 'Medium', value: threatDataResult.mediumActors, color: 'var(--evd-medium)' },
    { name: 'Low', value: threatDataResult.lowActors, color: 'var(--evd-low)' },
  ];

  const timelineData = useMemo<TimelineEntry[]>(() => {
    const trend = issuesTrend.data?.issuesTrend;
    if (trend && trend.length > 0) {
      return trend.map((d) => ({
        date: new Date(d.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        total: d.total ?? d.count ?? 0,
        blocked: d.blocked ?? 0,
        successful: d.successful ?? 0,
      }));
    }
    return [];
  }, [issuesTrend.data]);

  const categories = Object.entries(categoryCount.data?.categoryCount ?? {});
  const topCategories = categories.sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCatVal = topCategories.length > 0 ? (topCategories[0][1] as number) : 1;

  const geoThreats = useMemo(() => {
    const countryCounts = geoCount.data?.countPerCountry || {};
    return Object.entries(countryCounts)
      .map(([country, count]) => {
        const coords = centroidForCountryCode(country);
        if (!coords) return null;
        return {
          lat: coords.lat,
          lng: coords.lng,
          severity: count > 100 ? ('critical' as const) : count > 50 ? ('high' as const) : ('medium' as const),
          count,
          country,
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null);
  }, [geoCount.data]);

  const hasError = issues.isError || endpoints.isError;
  const windowLabel = timeRange === '24h' ? 'Last 24 hours' : 'Last 7 days';
  const asOfLabel = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const ring = 2 * Math.PI * 46;
  const openCritical = Number(kpi.critical) || 0;
  const liveRows = recentLogs.slice(0, 8);

  const heroTitle = needsBaseline
    ? 'Connect traffic to build a baseline'
    : postureDenom === 0
      ? 'Inventory is live — waiting on findings'
      : openCritical > 0
        ? `${openCritical} critical finding${openCritical === 1 ? '' : 's'} still open`
        : totalIssues > 0
          ? `${totalIssues} open finding${totalIssues === 1 ? '' : 's'} under watch`
          : 'No open findings in this window';

  const heroBody = needsBaseline
    ? 'Posture score needs real inventory and findings. Ship sensor traffic or import APIs, then run a confirmatory scan.'
    : 'Score = resolved ÷ (open + resolved). Endpoint and actor counts are live inventory — not demo placeholders.';

  return (
    <div className="mx-auto w-full max-w-[1600px] min-w-0 animate-fade-in space-y-5 pb-10">
      <PageHeader
        eyebrow="Operations"
        title="Security posture"
        description="What is open, what is resolved, and what traffic is landing right now."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceStamp tone={realtime.connected ? 'ok' : 'warn'} pulse>
              {realtime.connected ? 'Stream live' : 'Reconnecting'}
            </EvidenceStamp>
            <EvidenceStamp tone={postureStampTone}>{postureLabel}</EvidenceStamp>
            <span className="evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
              as of {asOfLabel}
            </span>
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: ['dashboard'] })}
              className="evd-btn"
              aria-label="Refresh dashboard data"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <TimeFilter value={timeRange} onChange={setTimeRange} />
          </div>
        }
      />

      {hasError && (
        <QueryError
          message="Failed to load dashboard data. Backend may be offline."
          onRetry={() => qc.invalidateQueries({ queryKey: ['dashboard'] })}
        />
      )}

      <section className="evd-hero" aria-label="Posture overview">
        <div className="evd-hero-copy">
          <p className="evd-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--evd-ink-muted)' }}>
            Posture · {windowLabel}
          </p>
          <h2 className="evd-display text-[1.75rem] leading-tight text-[var(--evd-paper)]">
            {heroTitle}
          </h2>
          <p className="max-w-xl text-sm leading-6" style={{ color: 'var(--evd-ink)' }}>
            {heroBody}
          </p>
          {needsBaseline ? (
            <div className="evd-next-steps">
              <button type="button" className="evd-next-step" onClick={() => navigate('/app/live')}>
                <span className="evd-next-step-index">01 · Sensor</span>
                <span className="evd-next-step-title">Watch live traffic</span>
                <span className="evd-next-step-body">Confirm the eBPF stream is shipping HTTP to this workspace.</span>
              </button>
              <button type="button" className="evd-next-step" onClick={() => navigate('/app/discovery')}>
                <span className="evd-next-step-index">02 · Inventory</span>
                <span className="evd-next-step-title">Open API catalogue</span>
                <span className="evd-next-step-body">Review discovered hosts and paths once traffic lands.</span>
              </button>
              <button type="button" className="evd-next-step" onClick={() => navigate('/app/testing')}>
                <span className="evd-next-step-index">03 · Testing</span>
                <span className="evd-next-step-title">Run confirmatory tests</span>
                <span className="evd-next-step-body">Findings populate posture only after scans or detections.</span>
              </button>
            </div>
          ) : (
            <div className="evd-hero-meta">
              <button type="button" className="evd-link" onClick={() => navigate('/app/organization')}>
                Attention inbox
              </button>
              <button type="button" className="evd-link" onClick={() => navigate('/app/alerts')}>
                Review alerts
              </button>
              <button type="button" className="evd-link" onClick={() => navigate('/app/live')}>
                Live feed
              </button>
            </div>
          )}
        </div>

        <div className="evd-hero-score">
          <div className="relative inline-flex h-[112px] w-[112px] shrink-0 items-center justify-center">
            <svg width={112} height={112} className="evd-score-ring -rotate-90" aria-hidden>
              <circle cx={56} cy={56} r={46} fill="none" stroke="var(--evd-line)" strokeWidth={8} />
              <circle
                cx={56}
                cy={56}
                r={46}
                fill="none"
                stroke={postureDenom === 0 ? 'var(--evd-ink-muted)' : postureTone}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - postureScore / 100)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[1.75rem] font-bold tabular-nums text-[var(--evd-paper)]">{postureScore}</span>
              <span className="evd-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--evd-ink-muted)' }}>
                Score
              </span>
            </div>
          </div>
          <div className="min-w-[150px]">
            <p className="text-sm font-semibold text-[var(--evd-paper)]">{postureLabel}</p>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--evd-ink-muted)' }}>
              {kpi.resolved.toLocaleString()} resolved · {totalIssues.toLocaleString()} open
            </p>
            <p className="mt-2 evd-mono text-[11px]" style={{ color: 'var(--evd-ink-muted)' }}>
              {endpointCount.toLocaleString()} endpoints inventoried
            </p>
          </div>
        </div>
      </section>

      <div className="evd-ledger min-w-0">
        <EvidenceLedgerItem
          icon={ShieldAlert}
          color="var(--evd-critical)"
          label="Critical"
          value={openCritical}
          hint={openCritical === 0 ? 'None open' : 'Needs triage'}
          onClick={() => navigate('/app/alerts')}
        />
        <EvidenceLedgerItem
          icon={Activity}
          color="var(--evd-medium)"
          label="Open issues"
          value={totalIssues}
          hint={totalIssues === 0 ? 'Clean slate' : 'Across severities'}
          onClick={() => navigate('/app/alerts')}
        />
        <EvidenceLedgerItem
          icon={TrendingUp}
          color="var(--evd-low)"
          label="Resolved"
          value={Number(kpi.resolved) || 0}
          hint="Closed findings"
          onClick={() => navigate('/app/reports')}
        />
        <EvidenceLedgerItem
          icon={Globe}
          color="var(--evd-info)"
          label="Endpoints"
          value={endpointCount}
          hint={endpointCount === 0 ? 'Awaiting discovery' : 'In catalogue'}
          onClick={() => navigate('/app/discovery')}
        />
        <EvidenceLedgerItem
          icon={Shield}
          color="var(--evd-signal)"
          label="Blocked"
          value={Number(kpi.blocked) || 0}
          hint="Enforced actors"
          onClick={() => navigate('/app/blocklist')}
        />
        <EvidenceLedgerItem
          icon={Users}
          color="var(--evd-high)"
          label="Actors"
          value={Number(kpi.threatActors) || 0}
          hint={Number(kpi.threatActors) === 0 ? 'No actors yet' : 'Tracked sources'}
          onClick={() => navigate('/app/protection')}
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <EvidencePanel exhibit="EXH-MIX" className="min-w-0">
          <EvidenceSectionHead
            code="§MIX"
            title="Detection mix"
            desc={topCategories.length ? `${topCategories.length} categories` : 'Idle'}
          />
          {topCategories.length > 0 ? (
            topCategories.map(([name, count]) => (
              <EvidenceBarLine key={String(name)} label={String(name)} value={Number(count)} max={maxCatVal} />
            ))
          ) : (
            <div className="evd-empty">
              <p className="evd-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--evd-signal)' }}>
                No detections yet
              </p>
              <p className="text-sm font-medium text-[var(--evd-paper)]">Waiting on traffic or scans</p>
              <p className="max-w-sm text-xs leading-5" style={{ color: 'var(--evd-ink-muted)' }}>
                Categories fill when the pipeline classifies attacks from live requests or confirmatory tests.
              </p>
              <button type="button" className="evd-link mt-1" onClick={() => navigate('/app/protection')}>
                Open protection
              </button>
            </div>
          )}
        </EvidencePanel>

        <EvidencePanel exhibit="EXH-ACT" className="min-w-0">
          <EvidenceSectionHead
            code="§ACT"
            title="Threat actors"
            action={
              <button type="button" onClick={() => navigate('/app/protection')} className="evd-link">
                Details
              </button>
            }
          />
          <div className="flex min-w-0 items-center gap-4">
            <DonutChart
              data={threatData}
              centerValue={Number(kpi.threatActors) || 0}
              centerLabel="Total"
              size={112}
              innerRadius={34}
              outerRadius={50}
            />
            <div className="min-w-0 flex-1">
              {threatData.map((d) => (
                <EvidenceStatLine key={d.name} label={d.name} value={d.value} dot={d.color} />
              ))}
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--evd-ink-muted)' }}>
                Allowlisted {kpi.whitelisted} · Unauthenticated APIs {kpi.unauth}
              </p>
            </div>
          </div>
        </EvidencePanel>

        <EvidencePanel exhibit="EXH-TST" className="min-w-0">
          <EvidenceSectionHead
            code="§TST"
            title="Testing"
            action={
              <button type="button" onClick={() => navigate('/app/testing')} className="evd-link">
                View
              </button>
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <StatBlock label="Tests run" value={testsRun} />
            <StatBlock label="Vulnerabilities" value={vulnsFound} tone="var(--evd-critical)" />
            <StatBlock label="Recent runs" value={runs.length} />
            <StatBlock label="Last run" value={lastRunLabel} />
          </div>
          {runs.length === 0 && (
            <p className="mt-4 text-xs leading-5" style={{ color: 'var(--evd-ink-muted)' }}>
              No confirmatory runs yet. Launch a scan from Testing to seed findings.
            </p>
          )}
        </EvidencePanel>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
        <EvidencePanel exhibit="EXH-GEO" className="min-w-0 overflow-hidden p-0 lg:col-span-7">
          <div className="px-5 pt-4">
            <EvidenceSectionHead
              code="§GEO"
              title="Actor geography"
              desc={geoThreats.length ? `${geoThreats.length} countries` : 'No geo hits'}
            />
          </div>
          <GeoMap threats={geoThreats} height={260} />
        </EvidencePanel>

        <EvidencePanel exhibit="EXH-EVT" className="min-w-0 lg:col-span-5">
          <EvidenceSectionHead code="§EVT" title="Security events" desc={windowLabel} />
          <p className="mb-1 text-4xl font-bold tabular-nums tracking-tight text-[var(--evd-paper)]">
            {Number(kpi.securityEvents).toLocaleString()}
          </p>
          <p className="mb-5 text-xs leading-5" style={{ color: 'var(--evd-ink-muted)' }}>
            Detected or blocked events in the selected window
          </p>
          <div className="grid grid-cols-2 gap-y-4">
            <StatBlock label="Blocked" value={historicalData?.blockedThreats ?? 0} tone="var(--evd-critical)" small />
            <StatBlock label="High" value={sevBreakdown.data?.severityCount?.HIGH ?? 0} tone="var(--evd-high)" small />
            <StatBlock label="Medium" value={sevBreakdown.data?.severityCount?.MEDIUM ?? 0} tone="var(--evd-medium)" small />
            <StatBlock label="Low" value={sevBreakdown.data?.severityCount?.LOW ?? 0} tone="var(--evd-info)" small />
          </div>
        </EvidencePanel>
      </div>

      <EvidencePanel exhibit="EXH-TRD" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <EvidenceSectionHead code="§TRD" title="Event trend" desc={windowLabel} />
          <div className="flex flex-wrap gap-1">
            {([
              { key: 'total', label: 'Total' },
              { key: 'blocked', label: 'Blocked' },
              { key: 'successful', label: 'Successful' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className="evd-tab"
                data-active={activeTab === tab.key}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {timelineData.length > 0 ? (
          <EvidenceTrace
            data={timelineData.map((d) => ({ date: d.date, value: d[activeTab] }))}
            color={
              activeTab === 'total'
                ? 'var(--evd-signal)'
                : activeTab === 'blocked'
                  ? 'var(--evd-critical)'
                  : 'var(--evd-low)'
            }
            height={180}
          />
        ) : (
          <div className="evd-empty">
            <p className="evd-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--evd-signal)' }}>
              Empty window
            </p>
            <p className="text-sm font-medium text-[var(--evd-paper)]">No trend points in {windowLabel.toLowerCase()}</p>
            <p className="text-xs leading-5" style={{ color: 'var(--evd-ink-muted)' }}>
              The chart fills after detections or blocked events accumulate for this range.
            </p>
          </div>
        )}
      </EvidencePanel>

      <EvidencePanel exhibit="EXH-LIV" className="min-w-0">
        <EvidenceSectionHead
          code="§LIV"
          title="Live traffic"
          desc={realtime.connected ? 'Stream open' : 'Reconnecting'}
          action={
            <button type="button" onClick={() => navigate('/app/live')} className="evd-link">
              Full feed
            </button>
          }
        />
        {liveRows.length > 0 ? (
          <div className="evd-table-wrap overflow-x-auto">
            <table className="evd-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {liveRows.map((entry) => {
                  const threat = entry.attacks?.[0];
                  const mc = methodTone(entry.method);
                  return (
                    <tr key={entry.id} onClick={() => navigate('/app/live')} className="cursor-pointer">
                      <td className="font-mono text-xs tabular-nums">{formatClock(entry.timestamp)}</td>
                      <td>
                        <span
                          className="inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                          style={{ background: mc.bg, color: mc.text }}
                        >
                          {entry.method}
                        </span>
                      </td>
                      <td className="max-w-[320px] truncate font-mono text-xs">
                        {entry.host ? `${entry.host}${entry.path}` : entry.path}
                        <span className="ml-2" style={{ color: 'var(--evd-ink-muted)' }}>
                          {formatProtocol(entry.protocol)}
                        </span>
                      </td>
                      <td
                        className="font-mono text-xs"
                        style={{ color: threat ? 'var(--evd-critical)' : statusTone(entry.status) }}
                      >
                        {threat ? threat.category : entry.status}
                      </td>
                      <td className="text-xs" style={{ color: 'var(--evd-ink-muted)' }}>
                        {formatRelative(entry.timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : timelineData.length > 0 ? (
          <div className="space-y-1">
            {timelineData.slice(-5).reverse().map((entry, i) => (
              <div key={`${entry.date}-${i}`} className="flex min-w-0 items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm" style={{ color: 'var(--evd-ink)' }}>
                  <Clock size={12} className="shrink-0" style={{ color: 'var(--evd-ink-muted)' }} />
                  <span className="tabular-nums" style={{ color: 'var(--evd-ink-muted)' }}>{entry.date}</span>
                  <span className="truncate">
                    {entry.total} events ({entry.blocked} blocked)
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="evd-empty">
            <Radio size={18} style={{ color: 'var(--evd-signal)' }} />
            <p className="text-sm font-medium text-[var(--evd-paper)]">
              {realtime.connected ? 'Stream open — waiting for frames' : 'No live frames yet'}
            </p>
            <p className="text-xs leading-5" style={{ color: 'var(--evd-ink-muted)' }}>
              Rows appear here as soon as the sensor posts HTTP traffic for this tenant.
            </p>
            <button type="button" className="evd-link mt-1" onClick={() => navigate('/app/live')}>
              Open live feed
            </button>
          </div>
        )}
      </EvidencePanel>
    </div>
  );
};

const StatBlock: React.FC<{
  label: string;
  value: React.ReactNode;
  tone?: string;
  small?: boolean;
}> = ({ label, value, tone, small }) => (
  <div className="min-w-0">
    <p className="mb-1 text-xs" style={{ color: 'var(--evd-ink-muted)' }}>{label}</p>
    <p
      className={`truncate font-semibold tabular-nums ${small ? 'text-sm' : 'text-xl'}`}
      style={{ color: tone || 'var(--evd-paper)' }}
    >
      {value}
    </p>
  </div>
);

export default Dashboard;
