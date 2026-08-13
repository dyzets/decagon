// Shared IPC contract referenced by main, preload, and renderer.
// Keeping channel names + payload/return types in one place keeps the bridge typed
// end-to-end and prevents drift between processes.

import type {
  CheckerVerdict,
  FeedbackPolicy,
  Package,
  PointsPolicy,
  Problem,
  ProblemFiles,
  ProblemInfo,
  ResourceAdvancedProperties,
  Solution,
  SolutionTag,
  Statements,
  Test,
  ValidatorVerdict,
} from "../core/types";

/** How per-test points are handled (Polygon "Enable points" dropdown). */
export type PointsEnableMode = "NO" | "YES" | "PERCENT";
import type { FileType } from "../core/methods";

/** IPC channel names. */
export const IPC = {
  // credentials (stored encrypted in main; renderer never sees the secret)
  credentialsStatus: "credentials:status",
  credentialsSave: "credentials:save",
  credentialsClear: "credentials:clear",
  // app preferences (userData/settings.json)
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  // polygon API for a single problem (executed in main using stored credentials)
  problemInfo: "polygon:problem.info",
  problemSolutions: "polygon:problem.solutions",
  problemTests: "polygon:problem.tests",
  problemStatements: "polygon:problem.statements",
  problemFiles: "polygon:problem.files",
  problemMeta: "polygon:problem.meta",
  problemPackages: "polygon:problem.packages",
  problemBuildPackage: "polygon:problem.buildPackage",
  problemDownloadPackage: "polygon:problem.downloadPackage",
  problemCommit: "polygon:problem.commitChanges",
  // create / import + projects
  createLocalProject: "projects:createLocal", // scaffold a local folder, no Polygon id yet
  createPolygonProblem: "projects:createPolygon", // create a problem on Polygon, bind to a folder
  openProject: "projects:open", // register an existing Decagon project folder
  setProjectId: "projects:setId", // (re)bind a project folder to a Polygon problem id
  importProblem: "projects:import", // pull an existing problem by id into a new project
  projectsList: "projects:list",
  projectRemove: "projects:remove",
  projectReveal: "projects:reveal",
  openExternal: "shell:openExternal",
  // pull/push using a known project path (problemId comes from the folder manifest)
  pullProject: "sync:pullProject",
  pushProject: "sync:pushProject",
  // main → renderer progress events emitted during a pull/push
  syncProgress: "sync:progress",
  // watch a project folder for on-disk changes (auto-reload)
  watchProject: "sync:watchProject",
  unwatchProject: "sync:unwatchProject",
  projectChanged: "sync:projectChanged",
  // local project editing (reads/writes the project folder only — no network)
  projectRead: "project:read",
  // targeted per-unit folder saves (no network) + a single Polygon script push
  projectReadUnit: "project:readUnit",
  projectSaveFileEntry: "project:saveFileEntry",
  projectSaveSolution: "project:saveSolution",
  projectSaveStatement: "project:saveStatement",
  projectSaveStatementResource: "project:saveStatementResource",
  projectDeleteUnit: "project:deleteUnit",
  projectSaveInfo: "project:saveInfo",
  projectSaveTestset: "project:saveTestset",
  projectSaveScript: "project:saveScript",
  projectSaveValidatorTests: "project:saveValidatorTests",
  projectSaveCheckerTests: "project:saveCheckerTests",
  problemPushScript: "polygon:problem.saveScript",
} as const;

/**
 * Progress event emitted from main during a pull/push so the UI can show how far
 * along it is. `total === 0` marks an indeterminate phase (just show the label).
 */
export interface SyncProgress {
  op: "pull" | "push";
  /** Human-readable phase label, e.g. "Uploading files". */
  phase: string;
  /** Units completed in this phase. */
  current: number;
  /** Units in this phase (0 = indeterminate). */
  total: number;
}

/** Counts returned by a pull/push operation. */
export interface SyncSummary {
  files: number;
  solutions: number;
  statements: number;
  statementResources: number;
  validatorTests: number;
  checkerTests: number;
}

/**
 * A local project folder (assembled from its manifest). `problemId` is `0` when the
 * project is not yet bound to a Polygon problem — bind one later via setProjectId or
 * createPolygonProblem. Pull/push/commit and the live-API tabs require a non-zero id.
 */
export interface ProjectEntry {
  path: string;
  problemId: number;
  name: string;
}

// --- Local project content (the editable state mirrored in the project folder) ---

/** Problem general info (limits, I/O, interactive flag). */
export interface ProjectInfo {
  inputFile: string;
  outputFile: string;
  interactive: boolean;
  /** "Tests well-formed" flag on Polygon. */
  wellFormed: boolean;
  /** Per-test points mode (set-only on Polygon; persisted locally). */
  enablePoints: PointsEnableMode;
  timeLimit: number; // ms
  memoryLimit: number; // MB
}

/** A source/resource/aux file with its content (content empty when binary). */
export interface ProjectFileEntry {
  name: string;
  type: FileType;
  sourceType?: string;
  content: string;
  binary: boolean;
  /** Whether this file is uploaded on Push to Polygon (false = local-only). */
  push: boolean;
  /** Grader advanced properties (resource files only; experimental Polygon feature). */
  resourceAdvancedProperties?: ResourceAdvancedProperties;
}

/** A solution with its source content. Stored alongside source files in `files/`. */
export interface ProjectSolutionEntry {
  name: string;
  tag: SolutionTag;
  sourceType?: string;
  content: string;
  /** Whether this solution is uploaded on Push to Polygon (false = local-only). */
  push: boolean;
}

/** A single-language statement (all fields editable). */
export interface ProjectStatementEntry {
  lang: string;
  encoding?: string;
  name?: string;
  legend?: string;
  input?: string;
  output?: string;
  scoring?: string;
  interaction?: string;
  notes?: string;
  tutorial?: string;
}

/** A single test (manual tests carry inline input; generated ones a scriptLine). */
export interface ProjectTestEntry {
  index: number;
  manual: boolean;
  input?: string;
  description?: string;
  useInStatements?: boolean;
  scriptLine?: string;
  group?: string;
  points?: number;
}

/** A test group's scoring/feedback policy and dependencies. */
export interface ProjectTestGroup {
  name: string;
  pointsPolicy: PointsPolicy;
  feedbackPolicy: FeedbackPolicy;
  /** Names of groups that must be solved before this one is judged. */
  dependencies: string[];
}

/** A testset: its tests plus the generation script. */
export interface ProjectTestset {
  name: string;
  tests: ProjectTestEntry[];
  script: string;
  /** Whether test groups are enabled for this testset (set-only; persisted locally). */
  enableGroups: boolean;
  /** Group policies for this testset. */
  groups: ProjectTestGroup[];
}

/** A statement resource file (images, .sty, …) shared by all statements. */
export interface ProjectStatementResource {
  name: string;
  content: string; // empty when binary
  binary: boolean;
}

/** A validator test (input + the verdict the validator must produce). */
export interface ProjectValidatorTest {
  index: number;
  input: string;
  verdict: ValidatorVerdict;
  group?: string;
  testset?: string;
}

/** A checker test (input/output/answer + the verdict the checker must produce). */
export interface ProjectCheckerTest {
  index: number;
  input: string;
  output: string;
  answer: string;
  verdict: CheckerVerdict;
}

/**
 * The full editable state of a project, assembled from the project folder.
 * Read with readProject; individual units are persisted with the targeted saveXxx
 * methods (per-file Save), and Push uploads the saved folder.
 */
export interface ProjectContent {
  problemId: number;
  name?: string;
  info: ProjectInfo;
  checker?: string;
  validator?: string;
  interactor?: string;
  statements: ProjectStatementEntry[];
  statementResources: ProjectStatementResource[];
  solutions: ProjectSolutionEntry[];
  files: ProjectFileEntry[];
  testsets: ProjectTestset[];
  validatorTests: ProjectValidatorTest[];
  checkerTests: ProjectCheckerTest[];
}

/** Addresses a single on-disk file unit for targeted save / read / delete. */
export type ProjectFileRef =
  | { kind: "file"; name: string } // files/<name>
  | { kind: "solution"; name: string } // solutions/<name>
  | { kind: "statement"; lang: string } // statements/<lang>/<field files>
  | { kind: "statementResource"; name: string } // statements/resources/<name>
  | { kind: "script"; testset: string }; // scripts/<testset>.txt

/**
 * Snapshot of a file unit's current on-disk state, used to detect external changes.
 * `content` carries the raw file text for single-file units; statement units use
 * `fields` (per statement field) instead since one language spans several files.
 */
export interface ProjectUnitSnapshot {
  exists: boolean;
  binary: boolean;
  content: string;
  fields?: Record<string, string>;
  encoding?: string;
}

/** Info-tab slice persisted together (general info + checker/validator/interactor). */
export interface ProjectInfoSlice {
  info: ProjectInfo;
  checker?: string;
  validator?: string;
  interactor?: string;
}

export interface CredentialsStatus {
  /** Whether apiKey/apiSecret are currently stored. */
  configured: boolean;
  /** The apiKey (safe to show); secret is never returned. */
  apiKey?: string;
}

export interface SaveCredentialsInput {
  apiKey: string;
  apiSecret: string;
}

/** User-adjustable app preferences (persisted in userData/settings.json). */
export interface AppSettings {
  /**
   * Max Polygon requests in flight during pull/push. Polygon rate-limits the API and
   * doesn't publish the limit, so this is user-tunable: lower it when a push fails
   * with "Too many requests", raise it for speed. 1 = fully sequential.
   */
  syncConcurrency: number;
  /**
   * Minimum delay (ms) between two Polygon requests, across all in-flight workers.
   * 0 = no artificial spacing. Raise it if lowering the concurrency isn't enough.
   */
  requestIntervalMs: number;
  /**
   * How many times a request rejected as "too many requests" is retried with
   * exponential backoff before the sync fails. 0 = fail immediately.
   */
  maxRetries: number;
}

/**
 * The typed API exposed on `window.polygon` in the renderer via contextBridge.
 * Every call is forwarded over IPC to the main process.
 */
export interface PolygonBridge {
  getCredentialsStatus(): Promise<CredentialsStatus>;
  saveCredentials(input: SaveCredentialsInput): Promise<CredentialsStatus>;
  clearCredentials(): Promise<CredentialsStatus>;

  /** Read the persisted app preferences. */
  getSettings(): Promise<AppSettings>;
  /** Persist (partial) app preferences; returns the stored, clamped result. */
  saveSettings(input: Partial<AppSettings>): Promise<AppSettings>;

  problemInfo(problemId: number, pin?: string): Promise<ProblemInfo>;
  /** Resolve a problem's metadata (owner, name, accessType, revision, …). */
  problemMeta(problemId: number, pin?: string): Promise<Problem | null>;
  problemSolutions(problemId: number, pin?: string): Promise<Solution[]>;
  problemTests(problemId: number, testset?: string, pin?: string): Promise<Test[]>;
  problemStatements(problemId: number, pin?: string): Promise<Statements>;
  problemFiles(problemId: number, pin?: string): Promise<ProblemFiles>;

  // Packages
  problemPackages(problemId: number, pin?: string): Promise<Package[]>;
  buildPackage(
    problemId: number,
    full: boolean,
    verify: boolean,
    pin?: string,
  ): Promise<void>;
  /** Opens a save dialog; returns the saved path, or null if cancelled. */
  downloadPackage(
    problemId: number,
    packageId: number,
    type?: string,
    pin?: string,
  ): Promise<string | null>;
  commitChanges(problemId: number, message: string, pin?: string): Promise<void>;

  // Create / import + projects
  /** Scaffold a local project folder you pick (no Polygon problem yet — bind an id later). */
  createLocalProject(name: string): Promise<ProjectEntry | null>;
  /** Create a fresh problem on Polygon and bind it to an existing local project folder. */
  createPolygonProblem(path: string, name: string): Promise<ProjectEntry>;
  /** Register an existing Decagon project folder you pick. */
  openProject(): Promise<ProjectEntry | null>;
  /** Bind (or rebind) a project folder to a Polygon problem id (0 to unbind). */
  setProjectId(path: string, problemId: number): Promise<ProjectEntry>;
  /** Import an existing Polygon problem by id: pulls it into a folder you pick. */
  importProblem(problemId: number, pin?: string): Promise<ProjectEntry | null>;
  listProjects(): Promise<ProjectEntry[]>;
  removeProject(path: string): Promise<ProjectEntry[]>;
  revealProject(path: string): Promise<void>;
  /** Open a URL in the user's default browser. */
  openExternal(url: string): Promise<void>;

  // Pull/push a project by its folder path; the problemId comes from the manifest.
  pullProject(path: string, pin?: string): Promise<SyncSummary>;
  pushProject(path: string, pin?: string): Promise<SyncSummary>;
  /** Subscribe to pull/push progress events. Returns an unsubscribe function. */
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
  /** Start watching a project folder for on-disk changes (replaces any prior watch). */
  watchProject(path: string): Promise<void>;
  /** Stop watching the current project folder. */
  unwatchProject(): Promise<void>;
  /** Subscribe to "folder changed on disk" events. Returns an unsubscribe function. */
  onProjectChanged(callback: (path: string) => void): () => void;

  // Read the editable project content from the local folder (no network).
  readProject(path: string): Promise<ProjectContent>;

  // Targeted per-unit folder reads/saves/deletes (no network). Each save touches only
  // its own file(s) + manifest entry, so concurrent external edits to other files are
  // never clobbered. readProjectUnit re-reads one unit's disk state for conflict checks.
  readProjectUnit(path: string, ref: ProjectFileRef): Promise<ProjectUnitSnapshot>;
  saveFileEntry(path: string, entry: ProjectFileEntry): Promise<void>;
  saveSolutionEntry(path: string, entry: ProjectSolutionEntry): Promise<void>;
  saveStatementEntry(path: string, entry: ProjectStatementEntry): Promise<void>;
  saveStatementResourceEntry(
    path: string,
    entry: ProjectStatementResource,
  ): Promise<void>;
  deleteProjectUnit(path: string, ref: ProjectFileRef): Promise<void>;
  saveInfoSlice(path: string, slice: ProjectInfoSlice): Promise<void>;
  saveTestset(path: string, testset: ProjectTestset): Promise<void>;
  saveValidatorTests(path: string, tests: ProjectValidatorTest[]): Promise<void>;
  saveCheckerTests(path: string, tests: ProjectCheckerTest[]): Promise<void>;
  /** Write a testset's generation script to the folder. */
  saveScript(path: string, testset: string, script: string): Promise<void>;
  /** Push a testset's (already-saved) generation script up to Polygon. */
  pushScript(path: string, testset: string, pin?: string): Promise<void>;
}
