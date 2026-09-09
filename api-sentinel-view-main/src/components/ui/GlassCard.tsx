import React from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'accent';
  glow?: boolean;
  hoverLift?: boolean;
  className?: string;
  onClick?: () => void;
}

const variantStyles = {
  default: 'bg-bg-surface border-border-subtle',
  elevated: 'bg-bg-elevated border-border-default shadow-sm',
  accent: 'bg-bg-surface border-[rgba(99,44,175,0.2)]',
};

const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = 'default',
  glow = false,
  hoverLift = false,
  className,
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl border shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-all duration-200',
        variantStyles[variant],
        glow && 'shadow-[0_0_20px_rgba(99,44,175,0.06)]',
        hoverLift && 'hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.10)]',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
};

export default GlassCard;
