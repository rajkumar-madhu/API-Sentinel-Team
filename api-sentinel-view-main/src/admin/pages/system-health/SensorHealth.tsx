import React from 'react';
import { Activity, RefreshCw, Radio, Server, WifiOff } from 'lucide-react';
import QueryError from '@/components/shared/QueryError';
import StatusPulse from '@/components/ui/StatusPulse';
import { useSensors } from '@/hooks/use-admin';
import { useQueryClient } from '@tanstack/react-query';

function formatTs(value?: string | null) {
  if (!value) return 'No heartbeat recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid heartbeat';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const SensorHealth: React.FC = () => {
  const qc = useQueryClient();
  const { data: sensors = [], isLoading, isError, refetch } = useSensors();
  const online = sensors.filter((sensor) => sensor.status === 'ONLINE').length;
  const degraded = sensors.filter((sensor) => sensor.status === 'DEGRADED').length;

  return (
    <div className="w-full space-y-5 animate-fade-in">
      {isError && <QueryError message="Failed to load sensor health data" onRetry={() => refetch()} />}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Registered', value: sensors.length, icon: Server, tone: 'text-text-primary' },
          { label: 'Online', value: online, icon: Activity, tone: 'text-sev-low' },
          { label: 'Degraded', value: degraded, icon: WifiOff, tone: degraded ? 'text-sev-high' : 'text-text-muted' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-xl border border-border-subtle bg-bg-surface p-4">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</span>
              <Icon size={15} />
            </div>
            <div className={`mt-2 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle p-4">
          <div className="flex items-center gap-2">
            <Radio size={15} className="text-sev-low" />
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Registered sensors</h2>
              <p className="mt-0.5 text-xs text-text-muted">Heartbeat and shipped-event state from the tenant sensor registry.</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh sensor health"
            onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'sensors'] })}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface text-muted-foreground transition-colors hover:border-brand/30 hover:text-brand"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {isLoading ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-lg bg-bg-elevated" />)}
          </div>
        ) : sensors.length === 0 ? (
          <div className="p-10 text-center">
            <Radio size={24} className="mx-auto text-text-muted" />
            <p className="mt-3 text-sm font-medium text-text-primary">No sensors registered</p>
            <p className="mt-1 text-xs text-text-muted">Register a sensor to start collecting traffic for this workspace.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead className="bg-bg-base/50">
                <tr>
                  {['Sensor', 'Host', 'Version', 'Status', 'Events shipped', 'Last heartbeat'].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {sensors.map((row) => {
                  const isUp = row.status === 'ONLINE';
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-bg-hover">
                      <td className="px-4 py-3 text-[12px] font-mono font-semibold text-brand">{row.name || row.id}</td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary">{row.host || '—'}</td>
                      <td className="px-4 py-3 text-[11px] font-mono text-text-muted">{row.version || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusPulse variant={isUp ? 'online' : row.status === 'DEGRADED' ? 'warning' : 'critical'} size="sm" />
                          <span className="text-[11px] font-bold" style={{ color: isUp ? '#22C55E' : row.status === 'DEGRADED' ? '#F97316' : '#EF4444' }}>{row.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] font-mono tabular-nums text-text-secondary">{row.lines_shipped.toLocaleString()}</td>
                      <td className="px-4 py-3 text-[11px] font-mono text-text-muted">{formatTs(row.last_heartbeat)}</td>
                    </tr>
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

export default SensorHealth;
