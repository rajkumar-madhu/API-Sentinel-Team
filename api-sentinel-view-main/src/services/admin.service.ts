import { del, get, post, patch } from '@/lib/api-client';

/* ───── Types from Akto ───── */

export interface AktoModuleInfo {
  id: string;
  moduleName: string;
  currentVersion: string;
  lastHeartbeat: number;
  lastMirrored: number;
  state: string;               // RUNNING, STOPPED
  isConnected: boolean;
  hostName?: string;
  ipAddress?: string;
  policyVersion?: string;
}

export interface AktoTeamMember {
  id: string;
  login: string;
  name?: string;
  role: string;
  lastLoginTs?: number;
  createdAt?: string | null;
}

export interface AktoRole {
  name: string;
  baseRole?: string;
  apiCollectionIds?: number[];
}

export interface AktoAuditLog {
  id: string;
  user: string;
  userEmail?: string | null;
  action: string;
  timestamp: number;
  details?: string;
  resource?: string;
  resourceId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AdminApiKey {
  id: string;
  name: string;
  reference: string;
  scopes: string[];
  createdAt?: string | null;
  expiresAt?: string | null;
  createdBy?: string;
  status: 'ACTIVE' | 'EXPIRED';
}

export interface AccountSettingsPayload {
  deployment?: {
    mode?: string;
    runtimeProfile?: string;
    inlineProtection?: boolean;
  };
  traffic?: {
    source?: string;
    collectorUrl?: string;
    controllerUrl?: string;
  };
  applicationDefaults?: {
    environment?: string;
    businessUnit?: string;
    assignedUsers?: string[];
  };
  identity?: {
    authHeader?: string;
    sessionKey?: string;
    userIdKey?: string;
    userRoleKey?: string;
    tenantKey?: string;
  };
  featureEnvelope?: {
    discovery?: boolean;
    behavioralTesting?: boolean;
    realtimeProtection?: boolean;
    reporting?: boolean;
  };
  onboarding?: {
    completed?: boolean;
    currentStep?: string;
    completedSteps?: string[];
  };
  license?: {
    planTier?: string;
    applicationsPurchased?: number;
    applicationsUsed?: number;
    endpointAllowance?: number;
    endpointUsage?: number;
    sensorAllowance?: number;
    sensorUsage?: number;
    expiresOn?: string | null;
  };
}

/* ───── Module / System Health ───── */

export async function fetchModuleInfo(signal?: AbortSignal) {
  return post<{ moduleInfos: AktoModuleInfo[] }>('/fetchModuleInfo', {}, signal);
}

export async function rebootModules(moduleIds: string[], signal?: AbortSignal) {
  return post('/rebootModules', { moduleIds }, signal);
}

export async function deleteModuleInfo(moduleId: string, signal?: AbortSignal) {
  return post('/deleteModuleInfo', { moduleId }, signal);
}

/* ───── Team / Users ───── */

export async function fetchTeamData(signal?: AbortSignal) {
  return post<{ users: AktoTeamMember[]; pendingInvitees: string[] }>(
    '/getTeamData',
    {},
    signal,
  );
}

export async function fetchCustomRoles(signal?: AbortSignal) {
  return post<{ customRoles: AktoRole[] }>('/getCustomRoles', {}, signal);
}

export async function createCustomRole(
  roleName: string,
  baseRole: string,
  apiCollectionIds: number[],
  signal?: AbortSignal,
) {
  return post(
    '/createCustomRole',
    { roleName, baseRole, apiCollectionIds },
    signal,
  );
}

export async function removeUser(email: string, signal?: AbortSignal) {
  return post('/removeUser', { email }, signal);
}

export interface InviteUserPayload {
  email: string;
  role: string;
  name: string;
}

export interface InviteUserResponse {
  status: string;
  user_id: string;
  email: string;
  role: string;
  temp_password: string;
}

export async function inviteUser(payload: InviteUserPayload, signal?: AbortSignal) {
  return post<InviteUserResponse>('/auth/users/invite', payload, signal);
}

export async function updateUserRole(userId: string, role: string, signal?: AbortSignal) {
  return patch<{ status: string; user_id: string; role: string }>(
    `/auth/users/${userId}/role`,
    { role } as unknown as Record<string, unknown>,
    signal,
  );
}

export async function deleteUserById(userId: string, signal?: AbortSignal) {
  return del<{ status: string; user_id: string }>(`/auth/users/${userId}`, signal);
}

export async function fetchAccountUsers(signal?: AbortSignal) {
  return get<{ total: number; users: Array<{ id: string; email: string; role: string; account_id: number; created_at?: string | null }> }>(
    '/auth/users',
    signal,
  );
}

/* ───── Audit Logs ───── */

export async function fetchAuditLogs(
  skip: number = 0,
  limit: number = 50,
  signal?: AbortSignal,
) {
  return post<{ auditLogs: AktoAuditLog[]; total: number }>(
    '/fetchAuditData',
    { skip, limit },
    signal,
  );
}

/* ───── Admin Settings ───── */

export async function fetchAccountSettings(signal?: AbortSignal) {
  return post<{ accountSettings: AccountSettingsPayload }>(
    '/getAccountSettingsForAdvancedFilters',
    {},
    signal,
  );
}

export async function modifyAccountSettings(settings: Record<string, unknown>, signal?: AbortSignal) {
  return post('/modifyAccountSettings', settings, signal);
}

export async function fetchApiKeys(signal?: AbortSignal) {
  return post<{ apiKeys: AdminApiKey[] }>('/getApiKeys', {}, signal);
}

export async function createApiKey(
  payload: { name: string; scopes: string[]; expiresInDays?: number | null },
  signal?: AbortSignal,
) {
  return post<{ apiKey: AdminApiKey; token: string }>('/createApiKey', payload, signal);
}

export async function revokeApiKey(apiKeyId: string, signal?: AbortSignal) {
  return post('/revokeApiKey', { apiKeyId }, signal);
}

/* ───── Traffic Alerts ───── */

export async function fetchTrafficAlerts(signal?: AbortSignal) {
  return post<{ trafficAlerts: Array<{ id: string; message: string; timestamp: number; dismissed: boolean }> }>(
    '/getAllTrafficAlerts',
    {},
    signal,
  );
}

export async function dismissTrafficAlert(alertId: string, signal?: AbortSignal) {
  return post('/markAlertAsDismissed', { alertId }, signal);
}

/* ───── Threat Configuration ───── */

export async function fetchThreatConfiguration(signal?: AbortSignal) {
  return post<{ threatConfiguration: Record<string, unknown> }>(
    '/fetchThreatConfiguration',
    {},
    signal,
  );
}

export async function modifyThreatConfiguration(config: Record<string, unknown>, signal?: AbortSignal) {
  return post('/modifyThreatConfiguration', config, signal);
}
