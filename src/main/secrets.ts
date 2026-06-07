import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PolygonCredentials } from "../core/client";

// Credentials are persisted to userData. The apiSecret is encrypted at rest with
// Electron's safeStorage (OS keychain / DPAPI) when available; the apiKey is stored
// in plaintext since it is not sensitive on its own.

interface StoredCredentials {
  apiKey: string;
  /** base64 of safeStorage-encrypted secret, or plaintext if encryption unavailable. */
  secret: string;
  encrypted: boolean;
}

function credentialsPath(): string {
  return join(app.getPath("userData"), "credentials.json");
}

let cache: PolygonCredentials | null = null;

export function loadCredentials(): PolygonCredentials | null {
  if (cache) return cache;
  const path = credentialsPath();
  if (!existsSync(path)) return null;

  try {
    const stored = JSON.parse(readFileSync(path, "utf8")) as StoredCredentials;
    const apiSecret = stored.encrypted
      ? safeStorage.decryptString(Buffer.from(stored.secret, "base64"))
      : stored.secret;
    cache = { apiKey: stored.apiKey, apiSecret };
    return cache;
  } catch {
    // Corrupt or unreadable — treat as not configured.
    return null;
  }
}

export function saveCredentials(creds: PolygonCredentials): void {
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const stored: StoredCredentials = {
    apiKey: creds.apiKey,
    encrypted: canEncrypt,
    secret: canEncrypt
      ? safeStorage.encryptString(creds.apiSecret).toString("base64")
      : creds.apiSecret,
  };
  writeFileSync(credentialsPath(), JSON.stringify(stored), { mode: 0o600 });
  cache = { ...creds };
}

export function clearCredentials(): void {
  const path = credentialsPath();
  if (existsSync(path)) rmSync(path);
  cache = null;
}

/** Throws a friendly error if credentials are missing. */
export function requireCredentials(): PolygonCredentials {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error("Polygon credentials are not configured.");
  }
  return creds;
}
