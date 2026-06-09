import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import { writeFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  IPC,
  type CredentialsStatus,
  type ProjectEntry,
  type SaveCredentialsInput,
} from "../shared/ipc";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  requireCredentials,
} from "./secrets";
import {
  problemsList,
  problemInfo,
  problemSolutions,
  problemTests,
  problemStatements,
  problemFiles,
  problemPackages,
  problemBuildPackage,
  problemPackageBytes,
  problemCommitChanges,
  problemCreate,
  problemSaveScript,
} from "../core/methods";
import { syncPull, syncPush, scaffoldProject } from "./sync";
import {
  readProjectContent,
  readProjectUnit,
  writeFileEntry,
  writeSolutionEntry,
  writeStatementEntry,
  writeStatementResourceEntry,
  writeScript,
  deleteUnit,
  writeInfoSlice,
  writeTestsetMeta,
  writeValidatorTestsFile,
  writeCheckerTestsFile,
} from "./projectContent";
import {
  listProjects,
  addProjectPath,
  removeProject,
  setProjectId,
  openProjectFolder,
} from "./projects";
import { readManifest } from "./manifest";
import type {
  ProjectCheckerTest,
  ProjectFileEntry,
  ProjectFileRef,
  ProjectInfoSlice,
  ProjectSolutionEntry,
  ProjectStatementEntry,
  ProjectStatementResource,
  ProjectTestset,
  ProjectValidatorTest,
} from "../shared/ipc";

function status(): CredentialsStatus {
  const creds = loadCredentials();
  return creds ? { configured: true, apiKey: creds.apiKey } : { configured: false };
}

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

/** Make a problem name safe to use as a folder name. */
function safeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "problem";
}

/** Prompt for a parent directory and return the chosen path, or null if cancelled. */
async function pickParentDir(title: string): Promise<string | null> {
  const win = focusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled || filePaths.length === 0 ? null : filePaths[0]!;
}

/** Resolve a problem's name by id (best-effort) so the project folder is named nicely. */
async function resolveProblemName(problemId: number): Promise<string> {
  try {
    const list = await problemsList(requireCredentials(), { id: problemId });
    const found = list.find((p) => p.id === problemId) ?? list[0];
    if (found?.name) return found.name;
  } catch {
    // ignore — fall back to a generic name
  }
  return `problem-${problemId}`;
}

/** Register all IPC handlers. Call once during app startup. */
export function registerIpcHandlers(): void {
  // --- credentials ---
  ipcMain.handle(IPC.credentialsStatus, () => status());
  ipcMain.handle(IPC.credentialsSave, (_e, input: SaveCredentialsInput) => {
    if (!input?.apiKey || !input?.apiSecret) {
      throw new Error("apiKey and apiSecret are required.");
    }
    saveCredentials({ apiKey: input.apiKey, apiSecret: input.apiSecret });
    return status();
  });
  ipcMain.handle(IPC.credentialsClear, () => {
    clearCredentials();
    return status();
  });

  // --- read-only problem data (for the project Details view) ---
  ipcMain.handle(IPC.problemInfo, (_e, problemId: number, pin?: string) =>
    problemInfo(requireCredentials(), problemId, pin),
  );
  ipcMain.handle(IPC.problemMeta, async (_e, problemId: number) => {
    const list = await problemsList(requireCredentials(), { id: problemId });
    return list.find((p) => p.id === problemId) ?? list[0] ?? null;
  });
  ipcMain.handle(IPC.problemSolutions, (_e, problemId: number, pin?: string) =>
    problemSolutions(requireCredentials(), problemId, pin),
  );
  ipcMain.handle(
    IPC.problemTests,
    (_e, problemId: number, testset?: string, pin?: string) =>
      problemTests(requireCredentials(), problemId, testset, pin),
  );
  ipcMain.handle(IPC.problemStatements, (_e, problemId: number, pin?: string) =>
    problemStatements(requireCredentials(), problemId, pin),
  );
  ipcMain.handle(IPC.problemFiles, (_e, problemId: number, pin?: string) =>
    problemFiles(requireCredentials(), problemId, pin),
  );

  // --- packages ---
  ipcMain.handle(IPC.problemPackages, (_e, problemId: number, pin?: string) =>
    problemPackages(requireCredentials(), problemId, pin),
  );
  ipcMain.handle(
    IPC.problemBuildPackage,
    (_e, problemId: number, full: boolean, verify: boolean, pin?: string) =>
      problemBuildPackage(requireCredentials(), problemId, full, verify, pin),
  );
  ipcMain.handle(
    IPC.problemDownloadPackage,
    async (_e, problemId: number, packageId: number, type?: string, pin?: string) => {
      const win = focusedWindow();
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: "Save package",
        defaultPath: `problem-${problemId}-package-${packageId}.zip`,
        filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      });
      if (canceled || !filePath) return null;
      const bytes = await problemPackageBytes(
        requireCredentials(),
        problemId,
        packageId,
        type,
        pin,
      );
      writeFileSync(filePath, bytes);
      return filePath;
    },
  );
  ipcMain.handle(
    IPC.problemCommit,
    (_e, problemId: number, message: string, pin?: string) =>
      problemCommitChanges(requireCredentials(), problemId, message, false, pin).then(
        () => undefined,
      ),
  );

  // --- create a local project folder (no Polygon problem yet; bind an id later) ---
  ipcMain.handle(
    IPC.createLocalProject,
    async (_e, name: string): Promise<ProjectEntry | null> => {
      if (!name?.trim()) throw new Error("Project name is required.");
      const parent = await pickParentDir("Choose where to create the project folder");
      if (!parent) return null;

      const cleanName = name.trim();
      const dir = join(parent, safeFolderName(cleanName));
      // problemId 0 = not bound to Polygon yet.
      scaffoldProject(dir, 0, cleanName);
      addProjectPath(dir);
      return { path: dir, problemId: 0, name: cleanName };
    },
  );

  // --- create a fresh problem on Polygon and bind it to an existing project folder ---
  ipcMain.handle(
    IPC.createPolygonProblem,
    async (_e, path: string, name: string): Promise<ProjectEntry> => {
      if (!path) throw new Error("A project path is required.");
      if (!name?.trim()) throw new Error("Problem name is required.");
      const problem = await problemCreate(requireCredentials(), name.trim());
      return setProjectId(path, problem.id);
    },
  );

  // --- register an existing Decagon project folder the user picks ---
  ipcMain.handle(IPC.openProject, async (): Promise<ProjectEntry | null> => {
    const dir = await pickParentDir("Choose an existing project folder to open");
    if (!dir) return null;
    return openProjectFolder(dir);
  });

  // --- (re)bind a project folder to a Polygon problem id ---
  ipcMain.handle(
    IPC.setProjectId,
    (_e, path: string, problemId: number): ProjectEntry => {
      if (!path) throw new Error("A project path is required.");
      if (!Number.isFinite(problemId) || problemId < 0) {
        throw new Error("A valid problem id is required.");
      }
      return setProjectId(path, Math.trunc(problemId));
    },
  );

  // --- import existing problem by id (pull into a new project folder) ---
  ipcMain.handle(
    IPC.importProblem,
    async (_e, problemId: number, pin?: string): Promise<ProjectEntry | null> => {
      if (!Number.isFinite(problemId) || problemId <= 0) {
        throw new Error("A valid problem id is required.");
      }
      const parent = await pickParentDir("Choose where to import the project folder");
      if (!parent) return null;

      const name = await resolveProblemName(problemId);
      const dir = join(parent, safeFolderName(name));
      await syncPull(requireCredentials(), problemId, dir, name, pin);
      addProjectPath(dir);
      return { path: dir, problemId, name };
    },
  );

  // --- projects registry ---
  ipcMain.handle(IPC.projectsList, () => listProjects());
  ipcMain.handle(IPC.projectRemove, (_e, path: string) => removeProject(path));
  ipcMain.handle(IPC.projectReveal, (_e, path: string) => shell.openPath(path));
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url));

  // --- pull/push a project by folder path (problemId from the manifest) ---
  ipcMain.handle(IPC.pullProject, (e, path: string, pin?: string) => {
    const manifest = readManifest(path);
    return syncPull(
      requireCredentials(),
      manifest.problemId,
      path,
      manifest.name,
      pin,
      (p) => e.sender.send(IPC.syncProgress, p),
    );
  });
  ipcMain.handle(IPC.pushProject, (e, path: string, pin?: string) =>
    syncPush(requireCredentials(), path, pin, (p) =>
      e.sender.send(IPC.syncProgress, p),
    ),
  );

  // --- auto-reload: watch a project folder and notify the renderer on disk changes ---
  // A single active watcher (the app shows one project detail view at a time). Events
  // are debounced so a burst of writes (e.g. a pull) yields one reload signal.
  let watcher: { fsw: FSWatcher; timer?: NodeJS.Timeout } | null = null;
  const stopWatch = (): void => {
    if (watcher?.timer) clearTimeout(watcher.timer);
    watcher?.fsw.close();
    watcher = null;
  };
  ipcMain.handle(IPC.watchProject, (e, path: string) => {
    stopWatch();
    try {
      const fsw = watch(path, { recursive: true }, () => {
        if (!watcher) return;
        if (watcher.timer) clearTimeout(watcher.timer);
        watcher.timer = setTimeout(() => e.sender.send(IPC.projectChanged, path), 250);
      });
      watcher = { fsw };
    } catch {
      // Folder may be missing/unwatchable — auto-reload just won't fire.
    }
  });
  ipcMain.handle(IPC.unwatchProject, () => stopWatch());

  // --- local project editing: targeted per-unit folder saves (no network/creds) ---
  ipcMain.handle(IPC.projectRead, (_e, path: string) => readProjectContent(path));
  ipcMain.handle(IPC.projectReadUnit, (_e, path: string, ref: ProjectFileRef) =>
    readProjectUnit(path, ref),
  );
  ipcMain.handle(
    IPC.projectSaveFileEntry,
    (_e, path: string, entry: ProjectFileEntry) => writeFileEntry(path, entry),
  );
  ipcMain.handle(
    IPC.projectSaveSolution,
    (_e, path: string, entry: ProjectSolutionEntry) => writeSolutionEntry(path, entry),
  );
  ipcMain.handle(
    IPC.projectSaveStatement,
    (_e, path: string, entry: ProjectStatementEntry) => writeStatementEntry(path, entry),
  );
  ipcMain.handle(
    IPC.projectSaveStatementResource,
    (_e, path: string, entry: ProjectStatementResource) =>
      writeStatementResourceEntry(path, entry),
  );
  ipcMain.handle(IPC.projectDeleteUnit, (_e, path: string, ref: ProjectFileRef) =>
    deleteUnit(path, ref),
  );
  ipcMain.handle(IPC.projectSaveInfo, (_e, path: string, slice: ProjectInfoSlice) =>
    writeInfoSlice(path, slice),
  );
  ipcMain.handle(IPC.projectSaveTestset, (_e, path: string, ts: ProjectTestset) =>
    writeTestsetMeta(path, ts),
  );
  ipcMain.handle(
    IPC.projectSaveScript,
    (_e, path: string, testset: string, script: string) =>
      writeScript(path, testset, script),
  );
  ipcMain.handle(
    IPC.projectSaveValidatorTests,
    (_e, path: string, tests: ProjectValidatorTest[]) =>
      writeValidatorTestsFile(path, tests),
  );
  ipcMain.handle(
    IPC.projectSaveCheckerTests,
    (_e, path: string, tests: ProjectCheckerTest[]) =>
      writeCheckerTestsFile(path, tests),
  );

  // --- push a single testset's script up to Polygon (script Save force-pushes) ---
  ipcMain.handle(
    IPC.problemPushScript,
    async (_e, path: string, testset: string, pin?: string) => {
      const manifest = readManifest(path);
      if (!manifest.problemId) {
        throw new Error(
          "This project isn't bound to a Polygon problem yet. Bind a problem id first.",
        );
      }
      const script = readProjectUnit(path, { kind: "script", testset }).content;
      await problemSaveScript(requireCredentials(), manifest.problemId, testset, script, pin);
    },
  );
}
