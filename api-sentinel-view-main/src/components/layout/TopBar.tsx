import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { ChevronRight, Search, ChevronDown, RefreshCw, LogOut, Settings, Menu, Moon, Sun } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useOnboarding } from '@/lib/onboarding-context';
import { useApiCollections } from '@/hooks/use-discovery';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { useLayout } from '@/components/layout/layout-context';
import { useTheme } from '@/lib/theme-context';
import { useLiveTraffic } from '@/lib/realtime';
import { adminWorkspace, customerWorkspace, platformWorkspace, type WorkspaceConfig } from '@/components/layout/workspaces';

function getInitials(user: { login: string; name?: string } | null): string {
  if (!user) return '??';
  const name = user.name || user.login;
  const parts = name.split(/[@.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export const TopBar: React.FC<{ workspace: WorkspaceConfig }> = ({ workspace }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isFetching = useIsFetching();
  const {
    user,
    role,
    logout,
    canAccessCustomerWorkspace,
    canAccessAdminWorkspace,
    canAccessPlatformWorkspace,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const onboarding = useOnboarding();
  const { openMobileSidebar } = useLayout();
  const { data: collectionsData } = useApiCollections();
  const collections = collectionsData?.apiCollections ?? [];
  const { connected: streamConnected } = useLiveTraffic();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const workspacePathParts = pathParts[0] === workspace.basePath.replace('/', '') ? pathParts.slice(1) : pathParts;
  const currentPage = workspace.pageLabels[workspacePathParts[0] ?? ''] || workspace.shortLabel;
  const subPage = workspacePathParts[1]
    ? workspacePathParts[1].charAt(0).toUpperCase() + workspacePathParts[1].slice(1).replace(/-/g, ' ')
    : null;

  const appNames = collections.map(c => c.displayName || c.hostName).filter(Boolean);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const activeApp = selectedApp || appNames[0] || 'Default Inventory';
  const activeContext = workspace.key === 'customer' ? activeApp : workspace.label;
  const [appOpen, setAppOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const accessibleWorkspaces = useMemo(() => {
    const options: WorkspaceConfig[] = [];
    if (canAccessCustomerWorkspace) options.push(customerWorkspace);
    if (canAccessAdminWorkspace) options.push(adminWorkspace);
    if (canAccessPlatformWorkspace) options.push(platformWorkspace);
    return options;
  }, [canAccessAdminWorkspace, canAccessCustomerWorkspace, canAccessPlatformWorkspace]);
  const showWorkspaceSwitcher = accessibleWorkspaces.length > 1;

  const initials = getInitials(user);
  const displayName = user?.name || user?.login?.split('@')[0] || 'User';
  const roleLabel = role.replace(/_/g, ' ');
  const settingsTarget = workspace.key === 'customer'
    ? '/app/organization'
    : workspace.key === 'admin'
      ? '/admin/settings'
      : '/platform/overview';

  // Keyboard shortcut for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(v => !v);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setAppOpen(false);
        setWorkspaceOpen(false);
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (searchOpen) setSearchQuery('');
  }, [searchOpen]);

  useEffect(() => {
    if (isFetching === 0) {
      setLastSync(new Date());
    }
  }, [isFetching]);

  const filteredShortcuts = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const base = workspace.searchShortcuts;
    if (!q) return base;
    return base.filter(item => {
      const haystack = [item.label, item.hint, ...(item.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [deferredSearchQuery, workspace]);

  const handleRefresh = () => {
    queryClient.invalidateQueries();
    toast({
      title: 'Refreshing data',
      description: 'Fetching the latest telemetry and inventory.',
    });
  };

  return (
    <>
      <div
        className="flex min-h-[52px] min-w-0 shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-border-subtle bg-bg-surface px-5"
      >
        {/* Left: Breadcrumb */}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <button
            onClick={openMobileSidebar}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-bg-elevated/60 text-text-muted transition-colors hover:text-text-primary hover:border-brand/20 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu size={15} />
          </button>

          {workspace.key === 'customer' ? (
            <div className="relative">
              <button
                onClick={() => setAppOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors outline-none"
              >
                <div className="w-5 h-5 rounded-md bg-brand/10 border border-brand/20 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-sm bg-brand" />
                </div>
                <span className="max-w-[100px] truncate sm:max-w-[140px] md:max-w-[200px]">{activeContext}</span>
                <ChevronDown size={11} className={`transition-transform duration-200 text-muted-foreground ${appOpen ? 'rotate-180' : ''}`} />
              </button>
              {appOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAppOpen(false)} />
                  <div className="absolute left-0 top-full mt-1.5 w-48 sm:w-56 rounded-xl border border-border-subtle shadow-2xl z-50 py-1 max-h-64 overflow-y-auto glass-card-premium animate-scale-in">
                    {appNames.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No applications found</div>
                    )}
                    {appNames.map(app => (
                      <button key={app} onClick={() => { setSelectedApp(app); setAppOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-black/[0.04] ${app === activeApp ? 'text-brand font-semibold' : 'text-text-secondary'}`}>
                        {app}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-3 py-1 text-[11px] font-semibold text-text-secondary">
              <div className="w-2 h-2 rounded-full bg-brand" />
              {activeContext}
            </div>
          )}

          <ChevronRight size={12} className="text-text-muted" />
          <span className="text-xs font-medium text-text-secondary">{currentPage}</span>
          {subPage && (
            <>
              <ChevronRight size={12} className="text-text-muted" />
              <span className="text-xs font-semibold text-text-primary">
                {workspacePathParts[1] === 'api-catalogue' ? 'API Catalogue' :
                  workspacePathParts[1] === 'api-governance' ? 'API Governance' : subPage}
              </span>
            </>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {showWorkspaceSwitcher && (
            <div className="relative hidden md:block">
              <button
                data-testid="workspace-switcher"
                onClick={() => setWorkspaceOpen((open) => !open)}
                className="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-3 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:border-brand/20 hover:text-text-primary"
              >
                <span>{workspace.shortLabel}</span>
                <ChevronDown
                  size={11}
                  className={`text-text-muted transition-transform duration-200 ${workspaceOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {workspaceOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setWorkspaceOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-border-subtle shadow-2xl glass-card-premium animate-scale-in">
                    <div className="border-b border-border-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                      Switch Workspace
                    </div>
                    <div className="py-1">
                      {accessibleWorkspaces.map((option) => {
                        const isActive = option.key === workspace.key;
                        return (
                          <button
                            key={option.key}
                            data-testid={`workspace-option-${option.key}`}
                            onClick={() => {
                              setWorkspaceOpen(false);
                              if (!isActive) navigate(option.homePath);
                            }}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                              isActive ? 'bg-brand/5 text-text-primary' : 'text-text-secondary hover:bg-black/[0.04] hover:text-text-primary'
                            }`}
                          >
                            <div>
                              <div className="text-xs font-semibold">{option.label}</div>
                              <div className="mt-0.5 text-[11px] text-text-muted">{option.badge}</div>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                isActive ? 'bg-brand/10 text-brand' : 'border border-border-subtle bg-bg-base text-text-muted'
                              }`}
                            >
                              {isActive ? 'Current' : 'Open'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {workspace.key === 'admin' && !onboarding.data.completed && (
            <button
              onClick={() => navigate('/admin/onboarding')}
              className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/10 border border-brand/20 text-[11px] text-brand font-semibold"
            >
              Setup {onboarding.progress}%
            </button>
          )}

          <div className="hidden items-center gap-2 rounded-full border border-border-subtle bg-bg-base px-2.5 py-1 text-[11px] font-medium text-text-secondary lg:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${streamConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {streamConnected ? 'Stream live' : 'Reconnecting'}
            {isFetching > 0 ? (
              <span className="text-text-muted">· syncing</span>
            ) : lastSync ? (
              <span className="text-text-muted">
                · {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
          </div>

          <div className="mx-0.5 h-4 w-px bg-border-subtle" />

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-10 items-center gap-2 rounded-xl border border-border-subtle bg-bg-elevated/50 px-3 text-muted-foreground transition-all outline-none hover:border-brand/20 hover:text-text-primary"
          >
            <Search size={13} />
            <span className="hidden sm:inline text-[11px]">Search</span>
            <kbd className="hidden md:inline text-[9px] px-1 py-0.5 rounded bg-bg-base border border-border-subtle text-text-muted font-mono">
              {(typeof navigator !== 'undefined' && navigator.platform.includes('Mac')) ? 'Cmd' : 'Ctrl'}K
            </kbd>
          </button>

          <button
            onClick={handleRefresh}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-bg-elevated/50 text-muted-foreground transition-all outline-none hover:border-brand/20 hover:text-brand"
          >
            <RefreshCw size={13} />
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-bg-elevated/50 text-muted-foreground transition-all outline-none hover:border-brand/20 hover:text-brand"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>

          <div className="mx-0.5 h-4 w-px bg-border-subtle" />

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(v => !v)}
              className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-lg hover:bg-bg-hover transition-colors outline-none"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-[11px] font-bold text-white shadow-sm ring-2 ring-brand/20">
                {initials}
              </div>
              <div className="hidden md:block text-left">
                <div className="text-[11px] font-medium text-text-secondary leading-none">{displayName}</div>
                <div className="text-[11px] text-text-muted mt-0.5">{roleLabel}</div>
              </div>
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-44 sm:w-52 rounded-xl border border-border-subtle shadow-2xl z-50 py-1 glass-card-premium animate-scale-in">
                  <div className="px-3 py-3 border-b border-border-subtle">
                    <div className="text-xs font-semibold text-text-primary">{displayName}</div>
                    <div className="text-[11px] text-text-muted mt-0.5">{user?.login}</div>
                    <div className="mt-1.5 inline-block px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider text-brand border border-brand/20 bg-brand/10">
                      {roleLabel}
                    </div>
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate(settingsTarget); }}
                    className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-black/[0.04] transition-colors flex items-center gap-2"
                  >
                    <Settings size={12} />
                    Settings
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); void logout(); }}
                    className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                  >
                    <LogOut size={12} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Command Palette / Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] sm:pt-[15vh]">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSearchOpen(false)} />
          <div className="relative w-[calc(100%-2rem)] sm:w-full max-w-lg mx-4 sm:mx-0 glass-card-premium rounded-xl shadow-2xl border border-border-subtle animate-scale-in overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
              <Search size={16} className="text-text-muted shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Search endpoints, tests, events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
              />
              <kbd className="text-[11px] px-1.5 py-0.5 rounded bg-bg-base border border-border-subtle text-text-muted font-mono">
                ESC
              </kbd>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filteredShortcuts.map(item => (
                <button
                  key={item.path}
                  onClick={() => { navigate(item.path); setSearchOpen(false); }}
                  className="w-full text-left px-4 py-3 text-xs text-text-secondary hover:text-text-primary hover:bg-black/[0.04] transition-colors flex items-center justify-between"
                >
                  <div className="flex flex-col">
                    <span className="text-[12px] font-semibold">{item.label}</span>
                    <span className="text-[11px] text-text-muted">{item.hint}</span>
                  </div>
                  <ChevronRight size={12} className="text-text-muted" />
                </button>
              ))}
              {filteredShortcuts.length === 0 && (
                <div className="p-4 text-center text-xs text-text-muted">
                  No matches. Try "alerts", "live", or "discovery".
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
