import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TabNav } from '@/components/layout/TabNav';

const SystemHealthLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const segments = location.pathname.split('/').filter(Boolean);
  const activeTab = segments[1] || 'controllers';

  const tabs = [
    { key: 'controllers', label: 'Controller Health' },
    { key: 'sensors', label: 'Sensor Health' },
    { key: 'enforcers', label: 'Enforcer Health' },
  ];

  const handleTabChange = (key: string) => {
    navigate(`/admin/system-health/${key}`);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col animate-fade-in">
      <div className="-mx-6 mb-6 min-w-0 border-b border-border-subtle">
        <TabNav tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />
      </div>

      <div className="min-h-0 min-w-0 w-full flex-1 overflow-x-hidden">
        <Outlet />
      </div>
    </div>
  );
};

export default SystemHealthLayout;
