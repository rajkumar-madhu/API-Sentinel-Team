import React, { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { LayoutProvider, useLayout } from '@/components/layout/layout-context';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import type { WorkspaceConfig } from '@/components/layout/workspaces';
import { cn } from '@/lib/utils';

const WorkspaceShellInner: React.FC<{ workspace: WorkspaceConfig }> = ({ workspace }) => {
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const { closeMobileSidebar } = useLayout();

  useEffect(() => {
    closeMobileSidebar();
    contentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [closeMobileSidebar, location.pathname]);

  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-bg-base text-text-primary">
      <Sidebar workspace={workspace} />
      <main className="app-backdrop relative flex flex-1 flex-col overflow-hidden">
        <TopBar workspace={workspace} />
        <div
          ref={contentRef}
          id="app-content"
          className={cn(
            'flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5',
            workspace.key === 'customer' && 'evd-root',
          )}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
};

const WorkspaceLayout: React.FC<{ workspace: WorkspaceConfig }> = ({ workspace }) => (
  <LayoutProvider>
    <WorkspaceShellInner workspace={workspace} />
  </LayoutProvider>
);

export default WorkspaceLayout;
