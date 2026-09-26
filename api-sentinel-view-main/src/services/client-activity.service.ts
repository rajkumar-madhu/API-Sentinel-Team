import { get } from '@/lib/api-client';

export interface ApplicationRef {
  id: string;
  name: string;
  host?: string | null;
}

export interface RequestLogRecord {
  id: string;
  ip: string | null;
  client_ip: string | null;
  client_id: string | null;
  user_agent: string | null;
  method: string | null;
  path: string | null;
  host: string;
  status: number | null;
  latency_ms: number | null;
  timestamp: string | null;
  endpoint_id: string | null;
  application: ApplicationRef | null;
  attacks?: { category: string; severity: string }[];
}

export interface CountedValue {
  value: string;
  count: number;
}

export interface ClientActivity {
  client: string;
  window_days: number;
  request_count: number;
  truncated: boolean;
  first_seen: string | null;
  last_seen: string | null;
  avg_latency_ms: number | null;
  user_agents: CountedValue[];
  hosts: CountedValue[];
  applications: CountedValue[];
  endpoints: CountedValue[];
  status_classes: Record<string, number>;
  client_ids: string[];
  recent_requests: RequestLogRecord[];
}

export interface SecurityEventRecord {
  id: string;
  ip: string | null;
  actor: string | null;
  method: string;
  url: string;
  host: string;
  category: string | null;
  sub_category: string | null;
  severity: string | null;
  status: string | null;
  type: string | null;
  label: string | null;
  context_source: string | null;
  session_id: string | null;
  successful_exploit: boolean | null;
  country_code: string | null;
  dest_country_code: string | null;
  detected_at: number | null;
  created_at: string | null;
  payload: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RequestLogDetail {
  log: RequestLogRecord;
  endpoint: {
    id: string;
    method: string;
    path_pattern: string;
    host: string;
    risk_score: number | null;
    is_sensitive: boolean | null;
    auth_types: string[];
    status: string | null;
    last_seen: string | null;
  } | null;
  client_activity: ClientActivity | null;
}

export interface SecurityEventDetail {
  event: SecurityEventRecord;
  request: RequestLogRecord | null;
  client_activity: ClientActivity | null;
}

export interface ThreatActorDetail {
  actor: {
    id?: string;
    source_ip: string;
    status: string;
    event_count?: number;
    risk_score?: number;
    last_seen?: string | null;
  };
  client_activity: ClientActivity;
  events: SecurityEventRecord[];
}

export function fetchRequestLogDetail(logId: string, signal?: AbortSignal) {
  return get<RequestLogDetail>(`/stream/logs/${encodeURIComponent(logId)}`, signal);
}

export function fetchSecurityEventDetail(eventId: string, signal?: AbortSignal) {
  return get<SecurityEventDetail>(`/threat-actors/events/${encodeURIComponent(eventId)}`, signal);
}

export function fetchThreatActorDetail(ip: string, signal?: AbortSignal) {
  return get<ThreatActorDetail>(`/threat-actors/${encodeURIComponent(ip)}/detail`, signal);
}
