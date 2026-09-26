import { useQuery } from '@tanstack/react-query';

import {
  fetchRequestLogDetail,
  fetchSecurityEventDetail,
  fetchThreatActorDetail,
} from '@/services/client-activity.service';

// Keys sit under the 'live-feed' / 'protection' namespaces so realtime
// invalidation (src/lib/realtime.ts) refreshes an open detail view.

export function useRequestLogDetail(logId: string | null | undefined) {
  return useQuery({
    queryKey: ['live-feed', 'log-detail', logId],
    queryFn: ({ signal }) => fetchRequestLogDetail(logId as string, signal),
    enabled: Boolean(logId),
    retry: false,
  });
}

export function useSecurityEventDetail(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ['protection', 'event-detail', eventId],
    queryFn: ({ signal }) => fetchSecurityEventDetail(eventId as string, signal),
    enabled: Boolean(eventId),
    retry: false,
  });
}

export function useThreatActorDetail(ip: string | null | undefined) {
  return useQuery({
    queryKey: ['protection', 'actor-detail', ip],
    queryFn: ({ signal }) => fetchThreatActorDetail(ip as string, signal),
    enabled: Boolean(ip),
    retry: false,
  });
}
