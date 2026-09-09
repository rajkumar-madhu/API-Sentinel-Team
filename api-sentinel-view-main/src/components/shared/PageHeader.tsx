import React from 'react';
import { cn } from '@/lib/utils';

const PageHeader: React.FC<{
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ eyebrow, title, description, actions, className }) => (
  <div className={cn('flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between', className)}>
    <div className="min-w-0">
      {eyebrow && (
        <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
          {eyebrow}
        </p>
      )}
      <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-text-primary">
        {title}
      </h1>
      {description && (
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-text-secondary">{description}</p>
      )}
    </div>
    {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export default PageHeader;
