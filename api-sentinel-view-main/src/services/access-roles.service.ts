import { del, get, patch, post } from '@/lib/api-client';

// Per-account permission roles (/api/custom-roles). Distinct from the legacy
// Akto-style roles in admin.service.ts (/getCustomRoles).
export interface AccessRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  created_at: string | null;
  updated_at: string | null;
}

export async function fetchAccessRoles(signal?: AbortSignal): Promise<AccessRole[]> {
  const response = await get<{ roles: AccessRole[] }>('/custom-roles/', signal);
  return response.roles;
}

export async function fetchAvailablePermissions(signal?: AbortSignal): Promise<string[]> {
  const response = await get<{ permissions: string[] }>('/custom-roles/permissions', signal);
  return response.permissions;
}

export async function createAccessRole(payload: { name: string; permissions: string[]; description?: string }) {
  return post<AccessRole>('/custom-roles/', payload);
}

export async function updateAccessRole(id: string, payload: { permissions?: string[]; description?: string }) {
  return patch<{ id: string; updated: string[] }>(`/custom-roles/${id}`, payload);
}

export async function deleteAccessRole(id: string) {
  return del<{ deleted: string }>(`/custom-roles/${id}`);
}
