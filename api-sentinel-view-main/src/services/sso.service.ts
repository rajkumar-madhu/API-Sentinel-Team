import { del, get, patch, post } from '@/lib/api-client';

export type SsoProviderType = 'github' | 'oidc' | 'saml';

export interface SsoSetupUrls {
  callback_url?: string;
  acs_url?: string;
  sp_entity_id?: string;
  metadata_url?: string;
}

export interface SsoProvider {
  id: string;
  provider: SsoProviderType;
  enabled: boolean;
  client_id: string | null;
  allowed_domains: string[];
  config: Record<string, string>;
  has_client_secret: boolean;
  created_at: string | null;
  setup: SsoSetupUrls;
}

export interface SsoSetupInfo {
  account_id: number;
  urls: Record<SsoProviderType, SsoSetupUrls>;
  login: Record<SsoProviderType, string>;
}

export interface CreateSsoProviderPayload {
  provider: SsoProviderType;
  client_id?: string;
  client_secret?: string;
  allowed_domains?: string[];
  config?: Record<string, string>;
}

export async function fetchSsoProviders(signal?: AbortSignal): Promise<SsoProvider[]> {
  const response = await get<{ providers: SsoProvider[] }>('/oauth/providers', signal);
  return response.providers;
}

export async function fetchSsoSetupInfo(signal?: AbortSignal) {
  return get<SsoSetupInfo>('/oauth/providers/setup-info', signal);
}

export async function createSsoProvider(payload: CreateSsoProviderPayload) {
  return post<{ id: string; provider: SsoProviderType; status: string }>('/oauth/providers', payload);
}

export async function setSsoProviderEnabled(id: string, enabled: boolean) {
  return patch<{ id: string; enabled: boolean }>(`/oauth/providers/${id}`, { enabled });
}

export async function deleteSsoProvider(id: string) {
  return del<{ deleted: string }>(`/oauth/providers/${id}`);
}
