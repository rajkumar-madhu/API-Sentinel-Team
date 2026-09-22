import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createIntegration,
  deleteIntegration,
  fetchIntegration,
  fetchIntegrations,
  testIntegration,
  updateIntegration,
  type CreateIntegrationPayload,
  type UpdateIntegrationPayload,
} from '@/services/integrations.service';

const INTEGRATIONS_KEY = ['admin', 'integrations'] as const;

export function useIntegrations() {
  return useQuery({
    queryKey: INTEGRATIONS_KEY,
    queryFn: ({ signal }) => fetchIntegrations(signal),
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

export function useIntegration(id: string | null) {
  return useQuery({
    queryKey: [...INTEGRATIONS_KEY, id],
    queryFn: ({ signal }) => fetchIntegration(id as string, signal),
    enabled: !!id,
  });
}

export function useCreateIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateIntegrationPayload) => createIntegration(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
    },
  });
}

export function useUpdateIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateIntegrationPayload }) => updateIntegration(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
    },
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
    },
  });
}

export function useTestIntegration() {
  return useMutation({
    mutationFn: (id: string) => testIntegration(id),
  });
}
