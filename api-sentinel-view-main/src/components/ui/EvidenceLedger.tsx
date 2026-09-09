import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** The KPI ledger strip: a hairline-gridded row of metric cells, replacing
 * the rounded MetricWidget tile grid. Wrap LedgerItems in a div with
 * className="evd-ledger". */
export const EvidenceLedgerItem: React.FC<{
  icon: LucideIcon;
  color: string;
  label: string;
  value: number | string;
  suffix?: string;
  delta?: number;
  hint?: string;
  onClick?: () => void;
}> = ({ icon: Icon, color, label, value, suffix = '', delta, hint, onClick }) => {
  const empty = typeof value === 'number' ? value === 0 : value === '0' || value === '—';
  return (
    <div
      className="evd-ledger-item"
      data-interactive={onClick ? '' : undefined}
      data-empty={empty ? 'true' : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="evd-ledger-label">
        <Icon size={12} style={{ color }} />
        {label}
      </div>
      <div className="evd-ledger-value tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {suffix}
      </div>
      {delta !== undefined && (
        <div
          className="evd-ledger-delta tabular-nums"
          style={{ color: delta >= 0 ? 'var(--evd-low)' : 'var(--evd-critical)' }}
        >
          {delta >= 0 ? '+' : ''}
          {delta}% / 7d
        </div>
      )}
      {hint ? <p className="evd-ledger-hint">{hint}</p> : null}
    </div>
  );
};

export default EvidenceLedgerItem;
