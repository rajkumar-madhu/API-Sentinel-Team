import { del, get, patch, post } from '@/lib/api-client';

export type IntegrationType =
  | 'slack'
  | 'jira'
  | 'splunk'
  | 'datadog'
  | 'azure_boards'
  | 'pagerduty'
  | 'webhook'
  | 'bigquery'
  | 'sentinel'
  | 'qradar'
  | 'elastic'
  | 'chronicle';

export const INTEGRATION_EVENT_OPTIONS = [
  'vulnerability_found',
  'test_complete',
  'alert.created',
  'alert.playbook',
  'endpoint.shadow_detected',
  'endpoint.zombie_detected',
  'endpoint.zombie_revived',
] as const;

export interface IntegrationSummary {
  id: string;
  type: IntegrationType;
  name: string;
  enabled: boolean;
  events: string[];
  created_at: string | null;
  configured_fields: string[];
  config_redacted: boolean;
}

export interface IntegrationDetail extends IntegrationSummary {
  config: Record<string, unknown>;
}

export interface CreateIntegrationPayload {
  type: IntegrationType;
  name: string;
  config: Record<string, unknown>;
  events?: string[];
}

export interface UpdateIntegrationPayload {
  enabled?: boolean;
  config?: Record<string, unknown>;
  events?: string[];
}

export interface TestIntegrationResult {
  integration_id: string;
  type: IntegrationType;
  success: boolean;
  detail: string;
}

export async function fetchIntegrations(signal?: AbortSignal): Promise<IntegrationSummary[]> {
  const response = await get<{ total: number; integrations: IntegrationSummary[] }>('/integrations/', signal);
  return response.integrations;
}

export async function fetchIntegration(id: string, signal?: AbortSignal): Promise<IntegrationDetail> {
  return get<IntegrationDetail>(`/integrations/${id}`, signal);
}

export async function createIntegration(payload: CreateIntegrationPayload) {
  return post<{ id: string; type: string; name: string; status: string }>('/integrations/', payload);
}

export async function updateIntegration(id: string, payload: UpdateIntegrationPayload) {
  return patch<{ integration_id: string; updated: string[] }>(`/integrations/${id}`, payload);
}

export async function deleteIntegration(id: string) {
  return del<{ deleted: string }>(`/integrations/${id}`);
}

export async function testIntegration(id: string) {
  return post<TestIntegrationResult>(`/integrations/${id}/test`, {});
}
