import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ResourceAdvancedProperties, SolutionTag } from "../core/types";
import type { FileType } from "../core/methods";

// The manifest is the single source of truth for a project: it lives inside the
// project folder and binds it to a Polygon problem (id + metadata for round-tripping).

export const MANIFEST = ".decagon-sync.json";

export interface SyncManifest {
  problemId: number;
  name?: string;
  pulledAt?: string;
  files: {
    name: string;
    type: FileType;
    sourceType?: string;
    /** Whether the file is pushed to Polygon (absent = true, for back-compat). */
    push?: boolean;
    resourceAdvancedProperties?: ResourceAdvancedProperties;
  }[];
  solutions: {
    name: string;
    tag: SolutionTag;
    sourceType?: string;
    /** Whether the solution is pushed to Polygon (absent = true, for back-compat). */
    push?: boolean;
  }[];
  statements: { lang: string; encoding?: string }[];
  statementResources: { name: string }[];
  /** Names of testsets that have a local tests/<name>.json or scripts/<name>.txt. */
  testsets?: string[];
}

export function manifestPath(dir: string): string {
  return join(dir, MANIFEST);
}

export function readManifest(dir: string): SyncManifest {
  const path = manifestPath(dir);
  if (!existsSync(path)) {
    throw new Error(
      `No ${MANIFEST} in this folder — it is not a Decagon project. Import or create the problem first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as SyncManifest;
}

export function readManifestSafe(dir: string): SyncManifest | null {
  try {
    return readManifest(dir);
  } catch {
    return null;
  }
}

export function writeManifest(dir: string, manifest: SyncManifest): void {
  writeFileSync(manifestPath(dir), JSON.stringify(manifest, null, 2), "utf8");
}

export function emptyManifest(problemId: number, name: string): SyncManifest {
  return {
    problemId,
    name,
    files: [],
    solutions: [],
    statements: [],
    statementResources: [],
  };
}
