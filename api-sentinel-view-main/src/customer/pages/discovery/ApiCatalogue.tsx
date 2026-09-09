import React, { useCallback, useState, useMemo, useRef } from 'react';
import { RefreshCw, Download, Globe, Eye, ShieldOff, Upload, Search, X, GitBranch, FileCheck, KeyRound, Ghost } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DonutChart from '@/components/charts/DonutChart';
import TimeFilter from '@/components/shared/TimeFilter';
import { MethodBadge, AuthBadge } from '@/components/shared/Badges';
import TableSkeleton from '@/components/shared/TableSkeleton';
import QueryError from '@/components/shared/QueryError';
import PageHeader from '@/components/shared/PageHeader';
import EvidencePanel from '@/components/ui/EvidencePanel';
import EvidenceSectionHead from '@/components/ui/EvidenceSectionHead';
import EvidenceLedgerItem from '@/components/ui/EvidenceLedger';
import { EvidenceStatLine, EvidenceBarLine } from '@/components/ui/EvidenceStatLine';
import { useApiCollections, useApiInfos, useSeverityCounts } from '@/hooks/use-discovery';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { fetchWithSession } from '@/lib/api-client';
import type { AktoApiCollection, AktoApiInfo } from '@/services/discovery.service';

function formatTs(epoch: number) {
  if (!epoch) return '-';
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function mapRiskScore(score: number | undefined): string {
  if (!score && score !== 0) return '-';
  if (score >= 4) return 'Critical';
  if (score >= 3) return 'High';
  if (score >= 2) return 'Medium';
  return 'Low';
}

function riskColor(label: string): string {
  switch (label) {
    case 'Critical': return '#EF4444';
    case 'High': return '#F97316';
    case 'Medium': return '#EAB308';
    default: return '#22C55E';
  }
}

const typeColors: Record<string, string> = {
  REST: '#3B82F6',
  GRAPHQL: '#632CA6',
  GRPC: '#22C55E',
  MCP: '#EAB308',
  WEBSOCKET: '#F97316',
  UNKNOWN: '#6B7280',
};

function inferApiType(url: string): keyof typeof typeColors {
  const u = (url || '').toLowerCase();
  if (u.includes('graphql')) return 'GRAPHQL';
  if (u.includes('/mcp') || u.includes('/sse')) return 'MCP';
  if (u.includes('grpc')) return 'GRPC';
  if (u.includes('ws') || u.includes('websocket')) return 'WEBSOCKET';
  return 'REST';
}

// Determine if API is Shadow (in traffic, not in spec) or Zombie (in spec, not in traffic)
function getApiLifecycleStatus(row: AktoApiInfo, hostCollection?: AktoApiCollection): { isShadow: boolean; isZombie: boolean; isDeprecated: boolean } {
  // Shadow API: Has traffic (lastSeen) but not documented in spec
  const isInSpec = hostCollection?.type === 'OPEN_API' || hostCollection?.type === 'MIRRORING';
  const hasTraffic = row.lastSeen && row.lastSeen > 0;
  const isShadow = hasTraffic && !isInSpec;
  const isZombie = isInSpec && (!hasTraffic || (row.discoveredAt && row.discoveredAt > Date.now() - 30 * 24 * 60 * 60 * 1000));
  const isDeprecated = row.deprecated || false;
  
  return { isShadow, isZombie, isDeprecated };
}

const ApiCatalogue: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d'>('24h');
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApi, setSelectedApi] = useState<AktoApiInfo | null>(null);
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const pageSize = 10;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ endpoints_discovered: number; threats_detected: number; lines: number } | null>(null);

  async function handleNginxUpload(file: File) {
    setUploading(true);
    setUploadResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetchWithSession('/traffic/import/nginx-log', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      setUploadResult(data);
      qc.invalidateQueries({ queryKey: ['discovery'] });
    } catch (e) {
      toast({
        title: 'Upload failed',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const collections = useApiCollections();
  const firstCollectionId = collections.data?.apiCollections?.[0]?.id ?? null;
  const allIds = useMemo(() => collections.data?.apiCollections?.map(c => c.id) ?? [], [collections.data]);
  const apiInfos = useApiInfos(firstCollectionId, page, pageSize, 'lastSeen', -1);
  const sevCounts = useSeverityCounts(allIds);

  const isLoading = collections.isLoading || apiInfos.isLoading;
  const isError = collections.isError || apiInfos.isError;
  const refetch = () => {
    qc.invalidateQueries({ queryKey: ['discovery'] });
  };

  const totalApis = collections.data?.apiCollections?.reduce((s, c) => s + (c.urlsCount || 0), 0) ?? 0;
  const rows = useMemo(() => apiInfos.data?.apiInfoList ?? [], [apiInfos.data?.apiInfoList]);
  const total = apiInfos.data?.total ?? 0;
  const hostCollectionForRow = useCallback(
    (row: AktoApiInfo) => collections.data?.apiCollections?.find(c => c.id === row.id.apiCollectionId),
    [collections.data?.apiCollections],
  );

  // Filter rows based on search query
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter(row => 
      row.id.url.toLowerCase().includes(query) ||
      row.id.method.toLowerCase().includes(query) ||
      (hostCollectionForRow(row)?.hostName?.toLowerCase().includes(query)) ||
      (hostCollectionForRow(row)?.displayName?.toLowerCase().includes(query))
    );
  }, [hostCollectionForRow, rows, searchQuery]);

  // Export handler
  const handleExport = () => {
    const csvHeaders = ['Method', 'Endpoint', 'Host', 'Discovered', 'Last Seen', 'Auth', 'Risk'];
    const csvRows = filteredRows.map(row => {
      const hostCollection = hostCollectionForRow(row);
      const risk = mapRiskScore(row.riskScore);
      const isUnauth = !row.allAuthTypesFound?.length || row.allAuthTypesFound.includes('UNAUTHENTICATED');
      return [
        row.id.method,
        row.id.url,
        hostCollection?.hostName || hostCollection?.displayName || '-',
        formatTs(row.discoveredAt ?? 0),
        formatTs(row.lastSeen),
        isUnauth ? 'Unauthenticated' : 'Authenticated',
        risk,
      ].map(v => `"${v}"`).join(',');
    });
    const csv = [csvHeaders.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-catalogue-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sevAgg = useMemo(() => {
    const result = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    sevCounts.data?.severitiesCountResponse?.forEach(s => {
      Object.entries(s.severityCount || {}).forEach(([k, v]) => {
        const key = k.toUpperCase() as keyof typeof result;
        if (key in result) result[key] += v;
      });
    });
    return result;
  }, [sevCounts.data]);

  const riskData = [
    { name: 'Critical', value: sevAgg.CRITICAL, color: '#EF4444' },
    { name: 'High', value: sevAgg.HIGH, color: '#F97316' },
    { name: 'Medium', value: sevAgg.MEDIUM, color: '#EAB308' },
    { name: 'Low', value: sevAgg.LOW, color: '#22C55E' },
  ];

  const methodDist = useMemo(() => {
    const c: Record<string, number> = {};
    filteredRows.forEach(r => { c[r.id.method] = (c[r.id.method] || 0) + 1; });
    return c;
  }, [filteredRows]);

  const authCounts = useMemo(() => {
    let unauth = 0;
    filteredRows.forEach(r => {
      if (!r.allAuthTypesFound?.length || r.allAuthTypesFound.includes('UNAUTHENTICATED')) unauth++;
    });
    return { unauth, auth: filteredRows.length - unauth };
  }, [filteredRows]);

  const mcpEndpoints = useMemo(() => filteredRows.filter(r => inferApiType(r.id.url) === 'MCP').length, [filteredRows]);
  const shadowCandidates = useMemo(() => {
    return filteredRows.filter(r => {
      const hostCollection = hostCollectionForRow(r);
      const lifecycle = getApiLifecycleStatus(r, hostCollection);
      return lifecycle.isShadow;
    }).length;
  }, [filteredRows, hostCollectionForRow]);
  const zombieCandidates = useMemo(() => {
    return filteredRows.filter(r => {
      const hostCollection = hostCollectionForRow(r);
      const lifecycle = getApiLifecycleStatus(r, hostCollection);
      return lifecycle.isZombie;
    }).length;
  }, [filteredRows, hostCollectionForRow]);
  const authenticatedShare = filteredRows.length > 0
    ? Math.round((authCounts.auth / filteredRows.length) * 100)
    : 0;
  const methodEntries = Object.entries(methodDist).sort((a, b) => b[1] - a[1]);
  const maxMethod = methodEntries[0]?.[1] ?? 1;
  const from = filteredRows.length === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, filteredRows.length);

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <PageHeader
        eyebrow="Discovery"
        title="API catalogue"
        description="Endpoints observed from live traffic. Click a row to open the API record."
        actions={
          <>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search endpoints..."
                className="w-full max-w-56 min-w-[10rem] rounded-lg border border-border-subtle bg-bg-base py-1.5 pl-8 pr-3 text-xs text-text-primary placeholder-text-muted outline-none transition-all focus:border-brand/30"
              />
            </div>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['discovery'] })} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface text-muted-foreground transition-colors hover:text-brand outline-none">
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <TimeFilter value={timeRange} onChange={setTimeRange} />
            <input ref={fileInputRef} type="file" accept=".log,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleNginxUpload(f); }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-brand/30 px-3 py-1.5 text-xs font-semibold text-brand transition-all hover:bg-brand/10 outline-none disabled:opacity-50">
              <Upload size={13} /> {uploading ? 'Importing...' : 'Import log'}
            </button>
            <button onClick={handleExport} className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-semibold text-text-secondary transition-all hover:border-brand/20 hover:text-text-primary outline-none">
              <Download size={13} /> Export
            </button>
          </>
        }
      />

      {/* Upload banner */}
      {uploadResult && (
        <EvidencePanel className="flex flex-wrap items-center gap-4 px-4 py-2.5 text-xs">
          <span className="font-semibold text-text-primary">Log imported.</span>
          <span className="text-text-muted">Lines <strong className="tabular-nums text-text-primary">{uploadResult.lines}</strong></span>
          <span className="text-text-muted">Endpoints <strong className="tabular-nums text-text-primary">{uploadResult.endpoints_discovered}</strong></span>
          <span className="text-text-muted">Threats <strong className="tabular-nums text-text-primary">{uploadResult.threats_detected}</strong></span>
          <button type="button" onClick={() => setUploadResult(null)} className="ml-auto text-text-muted hover:text-text-primary">Dismiss</button>
        </EvidencePanel>
      )}

      <div className="evd-ledger min-w-0">
        <EvidenceLedgerItem icon={Globe} color="var(--evd-info)" label="APIs" value={totalApis} />
        <EvidenceLedgerItem icon={KeyRound} color="var(--evd-critical)" label="Unauthenticated" value={authCounts.unauth} />
        <EvidenceLedgerItem icon={ShieldOff} color="var(--evd-high)" label="Shadow" value={shadowCandidates} />
        <EvidenceLedgerItem icon={Ghost} color="var(--evd-medium)" label="Zombie" value={zombieCandidates} />
        <EvidenceLedgerItem icon={Globe} color="var(--evd-signal)" label="MCP" value={mcpEndpoints} />
        <EvidenceLedgerItem icon={Eye} color="var(--evd-low)" label="Authenticated" value={authenticatedShare} suffix="%" />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <EvidencePanel className="min-w-0">
          <EvidenceSectionHead code="RISK" title="Risk mix" desc={`${totalApis} endpoints`} />
          <div className="flex min-w-0 items-center gap-4">
            <DonutChart data={riskData} size={112} innerRadius={34} outerRadius={50} centerValue={totalApis} centerLabel="APIs" />
            <div className="min-w-0 flex-1">
              {riskData.map((d) => (
                <EvidenceStatLine key={d.name} label={d.name} value={d.value} dot={d.color} />
              ))}
            </div>
          </div>
        </EvidencePanel>
        <EvidencePanel className="min-w-0">
          <EvidenceSectionHead code="VERB" title="Methods" desc={methodEntries.length ? `${methodEntries.length} verbs` : 'No traffic yet'} />
          {methodEntries.length > 0 ? (
            methodEntries.map(([method, count]) => (
              <EvidenceBarLine key={method} label={method} value={count} max={maxMethod} />
            ))
          ) : (
            <p className="py-4 text-sm text-text-muted">Methods appear once endpoints are observed.</p>
          )}
        </EvidencePanel>
      </div>

      {isError && <QueryError message="Failed to load API catalogue" onRetry={refetch} />}

      {!isLoading && !isError && total === 0 && (
        <EvidencePanel className="px-5 py-4">
          <p className="text-sm font-semibold text-text-primary">Awaiting traffic</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            No API endpoints discovered yet. Import an nginx/apache access log, or connect a live traffic sensor.
          </p>
        </EvidencePanel>
      )}

      <EvidencePanel className="min-w-0">
        <EvidenceSectionHead
          code="CAT"
          title="Endpoints"
          desc={`${from}–${to} of ${filteredRows.length}`}
          action={
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-[11px] disabled:opacity-30"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={(page + 1) * pageSize >= filteredRows.length}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-[11px] disabled:opacity-30"
              >
                Next
              </button>
            </div>
          }
        />
        {isLoading ? (
          <TableSkeleton columns={8} rows={pageSize} />
        ) : (
          <div className="evd-table-wrap">
            <table className="evd-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Traits</th>
                  <th>Type</th>
                  <th>Endpoint</th>
                  <th>Host</th>
                  <th>Discovered</th>
                  <th>Last seen</th>
                  <th>Auth</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.slice(page * pageSize, (page + 1) * pageSize).map((row) => {
                  const risk = mapRiskScore(row.riskScore);
                  const isUnauth = !row.allAuthTypesFound?.length || row.allAuthTypesFound.includes('UNAUTHENTICATED');
                  const hostCollection = hostCollectionForRow(row);
                  const apiType = inferApiType(row.id.url);
                  const typeColor = typeColors[apiType] || '#6B7280';
                  const lifecycle = getApiLifecycleStatus(row, hostCollection);
                  return (
                    <tr
                      key={`${row.id.apiCollectionId}-${row.id.method}-${row.id.url}`}
                      className="cursor-pointer"
                      onClick={() => {
                        if (row.endpointId) {
                          navigate(`/app/discovery/endpoint/${row.endpointId}`);
                          return;
                        }
                        setSelectedApi(row);
                        setShowDetailsPanel(true);
                      }}
                    >
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isUnauth && <ShieldOff size={12} className="text-sev-critical" />}
                          {lifecycle.isShadow && (
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--evd-critical)' }}>Shadow</span>
                          )}
                          {lifecycle.isZombie && (
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--evd-medium)' }}>Zombie</span>
                          )}
                          {lifecycle.isDeprecated && (
                            <span className="text-[10px] font-semibold text-text-muted">Deprecated</span>
                          )}
                          {!isUnauth && !lifecycle.isShadow && !lifecycle.isZombie && !lifecycle.isDeprecated && (
                            <span className="text-[10px] text-text-muted">—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="text-[11px] font-semibold" style={{ color: typeColor }}>{apiType}</span>
                      </td>
                      <td>
                        <div className="flex min-w-0 items-center gap-2">
                          <MethodBadge method={row.id.method} />
                          <span className="truncate font-mono text-xs">{row.id.url}</span>
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate text-xs text-text-secondary">{hostCollection?.hostName || hostCollection?.displayName || '-'}</td>
                      <td className="font-mono text-xs tabular-nums text-text-muted">{formatTs(row.discoveredAt ?? 0)}</td>
                      <td className="font-mono text-xs tabular-nums text-text-muted">{formatTs(row.lastSeen)}</td>
                      <td><AuthBadge auth={isUnauth ? 'Unauth' : 'Authenticated'} /></td>
                      <td>
                        <span className="text-[11px] font-semibold" style={{ color: riskColor(risk) }}>{risk}</span>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-text-muted">
                      No APIs found. Connect a traffic source to start discovering APIs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </EvidencePanel>

      {/* API Details Side Panel */}
      {showDetailsPanel && selectedApi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowDetailsPanel(false)}>
          <div 
            className="w-full max-w-2xl bg-bg-surface border border-border-subtle rounded-xl shadow-2xl animate-slide-up m-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <MethodBadge method={selectedApi.id.method} />
                  <span className="text-sm font-bold text-text-primary font-mono">{selectedApi.id.url}</span>
                </div>
              </div>
              <button 
                onClick={() => setShowDetailsPanel(false)}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-all"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">API Collection</p>
                  <p className="text-sm text-text-primary mt-1">
                    {hostCollectionForRow(selectedApi)?.displayName || 'Default Inventory'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Host</p>
                  <p className="text-sm text-text-primary mt-1">
                    {hostCollectionForRow(selectedApi)?.hostName || 'internal'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Discovered</p>
                  <p className="text-sm text-text-primary mt-1 font-mono">{formatTs(selectedApi.discoveredAt ?? 0)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Last Seen</p>
                  <p className="text-sm text-text-primary mt-1 font-mono">{formatTs(selectedApi.lastSeen)}</p>
                </div>
              </div>

              {/* Authentication */}
              <div>
                <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-2">Authentication</p>
                <div className="flex items-center gap-2">
                  <AuthBadge auth={!selectedApi.allAuthTypesFound?.length || selectedApi.allAuthTypesFound.includes('UNAUTHENTICATED') ? 'Unauthenticated' : 'Authenticated'} />
                  {selectedApi.allAuthTypesFound?.length > 0 && !selectedApi.allAuthTypesFound.includes('UNAUTHENTICATED') && (
                    <div className="flex gap-1">
                      {selectedApi.allAuthTypesFound.map(auth => (
                        <span key={auth} className="text-[10px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border-subtle text-text-secondary">
                          {auth}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Risk Score */}
              <div>
                <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-2">Risk Assessment</p>
                <div className="flex items-center gap-3">
                  <span 
                    className="text-sm font-bold px-3 py-1 rounded-full"
                    style={{
                      color: riskColor(mapRiskScore(selectedApi.riskScore)),
                      background: `${riskColor(mapRiskScore(selectedApi.riskScore))}12`,
                    }}
                  >
                    {mapRiskScore(selectedApi.riskScore)}
                  </span>
                  <span className="text-xs text-text-muted">
                    Score: {selectedApi.riskScore ?? 'N/A'}
                  </span>
                </div>
              </div>

              {/* API Type */}
              <div>
                <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-2">API Type</p>
                <span
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full border"
                  style={{ 
                    color: typeColors[inferApiType(selectedApi.id.url)] || '#6B7280',
                    background: `${typeColors[inferApiType(selectedApi.id.url)] || '#6B7280'}12`,
                    borderColor: `${typeColors[inferApiType(selectedApi.id.url)] || '#6B7280'}30`,
                  }}
                >
                  {inferApiType(selectedApi.id.url)}
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-4 border-t border-border-subtle">
                {selectedApi.endpointId && (
                  <button
                    onClick={() => {
                      navigate(`/app/discovery/endpoint/${selectedApi.endpointId}`);
                      setShowDetailsPanel(false);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand text-white hover:bg-brand-dark transition-all text-sm font-semibold"
                  >
                    Open API page
                  </button>
                )}
                <button 
                  onClick={() => {
                    navigate(`/app/discovery/sequence?endpoint=${encodeURIComponent(selectedApi.id.url)}&method=${selectedApi.id.method}`);
                    setShowDetailsPanel(false);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-all text-sm font-semibold"
                >
                  <GitBranch size={14} /> View Sequences
                </button>
                <button 
                  onClick={() => {
                    navigate(`/app/testing?endpoint=${encodeURIComponent(selectedApi.id.url)}`);
                    setShowDetailsPanel(false);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-bg-elevated text-text-secondary hover:text-text-primary border border-border-subtle transition-all text-sm font-semibold"
                >
                  <FileCheck size={14} /> Run Tests
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiCatalogue;
