import React, { useCallback, useRef, useEffect, useState } from 'react';
import { clsx } from 'clsx';

interface Tab {
  key: string;
  label: string;
  count?: number;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (key: string) => void;
}

export const TabNav: React.FC<TabNavProps> = ({ tabs, activeTab, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const tabSignature = tabs.map((tab) => tab.key).join('|');

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector(`[data-tab-key="${activeTab}"]`) as HTMLElement | null;
    if (!activeEl) {
      setIndicator({ left: 0, width: 0 });
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();
    setIndicator({
      left: elRect.left - containerRect.left,
      width: elRect.width,
    });
  }, [activeTab]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateIndicator);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateIndicator) : null;
    if (containerRef.current) {
      observer?.observe(containerRef.current);
    }
    window.addEventListener('resize', updateIndicator);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateIndicator);
      observer?.disconnect();
    };
  }, [tabSignature, updateIndicator]);

  return (
    <div ref={containerRef} role="tablist" className="relative flex min-w-0 gap-1 overflow-x-auto px-6 no-scrollbar">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          data-tab-key={tab.key}
          role="tab"
          aria-selected={activeTab === tab.key}
          onClick={() => onChange(tab.key)}
          className={clsx(
            'relative flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-3 text-sm font-medium outline-none transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface',
            activeTab === tab.key
              ? 'text-brand'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={clsx(
              'text-[9px] font-bold px-1.5 py-0.5 rounded-full',
              activeTab === tab.key
                ? 'bg-brand/15 text-brand'
                : 'bg-bg-elevated text-text-muted'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
      {/* Animated underline indicator */}
      <div
        className="absolute bottom-0 h-[2px] bg-brand rounded-full transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  );
};
