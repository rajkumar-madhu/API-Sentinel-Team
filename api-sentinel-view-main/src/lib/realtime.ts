import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { buildWebSocketUrl } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const WS_URL = buildWebSocketUrl('/api/stream/live');
const RECONNECT_DELAY_MS = 3000;
const MAX_LIVE_LOGS = 200;
const NON_HTTP_LIVE_METHODS = new Set([
  'TEXT',
  'PING',
  'PONG',
  'BINARY',
  'CLOSE',
  'CONTINUATION',
]);

/** Mirrors server/api/websocket/event_types.py WSEventType. */
export type WSEventType =
  | 'VULNERABILITY_FOUND'
  | 'SCAN_STARTED'
  | 'SCAN_COMPLETED'
  | 'SCAN_PROGRESS'
  | 'THREAT_ACTOR_FLAGGED'
  | 'TRAFFIC_INGESTED'
  | 'IP_BLOCKED'
  | 'ENDPOINT_BLOCKED'
  | 'RATE_LIMITED'
  | 'INCIDENT_CREATED';

export interface LiveAttackInfo {
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string;
}

/** Traffic row pushed on `log_entry` from `/api/stream/live`. */
export interface LiveLogEntry {
  id: string;
  ip: string;
  method: string;
  path: string;
  status: number;
  bytes: string | number;
  timestamp: string;
  attacks: LiveAttackInfo[];
  host?: string;
  protocol?: string;
  latencyMs?: number | null;
  source?: string;
  userId?: string | null;
  hasBody?: boolean;
}

type RealtimeMessage = { type: WSEventType | 'log_entry'; data?: unknown };

type LogListener = (entry: LiveLogEntry) => void;

/** Which top-level React Query key namespaces go stale when a given
 * server event arrives. Keeps every page's data live without polling. */
const INVALIDATION_MAP: Record<WSEventType, string[][]> = {
  VULNERABILITY_FOUND: [['dashboard'], ['testing'], ['security-ops'], ['protection'], ['organization']],
  SCAN_STARTED: [['testing'], ['security-ops']],
  SCAN_COMPLETED: [['testing'], ['security-ops'], ['dashboard'], ['organization']],
  SCAN_PROGRESS: [['testing'], ['security-ops']],
  THREAT_ACTOR_FLAGGED: [['dashboard'], ['protection'], ['live-feed']],
  TRAFFIC_INGESTED: [['dashboard'], ['discovery'], ['live-feed'], ['organization']],
  IP_BLOCKED: [['protection'], ['dashboard'], ['blocklist']],
  ENDPOINT_BLOCKED: [['protection'], ['discovery']],
  RATE_LIMITED: [['protection'], ['alerts']],
  INCIDENT_CREATED: [['alerts'], ['dashboard'], ['protection'], ['organization']],
};

function applyInvalidation(qc: QueryClient, type: string) {
  const keys = INVALIDATION_MAP[type as WSEventType];
  if (!keys) return;
  for (const queryKey of keys) qc.invalidateQueries({ queryKey });
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Stable traffic identity when WS/REST disagree on id (legacy broadcasts). */
function trafficFingerprint(entry: LiveLogEntry): string {
  const path = (entry.path || '').split('?', 1)[0];
  return `${entry.timestamp}|${entry.ip}|${entry.method}|${path}|${entry.status}`;
}

function normalizeLogEntry(raw: unknown): LiveLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const method = String(d.method ?? '');
  if (NON_HTTP_LIVE_METHODS.has(method.toUpperCase())) return null;
  const latencyRaw = d.latency_ms ?? d.latencyMs;
  return {
    id: typeof d.id === 'string' ? d.id : genId(),
    ip: String(d.ip ?? ''),
    method,
    path: String(d.path ?? ''),
    status: Number(d.status ?? 0),
    bytes: (d.bytes as string | number) ?? '-',
    timestamp: String(d.timestamp ?? new Date().toISOString()),
    attacks: Array.isArray(d.attacks) ? (d.attacks as LiveAttackInfo[]) : [],
    host: d.host ? String(d.host) : '',
    protocol: d.protocol ? String(d.protocol) : '',
    latencyMs: typeof latencyRaw === 'number' ? latencyRaw : latencyRaw != null ? Number(latencyRaw) : null,
    source: d.source ? String(d.source) : '',
    userId: d.user_id ? String(d.user_id) : null,
    hasBody: Boolean(d.has_body),
  };
}

function mergeUniqueLogs(current: LiveLogEntry[], incoming: LiveLogEntry[]): LiveLogEntry[] {
  const byId = new Map<string, LiveLogEntry>();
  const fpToId = new Map<string, string>();

  const upsert = (entry: LiveLogEntry) => {
    const fp = trafficFingerprint(entry);
    const priorId = fpToId.get(fp);
    if (priorId && priorId !== entry.id) {
      byId.delete(priorId);
    }
    byId.set(entry.id, entry);
    fpToId.set(fp, entry.id);
  };

  for (const entry of current) upsert(entry);
  for (const entry of incoming) upsert(entry);

  return [...byId.values()]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_LIVE_LOGS);
}

interface RealtimeContextValue {
  connected: boolean;
  /** Newest-first ring buffer of live traffic rows (shared across pages). */
  recentLogs: LiveLogEntry[];
  /** Subscribe to each `log_entry` as it arrives. Returns unsubscribe. */
  subscribeLogs: (listener: LogListener) => () => void;
  clearLogs: () => void;
  seedLogs: (entries: LiveLogEntry[]) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  recentLogs: [],
  subscribeLogs: () => () => undefined,
  clearLogs: () => undefined,
  seedLogs: () => undefined,
});

/** Mounts once at the app shell: owns the single `/api/stream/live` socket
 * and turns server push events into React Query invalidations + a shared
 * live traffic buffer for Live Feed / Dashboard. */
export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const [recentLogs, setRecentLogs] = useState<LiveLogEntry[]>([]);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = user !== null;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const listenersRef = useRef(new Set<LogListener>());

  const subscribeLogs = useCallback((listener: LogListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const clearLogs = useCallback(() => setRecentLogs([]), []);

  const seedLogs = useCallback((entries: LiveLogEntry[]) => {
    const httpEntries = entries.filter((e) => !NON_HTTP_LIVE_METHODS.has(e.method.toUpperCase()));
    setRecentLogs((current) => mergeUniqueLogs(current, httpEntries));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setConnected(false);
      return;
    }
    stoppedRef.current = false;

    const connect = () => {
      if (stoppedRef.current) return;
      // Auth is the httpOnly `access_token` cookie (same-origin). Query-param
      // tokens are rejected by the server and leak into access logs — never use them.
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        try {
          const msg: RealtimeMessage = JSON.parse(ev.data);
          applyInvalidation(queryClient, msg.type);
          if (msg.type === 'log_entry') {
            const entry = normalizeLogEntry(msg.data);
            if (!entry) return;
            setRecentLogs((prev) => mergeUniqueLogs(prev, [entry]));
            listenersRef.current.forEach((fn) => fn(entry));
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onerror = () => setConnected(false);
      ws.onclose = () => {
        setConnected(false);
        if (!stoppedRef.current) reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      stoppedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isAuthenticated, queryClient]);

  return React.createElement(
    RealtimeContext.Provider,
    { value: { connected, recentLogs, subscribeLogs, clearLogs, seedLogs } },
    children,
  );
};

/** Live-connection status for status badges (e.g. the Dashboard's stamp). */
export function useRealtimeStatus(): Pick<RealtimeContextValue, 'connected'> {
  const { connected } = useContext(RealtimeContext);
  return { connected };
}

/** Shared live traffic buffer + connection — prefer this over opening a
 * second WebSocket on Live Feed or Dashboard. */
export function useLiveTraffic(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
