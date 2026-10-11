import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Lightweight in-memory + persisted event log for portal synchronization.
 *
 * Why this exists: every failure path in the sync engine previously ended in
 * `console.warn(...)`, which is invisible on a release build. Without a field
 * trail it is impossible to tell "portal is down" apart from "parser broke" or
 * "session expired", which is exactly the ambiguity behind the
 * "app is not refreshing" reports.
 *
 * Nothing here is sensitive: paths, HTTP status codes, durations and error
 * codes only. No response bodies, no cookies, no credentials.
 */

export type DiagKind = 'request' | 'sync' | 'auth' | 'circuit';

export interface DiagEvent {
  /** Epoch milliseconds */
  t: number;
  kind: DiagKind;
  /** Portal path (for requests) or scope name (for syncs) */
  label: string;
  ok?: boolean;
  status?: number;
  ms?: number;
  detail?: string;
}

const STORAGE_KEY = 'shiksha_diag_log_v1';
const MAX_EVENTS = 200;
const PERSIST_THROTTLE_MS = 2500;

let events: DiagEvent[] = [];
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Diagnostics must never break the app
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist().catch(() => {});
  }, PERSIST_THROTTLE_MS);
}

export const SyncDiagnostics = {
  /**
   * Records one event. Safe to call from anywhere, never throws.
   */
  log(event: Omit<DiagEvent, 't'> & { t?: number }): void {
    try {
      const entry: DiagEvent = { t: event.t ?? Date.now(), ...event };
      events.push(entry);
      if (events.length > MAX_EVENTS) {
        events = events.slice(-MAX_EVENTS);
      }
      schedulePersist();

      if (__DEV__) {
        const bits = [
          `[diag:${entry.kind}]`,
          entry.label,
          entry.ok === undefined ? '' : entry.ok ? 'ok' : 'FAIL',
          entry.status ? `status=${entry.status}` : '',
          entry.ms !== undefined ? `${entry.ms}ms` : '',
          entry.detail || '',
        ].filter(Boolean);
        console.log(bits.join(' '));
      }
    } catch {
      // ignore
    }
  },

  /**
   * Loads the persisted log (called once; subsequent calls return the memory buffer).
   */
  async load(): Promise<DiagEvent[]> {
    if (loaded) return events;
    loaded = true;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          events = parsed.slice(-MAX_EVENTS);
        }
      }
    } catch {
      // ignore
    }
    return events;
  },

  async getRecent(count = 20): Promise<DiagEvent[]> {
    await this.load();
    return events.slice(-count);
  },

  /**
   * Human-readable one-line rendering used by the Settings screen.
   */
  format(list: DiagEvent[]): string[] {
    return list.map((e) => {
      const time = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const outcome = e.ok === undefined ? '' : e.ok ? 'OK' : 'FAIL';
      const parts = [
        time,
        e.kind.padEnd(7, ' '),
        e.label,
        outcome,
        e.status ? `HTTP ${e.status}` : '',
        e.ms !== undefined ? `${e.ms}ms` : '',
        e.detail || '',
      ];
      return parts.filter(Boolean).join(' · ');
    });
  },

  /**
   * Aggregated health snapshot for the last `windowMs` (default 10 minutes).
   */
  async summary(windowMs = 10 * 60 * 1000): Promise<{
    requests: number;
    failures: number;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    lastFailureDetail: string | null;
  }> {
    await this.load();
    const since = Date.now() - windowMs;
    const recent = events.filter((e) => e.t >= since && e.kind === 'request');
    const failures = recent.filter((e) => e.ok === false);
    const successes = events.filter((e) => e.kind === 'request' && e.ok === true);
    const lastFailure = failures[failures.length - 1];
    return {
      requests: recent.length,
      failures: failures.length,
      lastSuccessAt: successes.length ? successes[successes.length - 1].t : null,
      lastFailureAt: lastFailure ? lastFailure.t : null,
      lastFailureDetail: lastFailure
        ? `${lastFailure.label} (${lastFailure.detail || 'error'})`
        : null,
    };
  },

  async clear(): Promise<void> {
    events = [];
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};
