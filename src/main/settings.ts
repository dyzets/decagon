import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { configureRateLimit } from "../core/client";
import type { AppSettings } from "../shared/ipc";

// App-wide preferences persisted to userData/settings.json. Nothing sensitive lives
// here (credentials stay in secrets.ts) — currently just how hard pull/push hits the
// Polygon API, which users need to dial down when Polygon tightens its rate limit.

export const DEFAULT_SETTINGS: AppSettings = {
  syncConcurrency: 4,
  requestIntervalMs: 0,
  maxRetries: 5,
};

/** Bounds for syncConcurrency (1 = fully sequential). */
export const MIN_SYNC_CONCURRENCY = 1;
export const MAX_SYNC_CONCURRENCY = 16;
export const MAX_REQUEST_INTERVAL_MS = 5000;
export const MAX_RETRIES = 10;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

let cache: AppSettings | null = null;

/** Coerce arbitrary stored/incoming data into valid settings. */
function normalize(raw: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    syncConcurrency: clampInt(
      raw?.syncConcurrency,
      MIN_SYNC_CONCURRENCY,
      MAX_SYNC_CONCURRENCY,
      DEFAULT_SETTINGS.syncConcurrency,
    ),
    requestIntervalMs: clampInt(
      raw?.requestIntervalMs,
      0,
      MAX_REQUEST_INTERVAL_MS,
      DEFAULT_SETTINGS.requestIntervalMs,
    ),
    maxRetries: clampInt(raw?.maxRetries, 0, MAX_RETRIES, DEFAULT_SETTINGS.maxRetries),
  };
}

/** Push the throttle/retry knobs down into the API client (src/core/client.ts). */
function applyRateLimit(s: AppSettings): AppSettings {
  configureRateLimit({ minIntervalMs: s.requestIntervalMs, maxRetries: s.maxRetries });
  return s;
}

export function loadSettings(): AppSettings {
  if (cache) return cache;
  const path = settingsPath();
  if (!existsSync(path)) {
    cache = applyRateLimit({ ...DEFAULT_SETTINGS });
    return cache;
  }
  try {
    cache = applyRateLimit(
      normalize(JSON.parse(readFileSync(path, "utf8")) as Partial<AppSettings>),
    );
  } catch {
    // Corrupt or unreadable — fall back to defaults rather than failing startup.
    cache = applyRateLimit({ ...DEFAULT_SETTINGS });
  }
  return cache;
}

export function saveSettings(input: Partial<AppSettings>): AppSettings {
  const next = applyRateLimit(normalize({ ...loadSettings(), ...input }));
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  cache = next;
  return next;
}
