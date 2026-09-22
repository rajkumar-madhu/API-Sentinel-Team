import React from 'react';
import { LayoutGrid, Users, Key, Shield, Radio, FileText, ShieldAlert, ClipboardList, CheckSquare, Settings, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SettingsCard from '@/components/shared/SettingsCard';

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 animate-fade-in w-full pb-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col items-center justify-center mb-8 mt-2">
        <div className="w-12 h-12 rounded-xl bg-brand/10 flex items-center justify-center mb-4">
          <Settings size={24} className="text-brand" />
        </div>
        <h2 className="text-sm font-bold text-text-primary mb-1">Settings</h2>
        <p className="text-xs text-text-muted">Manage access, platform, and security configuration</p>
      </div>

      {/* Access & Identity */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider pl-1">Access & Identity</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SettingsCard icon={LayoutGrid} title="Manage Applications" description="Add and register new applications, assign them to users or groups." onClick={() => navigate('/admin/applications/add')} />
          <SettingsCard icon={Users} title="User & Role Administration" description="Manage organizational users, update role assignments." onClick={() => navigate('/admin/settings/users')} />
          <SettingsCard icon={Key} title="API Keys Management" description="Securely create, manage, and rotate API keys." onClick={() => navigate('/admin/settings/api-keys')} />
          <SettingsCard icon={Shield} title="API Attribute Mapping" description="Define the headers and keys used for session, user, role, and tenant attribution." onClick={() => navigate('/admin/settings/attribute-mapping')} />
        </div>
      </div>

      {/* Platform & Infrastructure */}
      <div className="space-y-3 pt-2">
        <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider pl-1">Platform & Infrastructure</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SettingsCard icon={Radio} title="Controller & Sensor Config" description="Configure and manage controller and sensor settings." onClick={() => navigate('/admin/system-health')} />
          <SettingsCard icon={FileText} title="License Usage" description="Monitor license consumption and track active usage." onClick={() => navigate('/admin/settings/license')} />
          <SettingsCard icon={Bell} title="Alert Destinations" description="Send findings to Slack, PagerDuty, webhooks, and your SIEM." onClick={() => navigate('/admin/settings/integrations')} />
        </div>
      </div>

      {/* Security & Governance */}
      <div className="space-y-3 pt-2">
        <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider pl-1">Security & Governance</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SettingsCard icon={ShieldAlert} title="Threat Policies" description="Global rules for active threats and baseline deviations." onClick={() => navigate('/app/protection/policy')} />
          <SettingsCard icon={ClipboardList} title="Audit Logs" description="Review all administrative operations and policy changes." onClick={() => navigate('/admin/settings/audit-logs')} />
          <SettingsCard icon={CheckSquare} title="Compliance Reports" description="Generate raw exports for SOC2, PCI-DSS, and HIPAA." onClick={() => navigate('/app/reports')} />
        </div>
      </div>

    </div>
  );
};

export default SettingsPage;
