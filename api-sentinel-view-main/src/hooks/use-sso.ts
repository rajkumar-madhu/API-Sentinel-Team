import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSsoProvider,
  deleteSsoProvider,
  fetchSsoProviders,
  fetchSsoSetupInfo,
  setSsoProviderEnabled,
  type CreateSsoProviderPayload,
} from '@/services/sso.service';

const SSO_KEY = ['admin', 'sso'] as const;

export function useSsoProviders() {
  return useQuery({
    queryKey: [...SSO_KEY, 'providers'],
    queryFn: ({ signal }) => fetchSsoProviders(signal),
    staleTime: 10_000,
  });
}

export function useSsoSetupInfo() {
  return useQuery({
    queryKey: [...SSO_KEY, 'setup'],
    queryFn: ({ signal }) => fetchSsoSetupInfo(signal),
    staleTime: 5 * 60_000,
  });
}

export function useCreateSsoProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSsoProviderPayload) => createSsoProvider(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: SSO_KEY }),
  });
}

export function useSetSsoProviderEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setSsoProviderEnabled(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: SSO_KEY }),
  });
}

export function useDeleteSsoProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSsoProvider(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SSO_KEY }),
  });
}
