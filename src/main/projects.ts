import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { ProjectEntry } from "../shared/ipc";
import { emptyManifest, readManifestSafe, writeManifest } from "./manifest";

// The registry stores ONLY the list of project folder paths. Each project's actual
// data (problemId, name, ...) is the manifest inside its own folder, so the folder is
// fully self-contained and portable. Entries whose folder/manifest disappeared are
// pruned on read.

function registryPath(): string {
  return join(app.getPath("userData"), "projects.json");
}

function listPaths(): string[] {
  const path = registryPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function persistPaths(paths: string[]): void {
  writeFileSync(registryPath(), JSON.stringify(paths, null, 2), "utf8");
}

/** Read each known folder's manifest, pruning any that are gone. */
export function listProjects(): ProjectEntry[] {
  const paths = listPaths();
  const valid: string[] = [];
  const entries: ProjectEntry[] = [];
  for (const path of paths) {
    const manifest = readManifestSafe(path);
    if (!manifest) continue;
    valid.push(path);
    entries.push({
      path,
      problemId: manifest.problemId,
      name: manifest.name ?? basename(path),
    });
  }
  if (valid.length !== paths.length) persistPaths(valid);
  return entries;
}

/** Remember a project folder (deduped, most-recent first). */
export function addProjectPath(path: string): void {
  const paths = listPaths().filter((p) => p !== path);
  paths.unshift(path);
  persistPaths(paths);
}

/** Forget a project folder (does not delete files on disk). */
export function removeProject(path: string): ProjectEntry[] {
  persistPaths(listPaths().filter((p) => p !== path));
  return listProjects();
}

/** Build a ProjectEntry from a folder's manifest (problemId 0 means "not bound"). */
function entryOf(path: string): ProjectEntry {
  const manifest = readManifestSafe(path);
  if (!manifest) {
    throw new Error(`No Decagon manifest in ${path}.`);
  }
  return {
    path,
    problemId: manifest.problemId,
    name: manifest.name ?? basename(path),
  };
}

/**
 * (Re)bind a project folder to a Polygon problem id. Pass 0 to unbind. Pull/push/commit
 * read the id straight from the manifest, so changing it here retargets every operation.
 */
export function setProjectId(path: string, problemId: number): ProjectEntry {
  const manifest = readManifestSafe(path);
  if (!manifest) {
    throw new Error(`No Decagon manifest in ${path}.`);
  }
  manifest.problemId = problemId;
  writeManifest(path, manifest);
  return entryOf(path);
}

/** Filenames/dirs that mark a folder as a (Decagon or Polygon) project worth opening. */
const PROJECT_MARKERS = [
  ".decagon-sync.json",
  "config.json",
  "files",
  "solutions",
  "statements",
];

/**
 * Register an existing project folder. If it has no Decagon manifest yet, one is created
 * (unbound, name = folder name) provided the folder looks like a project. The folder's
 * files are read from disk on the next read/pull, so an empty manifest is harmless.
 */
export function openProjectFolder(path: string): ProjectEntry {
  if (!existsSync(path)) {
    throw new Error(`Folder does not exist: ${path}`);
  }
  if (!readManifestSafe(path)) {
    const looksLikeProject = PROJECT_MARKERS.some((m) => existsSync(join(path, m)));
    if (!looksLikeProject) {
      throw new Error(
        "This folder doesn't look like a Decagon/Polygon project (no manifest, config, " +
          "files/, solutions/ or statements/).",
      );
    }
    writeManifest(path, emptyManifest(0, basename(path)));
  }
  addProjectPath(path);
  return entryOf(path);
}
