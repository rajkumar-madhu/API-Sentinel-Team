import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '@/lib/auth-context';
import StatusPulse from '@/components/ui/StatusPulse';
import { useLayout } from '@/components/layout/layout-context';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useLiveTraffic } from '@/lib/realtime';
import type { WorkspaceConfig } from '@/components/layout/workspaces';

function getInitials(user: { login: string; name?: string } | null): string {
  if (!user) return '??';
  const name = user.name || user.login;
  const parts = name.split(/[@.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export const Sidebar: React.FC<{ workspace: WorkspaceConfig }> = ({ workspace }) => {
  const { user } = useAuth();
  const { connected: streamConnected } = useLiveTraffic();
  const { isSidebarCollapsed, isMobileSidebarOpen, toggleSidebar, closeMobileSidebar } = useLayout();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const initials = getInitials(user);
  const collapsed = isDesktop ? isSidebarCollapsed : false;
  const location = useLocation();

  // Auto-close mobile sidebar on route change
  useEffect(() => {
    if (!isDesktop && isMobileSidebarOpen) {
      closeMobileSidebar();
    }
  }, [closeMobileSidebar, isDesktop, isMobileSidebarOpen, location.pathname]);

  const visibleNav = workspace.navItems;
  const visibleBottom = workspace.bottomItems;

  const desktopWidth = collapsed ? 'lg:w-[84px]' : 'lg:w-[228px]';

  const navClass = ({ isActive }: { isActive: boolean }) =>
    twMerge(clsx(
      'relative flex w-full min-w-0 items-center gap-3 cursor-pointer transition-colors duration-150 outline-none group rounded-md',
      collapsed ? 'flex-col justify-center py-2.5 px-0' : 'py-2 px-3',
      isActive
        ? 'text-[var(--sidebar-active)] nav-active-bar bg-white/[0.04]'
        : 'text-[var(--sidebar-muted)] hover:text-[var(--sidebar-title)] hover:bg-white/[0.05]'
    ));

  // Group items by section for expanded mode
  let lastSection = '';

  const handleItemClick = () => {
    if (!isDesktop) {
      closeMobileSidebar();
    }
  };

  return (
    <>
      {isMobileSidebarOpen && (
        <button
          aria-label="Close navigation"
          onClick={closeMobileSidebar}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}

      <nav
        className={clsx(
          'ws-sidebar fixed inset-y-0 left-0 z-50 flex h-full min-h-0 w-[85vw] max-w-[280px] shrink-0 -translate-x-full flex-col overflow-hidden transition-all duration-300 ease-in-out lg:static lg:z-10 lg:translate-x-0',
          desktopWidth,
          isMobileSidebarOpen && 'translate-x-0'
        )}
      >
      {/* Logo */}
      <div className="w-full border-b border-white/[0.06] px-3 py-4">
        <div className={clsx('flex items-center', collapsed ? 'justify-center' : 'justify-between gap-3')}>
          <div className={clsx('flex items-center gap-3', collapsed && 'justify-center')}>
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1a1f28] ring-1 ring-white/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 2L21 6.5V13C21 17.4 17 21.2 12 22C7 21.2 3 17.4 3 13V6.5L12 2Z" fill="#FF5B2E" />
                <path d="M12 6L17 8.5V13C17 15.5 14.8 17.7 12 18.5C9.2 17.7 7 15.5 7 13V8.5L12 6Z" fill="#FFFFFF" />
              </svg>
            </div>
            {!collapsed && (
              <div className="animate-fade-in min-w-0">
                <div className="ws-sidebar-title text-sm font-semibold leading-none tracking-tight">API Sentinel</div>
                <div className="ws-sidebar-muted mt-1 text-[11px]">{workspace.label}</div>
              </div>
            )}
          </div>

          {!isDesktop && (
            <button
              onClick={closeMobileSidebar}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#8a867e] transition-colors hover:bg-white/[0.06] hover:text-[#f4f1ea]"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-[68px] z-20 hidden h-6 w-6 items-center justify-center rounded-full border border-[#252b36] bg-[#1a1f28] text-[#8a867e] shadow-md transition-colors hover:text-[#FF8A5B] lg:flex"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Main Nav */}
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-1 pt-2 no-scrollbar">
        {visibleNav.map((item) => {
          const showSection = !collapsed && item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;

          return (
            <React.Fragment key={item.path}>
              {showSection && (
                <div className="px-4 pt-5 pb-1.5">
                  <span className="ws-sidebar-muted text-[10px] font-semibold uppercase tracking-[0.14em]">
                    {item.section}
                  </span>
                </div>
              )}
              <NavLink
                to={item.path}
                className={navClass}
                title={collapsed ? item.label : undefined}
                onClick={handleItemClick}
              >
                {({ isActive }) => (
                  <>
                    <div className={clsx(
                      'relative flex shrink-0 items-center justify-center rounded-md transition-colors duration-150',
                      collapsed ? 'h-10 w-10' : 'h-8 w-8',
                      isActive
                        ? 'bg-white/[0.08] text-[#FF8A5B]'
                        : 'text-[#8a867e] group-hover:text-[#f4f1ea]'
                    )}>
                      <item.icon size={collapsed ? 19 : 17} strokeWidth={isActive ? 2.2 : 1.8} />
                      {item.live && (
                        <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-green-400">
                          <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
                        </span>
                      )}
                    </div>
                    {collapsed ? (
                      <span className={clsx(
                        'text-[10px] font-semibold tracking-tight leading-none',
                        isActive ? 'text-[#FF8A5B]' : 'text-[#8a867e]'
                      )}>{item.label.length > 8 ? item.label.slice(0, 7) + '...' : item.label}</span>
                    ) : (
                      <span className={clsx(
                        'truncate text-[13px] font-medium animate-fade-in',
                        isActive ? 'text-[#f4f1ea]' : 'text-[#c8c4bc]'
                      )}>{item.label}</span>
                    )}
                  </>
                )}
              </NavLink>
            </React.Fragment>
          );
        })}
      </div>

      {/* Bottom Nav */}
      <div className="flex w-full shrink-0 flex-col border-t border-white/[0.06] px-1 pb-4 pt-3">
        {/* System status */}
        <div className={clsx('mb-2 flex items-center px-3', collapsed ? 'justify-center' : 'gap-2')}>
          <StatusPulse variant={streamConnected ? 'online' : 'warning'} size="sm" />
          {!collapsed && (
            <span className={clsx('text-[11px] animate-fade-in', streamConnected ? 'text-emerald-400' : 'text-amber-400')}>
              {streamConnected ? 'Live stream' : 'Reconnecting'} · {workspace.badge}
            </span>
          )}
        </div>

        {visibleBottom.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={navClass}
            title={collapsed ? item.label : undefined}
            onClick={handleItemClick}
          >
            {({ isActive }) => (
              <>
                <div className={clsx(
                  'flex shrink-0 items-center justify-center rounded-md transition-colors duration-150',
                  collapsed ? 'h-10 w-10' : 'h-8 w-8',
                  isActive ? 'bg-white/[0.08] text-[#FF8A5B]' : 'text-[#8a867e] group-hover:text-[#f4f1ea]'
                )}>
                  <item.icon size={collapsed ? 19 : 17} strokeWidth={isActive ? 2.2 : 1.8} />
                </div>
                {collapsed ? (
                  <span className={clsx(
                    'text-[10px] font-semibold tracking-tight',
                    isActive ? 'text-[#FF8A5B]' : 'text-[#8a867e]'
                  )}>{item.label}</span>
                ) : (
                  <span className={clsx(
                    'text-[13px] font-medium animate-fade-in',
                    isActive ? 'text-[#f4f1ea]' : 'text-[#c8c4bc]'
                  )}>{item.label}</span>
                )}
              </>
            )}
          </NavLink>
        ))}

        {/* Avatar */}
        <div className={clsx('mt-3 flex px-3', collapsed ? 'justify-center' : 'items-center gap-2.5')}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-[11px] font-bold text-white ring-1 ring-white/10">
            {initials}
          </div>
          {!collapsed && user && (
            <div className="min-w-0 animate-fade-in">
              <div className="ws-sidebar-title truncate text-xs font-medium">
                {user.name || user.login?.split('@')[0]}
              </div>
              <div className="ws-sidebar-muted truncate text-[11px]">{user.login}</div>
            </div>
          )}
        </div>
      </div>
      </nav>
    </>
  );
};
