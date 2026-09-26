import React, { useState } from 'react';
import { useAuditLogs } from '@/hooks/use-admin';
import { ArrowLeft, ClipboardList, Loader2, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { describeUserAgent } from '@/lib/format';

const AuditLogs: React.FC = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 50;
  const { data, isLoading } = useAuditLogs(page, pageSize);

  const logs = data?.auditLogs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin/settings')} className="w-8 h-8 rounded-lg border border-border-subtle bg-bg-surface flex items-center justify-center text-text-muted hover:text-text-primary hover:border-brand/20 transition-all">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-sm font-bold text-text-primary">Audit Logs</h2>
          <p className="text-[11px] text-text-muted">Review all administrative operations and changes</p>
        </div>
      </div>

      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
        <div className="p-3 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={14} className="text-brand" />
            <span className="text-xs font-bold text-text-primary">Audit Trail</span>
            <span className="text-[11px] bg-bg-elevated border border-border-subtle px-2 py-0.5 rounded-full text-text-muted">{total}</span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 rounded-md hover:bg-bg-elevated disabled:opacity-30 transition-colors"><ChevronLeft size={14} /></button>
              <span className="tabular-nums">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1 rounded-md hover:bg-bg-elevated disabled:opacity-30 transition-colors"><ChevronRight size={14} /></button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-xs text-text-muted">No audit logs found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border-subtle bg-bg-base/50">
                <th className="w-8 px-3 py-2.5" />
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Timestamp</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">User</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Action</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Resource</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Client</th>
              </tr></thead>
              <tbody className="divide-y divide-border-subtle">
                {logs.map(log => {
                  const expanded = expandedId === log.id;
                  const ua = describeUserAgent(log.userAgent);
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        className="data-row-interactive hover:bg-white/[0.02] transition-colors cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : log.id)}
                        aria-expanded={expanded}
                      >
                        <td className="px-3 py-3 text-text-muted">
                          <ChevronDown size={13} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
                        </td>
                        <td className="px-4 py-3 text-[11px] text-text-muted font-mono whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="px-4 py-3 text-[12px] text-text-primary">{log.userEmail || log.user || 'system'}</td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">{log.action}</span>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-text-muted">{log.resource || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="text-[11px] font-mono text-text-primary">{log.ipAddress || '—'}</div>
                          {log.userAgent && <div className="text-[11px] text-text-muted" title={log.userAgent}>{ua.label}</div>}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-bg-base/60">
                          <td />
                          <td colSpan={5} className="px-4 py-3">
                            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[11px]">
                              <div><dt className="text-text-muted uppercase tracking-wider">User ID</dt><dd className="font-mono text-text-primary break-all">{log.user || 'system'}</dd></div>
                              <div><dt className="text-text-muted uppercase tracking-wider">Resource ID</dt><dd className="font-mono text-text-primary break-all">{log.resourceId || '—'}</dd></div>
                              <div><dt className="text-text-muted uppercase tracking-wider">Client IP</dt><dd className="font-mono text-text-primary">{log.ipAddress || 'not recorded'}</dd></div>
                              <div><dt className="text-text-muted uppercase tracking-wider">User agent</dt><dd className="text-text-primary break-all">{log.userAgent || 'not recorded'}</dd></div>
                            </dl>
                            <div className="mt-3">
                              <p className="text-[11px] text-text-muted uppercase tracking-wider mb-1">Details</p>
                              <pre className="max-h-48 overflow-auto rounded-lg border border-border-subtle bg-bg-surface p-3 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all">{log.details || '—'}</pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogs;
