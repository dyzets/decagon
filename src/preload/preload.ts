import { contextBridge, ipcRenderer } from "electron";
import { IPC, type PolygonBridge } from "../shared/ipc";

// The single, typed surface the renderer is allowed to use. Everything is funneled
// through ipcRenderer.invoke — the renderer can never touch Node, fetch Polygon
// directly, or read the apiSecret.
const bridge: PolygonBridge = {
  getCredentialsStatus: () => ipcRenderer.invoke(IPC.credentialsStatus),
  saveCredentials: (input) => ipcRenderer.invoke(IPC.credentialsSave, input),
  clearCredentials: () => ipcRenderer.invoke(IPC.credentialsClear),

  problemInfo: (problemId, pin) => ipcRenderer.invoke(IPC.problemInfo, problemId, pin),
  problemMeta: (problemId, pin) => ipcRenderer.invoke(IPC.problemMeta, problemId, pin),
  problemSolutions: (problemId, pin) =>
    ipcRenderer.invoke(IPC.problemSolutions, problemId, pin),
  problemTests: (problemId, testset, pin) =>
    ipcRenderer.invoke(IPC.problemTests, problemId, testset, pin),
  problemStatements: (problemId, pin) =>
    ipcRenderer.invoke(IPC.problemStatements, problemId, pin),
  problemFiles: (problemId, pin) => ipcRenderer.invoke(IPC.problemFiles, problemId, pin),

  problemPackages: (problemId, pin) =>
    ipcRenderer.invoke(IPC.problemPackages, problemId, pin),
  buildPackage: (problemId, full, verify, pin) =>
    ipcRenderer.invoke(IPC.problemBuildPackage, problemId, full, verify, pin),
  downloadPackage: (problemId, packageId, type, pin) =>
    ipcRenderer.invoke(IPC.problemDownloadPackage, problemId, packageId, type, pin),
  commitChanges: (problemId, message, pin) =>
    ipcRenderer.invoke(IPC.problemCommit, problemId, message, pin),

  createLocalProject: (name) => ipcRenderer.invoke(IPC.createLocalProject, name),
  createPolygonProblem: (path, name) =>
    ipcRenderer.invoke(IPC.createPolygonProblem, path, name),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  setProjectId: (path, problemId) =>
    ipcRenderer.invoke(IPC.setProjectId, path, problemId),
  importProblem: (problemId, pin) =>
    ipcRenderer.invoke(IPC.importProblem, problemId, pin),
  listProjects: () => ipcRenderer.invoke(IPC.projectsList),
  removeProject: (path) => ipcRenderer.invoke(IPC.projectRemove, path),
  revealProject: (path) => ipcRenderer.invoke(IPC.projectReveal, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),

  pullProject: (path, pin) => ipcRenderer.invoke(IPC.pullProject, path, pin),
  pushProject: (path, pin) => ipcRenderer.invoke(IPC.pushProject, path, pin),
  onSyncProgress: (callback) => {
    const listener = (_e: unknown, progress: Parameters<typeof callback>[0]) =>
      callback(progress);
    ipcRenderer.on(IPC.syncProgress, listener);
    return () => ipcRenderer.removeListener(IPC.syncProgress, listener);
  },
  watchProject: (path) => ipcRenderer.invoke(IPC.watchProject, path),
  unwatchProject: () => ipcRenderer.invoke(IPC.unwatchProject),
  onProjectChanged: (callback) => {
    const listener = (_e: unknown, path: string) => callback(path);
    ipcRenderer.on(IPC.projectChanged, listener);
    return () => ipcRenderer.removeListener(IPC.projectChanged, listener);
  },

  readProject: (path) => ipcRenderer.invoke(IPC.projectRead, path),
  readProjectUnit: (path, ref) => ipcRenderer.invoke(IPC.projectReadUnit, path, ref),
  saveFileEntry: (path, entry) =>
    ipcRenderer.invoke(IPC.projectSaveFileEntry, path, entry),
  saveSolutionEntry: (path, entry) =>
    ipcRenderer.invoke(IPC.projectSaveSolution, path, entry),
  saveStatementEntry: (path, entry) =>
    ipcRenderer.invoke(IPC.projectSaveStatement, path, entry),
  saveStatementResourceEntry: (path, entry) =>
    ipcRenderer.invoke(IPC.projectSaveStatementResource, path, entry),
  deleteProjectUnit: (path, ref) =>
    ipcRenderer.invoke(IPC.projectDeleteUnit, path, ref),
  saveInfoSlice: (path, slice) => ipcRenderer.invoke(IPC.projectSaveInfo, path, slice),
  saveTestset: (path, testset) => ipcRenderer.invoke(IPC.projectSaveTestset, path, testset),
  saveValidatorTests: (path, tests) =>
    ipcRenderer.invoke(IPC.projectSaveValidatorTests, path, tests),
  saveCheckerTests: (path, tests) =>
    ipcRenderer.invoke(IPC.projectSaveCheckerTests, path, tests),
  saveScript: (path, testset, script) =>
    ipcRenderer.invoke(IPC.projectSaveScript, path, testset, script),
  pushScript: (path, testset, pin) =>
    ipcRenderer.invoke(IPC.problemPushScript, path, testset, pin),
};

contextBridge.exposeInMainWorld("polygon", bridge);
