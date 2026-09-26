import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createAccessRole,
  deleteAccessRole,
  fetchAccessRoles,
  fetchAvailablePermissions,
  updateAccessRole,
} from '@/services/access-roles.service';

const ACCESS_ROLES_KEY = ['admin', 'accessRoles'] as const;

export function useAccessRoles() {
  return useQuery({
    queryKey: ACCESS_ROLES_KEY,
    queryFn: ({ signal }) => fetchAccessRoles(signal),
    staleTime: 10_000,
  });
}

export function useAvailablePermissions() {
  return useQuery({
    queryKey: [...ACCESS_ROLES_KEY, 'permissions'],
    queryFn: ({ signal }) => fetchAvailablePermissions(signal),
    staleTime: 5 * 60_000,
  });
}

export function useCreateAccessRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAccessRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCESS_ROLES_KEY }),
  });
}

export function useUpdateAccessRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { permissions?: string[]; description?: string } }) =>
      updateAccessRole(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCESS_ROLES_KEY }),
  });
}

export function useDeleteAccessRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAccessRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCESS_ROLES_KEY }),
  });
}
