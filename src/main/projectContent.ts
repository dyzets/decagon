import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname, extname } from "node:path";
import type { FileType } from "../core/methods";
import type {
  ProjectCheckerTest,
  ProjectContent,
  ProjectFileEntry,
  ProjectFileRef,
  ProjectInfo,
  ProjectInfoSlice,
  ProjectSolutionEntry,
  ProjectStatementEntry,
  ProjectStatementResource,
  ProjectTestEntry,
  ProjectTestGroup,
  ProjectTestset,
  ProjectUnitSnapshot,
  ProjectValidatorTest,
} from "../shared/ipc";
import {
  MANIFEST,
  emptyManifest,
  readManifestSafe,
  writeManifest,
  type SyncManifest,
} from "./manifest";

// ---- Folder layout (single source of truth, shared with sync.ts) ----

// Statement field <-> filename mapping (one file per field for easy editing).
export const STATEMENT_FILES: Record<keyof StatementFields, string> = {
  name: "name.txt",
  legend: "legend.tex",
  input: "input.tex",
  output: "output.tex",
  scoring: "scoring.tex",
  interaction: "interaction.tex",
  notes: "notes.tex",
  tutorial: "tutorial.tex",
};

type StatementFields = Omit<ProjectStatementEntry, "lang" | "encoding">;
const STATEMENT_FIELD_KEYS = Object.keys(STATEMENT_FILES) as (keyof StatementFields)[];

// Extensions treated as Polygon "resource" files; everything else defaults to "source".
export const RESOURCE_EXT = new Set([
  ".h", ".hpp", ".hxx", ".hh", ".inc",
  ".sty", ".cls", ".css", ".txt", ".md",
  ".png", ".jpg", ".jpeg", ".gif", ".pdf",
]);

/** Name of the file holding info + checker/validator/interactor. */
const CONFIG = "config.json";
/** Files holding validator/checker test definitions. */
const VALIDATOR_TESTS = "validator-tests.json";
const CHECKER_TESTS = "checker-tests.json";
/** Subdirectory (under statements/) holding statement resource files. */
const RESOURCES_SUBDIR = ["statements", "resources"];

interface ProjectConfig {
  info: ProjectInfo;
  checker?: string;
  validator?: string;
  interactor?: string;
  /** Per-testset settings that have no Polygon getter (persisted locally). */
  testsetSettings?: Record<
    string,
    { enableGroups: boolean; groups?: ProjectTestGroup[] }
  >;
}

const DEFAULT_INFO: ProjectInfo = {
  inputFile: "",
  outputFile: "",
  interactive: false,
  wellFormed: true,
  enablePoints: "NO",
  timeLimit: 1000,
  memoryLimit: 256,
};

export function inferFileType(name: string): FileType {
  return RESOURCE_EXT.has(extname(name).toLowerCase()) ? "resource" : "source";
}

/** Treat a file as binary if it contains a NUL byte (good enough for source vs image). */
export function isBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

export function listFilesShallow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => {
    const full = join(dir, n);
    return statSync(full).isFile() && n !== MANIFEST;
  });
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
}

// ---- Read ----

/** Assemble the full editable project state from the folder. */
export function readProjectContent(dir: string): ProjectContent {
  const manifest =
    readManifestSafe(dir) ?? emptyManifest(0, undefined as unknown as string);

  const config = readConfig(dir);

  // Solutions and source/resource files now share the flat `files/` folder so the whole
  // problem lives in one place locally. The manifest's solutions[] list disambiguates
  // which names are solutions; everything else in files/ is a source/resource file.
  const solutionNames = new Set(manifest.solutions.map((s) => s.name));

  return {
    problemId: manifest.problemId,
    name: manifest.name,
    info: config.info,
    checker: config.checker,
    validator: config.validator,
    interactor: config.interactor,
    statements: readStatements(dir, manifest),
    statementResources: readStatementResources(dir),
    solutions: readSolutions(dir, manifest),
    files: readFiles(dir, manifest, solutionNames),
    testsets: readTestsets(dir, manifest, config),
    validatorTests: readJsonArray<ProjectValidatorTest>(join(dir, VALIDATOR_TESTS)),
    checkerTests: readJsonArray<ProjectCheckerTest>(join(dir, CHECKER_TESTS)),
  };
}

/** Path backing a solution: `files/<name>`, falling back to the legacy `solutions/` dir. */
function solutionPath(dir: string, name: string): string | null {
  const inFiles = join(dir, "files", name);
  if (existsSync(inFiles)) return inFiles;
  const legacy = join(dir, "solutions", name);
  if (existsSync(legacy)) return legacy;
  return null;
}

function readJsonArray<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStatementResources(dir: string): ProjectStatementResource[] {
  const resDir = join(dir, ...RESOURCES_SUBDIR);
  const out: ProjectStatementResource[] = [];
  for (const name of listFilesShallow(resDir)) {
    const buf = readFileSync(join(resDir, name));
    const binary = isBinary(buf);
    out.push({ name, content: binary ? "" : buf.toString("utf8"), binary });
  }
  return out;
}

function readConfig(dir: string): ProjectConfig {
  const path = join(dir, CONFIG);
  if (!existsSync(path)) return { info: { ...DEFAULT_INFO } };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ProjectConfig>;
    return {
      info: { ...DEFAULT_INFO, ...(parsed.info ?? {}) },
      checker: parsed.checker,
      validator: parsed.validator,
      interactor: parsed.interactor,
      testsetSettings: parsed.testsetSettings,
    };
  } catch {
    return { info: { ...DEFAULT_INFO } };
  }
}

function readStatements(dir: string, manifest: SyncManifest): ProjectStatementEntry[] {
  const statementsDir = join(dir, "statements");
  const langs = new Set<string>(manifest.statements.map((s) => s.lang));
  for (const d of listDirs(statementsDir)) {
    if (d !== "resources") langs.add(d);
  }
  const out: ProjectStatementEntry[] = [];
  for (const lang of langs) {
    const langDir = join(statementsDir, lang);
    const entry: ProjectStatementEntry = {
      lang,
      encoding: manifest.statements.find((s) => s.lang === lang)?.encoding,
    };
    for (const field of STATEMENT_FIELD_KEYS) {
      const file = join(langDir, STATEMENT_FILES[field]);
      if (existsSync(file)) entry[field] = readFileSync(file, "utf8");
    }
    out.push(entry);
  }
  return out.sort((a, b) => a.lang.localeCompare(b.lang));
}

// Solutions are listed authoritatively by the manifest (their files live in `files/`,
// flat alongside source files); the manifest is what tells them apart.
function readSolutions(dir: string, manifest: SyncManifest): ProjectSolutionEntry[] {
  const out: ProjectSolutionEntry[] = [];
  for (const meta of manifest.solutions) {
    const path = solutionPath(dir, meta.name);
    if (!path) continue; // removed from disk
    const buf = readFileSync(path);
    out.push({
      name: meta.name,
      tag: meta.tag ?? "OK",
      sourceType: meta.sourceType,
      content: isBinary(buf) ? "" : buf.toString("utf8"),
      push: meta.push ?? true,
    });
  }
  return out;
}

function readFiles(
  dir: string,
  manifest: SyncManifest,
  solutionNames: Set<string>,
): ProjectFileEntry[] {
  const out: ProjectFileEntry[] = [];
  for (const name of listFilesShallow(join(dir, "files"))) {
    if (solutionNames.has(name)) continue; // a solution, handled by readSolutions
    const buf = readFileSync(join(dir, "files", name));
    const binary = isBinary(buf);
    const meta = manifest.files.find((f) => f.name === name);
    const type = meta?.type ?? inferFileType(name);
    out.push({
      name,
      type,
      sourceType: meta?.sourceType,
      content: binary ? "" : buf.toString("utf8"),
      binary,
      // A file present on disk but absent from the manifest was created in the folder
      // externally — default it to local-only (push off). A manifest entry missing the
      // flag is a legacy project, kept as push-on for back-compat.
      push: meta ? meta.push ?? true : false,
      // Advanced properties only apply to resource files.
      resourceAdvancedProperties:
        type === "resource" ? meta?.resourceAdvancedProperties : undefined,
    });
  }
  return out;
}

function readTestsets(
  dir: string,
  manifest: SyncManifest,
  config: ProjectConfig,
): ProjectTestset[] {
  const names = new Set<string>(manifest.testsets ?? []);
  for (const f of listFilesShallow(join(dir, "tests"))) {
    if (f.endsWith(".json")) names.add(f.slice(0, -5));
  }
  for (const f of listFilesShallow(join(dir, "scripts"))) {
    if (f.endsWith(".txt")) names.add(f.slice(0, -4));
  }
  if (names.size === 0) names.add("tests");

  const out: ProjectTestset[] = [];
  for (const name of names) {
    out.push({
      name,
      tests: readTests(dir, name),
      script: readScript(dir, name),
      enableGroups: config.testsetSettings?.[name]?.enableGroups ?? false,
      groups: config.testsetSettings?.[name]?.groups ?? [],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function readTests(dir: string, testset: string): ProjectTestEntry[] {
  const path = join(dir, "tests", `${testset}.json`);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectTestEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Default policy for a newly-referenced group. */
function defaultGroup(name: string): ProjectTestGroup {
  return {
    name,
    pointsPolicy: "EACH_TEST",
    feedbackPolicy: "COMPLETE",
    dependencies: [],
  };
}

/**
 * Reconcile group metadata against the set of group names referenced by tests:
 * keep metadata for present groups, drop orphans, and default any new names.
 */
export function reconcileGroups(
  tests: ProjectTestEntry[],
  groups: ProjectTestGroup[],
): ProjectTestGroup[] {
  const present = new Set<string>();
  for (const t of tests) {
    if (t.group && t.group.trim() !== "") present.add(t.group);
  }
  return [...present]
    .sort()
    .map((name) => groups.find((g) => g.name === name) ?? defaultGroup(name));
}

function readScript(dir: string, testset: string): string {
  const path = join(dir, "scripts", `${testset}.txt`);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// ---- Write ----

/**
 * Persist the editable project state into the folder. The content is authoritative:
 * solutions/files/statements/testsets that were removed in the editor are deleted
 * from the folder. Binary files are left untouched (their content isn't editable).
 * The manifest is rewritten so metadata (types/tags/encodings/testsets) stays in sync.
 */
export function writeProjectContent(dir: string, content: ProjectContent): void {
  writeConfig(dir, content);
  writeStatements(dir, content.statements);
  writeStatementResources(dir, content.statementResources);
  writeFilesDir(dir, content.files, content.solutions);
  writeTestsets(dir, content.testsets);
  writeText(join(dir, VALIDATOR_TESTS), JSON.stringify(content.validatorTests, null, 2));
  writeText(join(dir, CHECKER_TESTS), JSON.stringify(content.checkerTests, null, 2));

  // Rebuild the manifest metadata from the content, preserving binding fields.
  const prev = readManifestSafe(dir);
  const manifest: SyncManifest = {
    problemId: content.problemId,
    name: content.name,
    pulledAt: prev?.pulledAt,
    files: content.files.map((f) => ({
      name: f.name,
      type: f.type,
      sourceType: f.sourceType,
      push: f.push,
      resourceAdvancedProperties:
        f.type === "resource" ? f.resourceAdvancedProperties : undefined,
    })),
    solutions: content.solutions.map((s) => ({
      name: s.name,
      tag: s.tag,
      sourceType: s.sourceType,
      push: s.push,
    })),
    statements: content.statements.map((s) => ({
      lang: s.lang,
      encoding: s.encoding,
    })),
    statementResources: content.statementResources.map((r) => ({ name: r.name })),
    testsets: content.testsets.map((t) => t.name),
  };
  writeManifest(dir, manifest);
}

function writeStatementResources(
  dir: string,
  resources: ProjectStatementResource[],
): void {
  const resDir = join(dir, ...RESOURCES_SUBDIR);
  const keep = new Set(resources.map((r) => r.name));
  for (const name of listFilesShallow(resDir)) {
    if (!keep.has(name)) rmSync(join(resDir, name), { force: true });
  }
  for (const r of resources) {
    if (r.binary) continue; // leave binary resources (e.g. images) untouched
    writeText(join(resDir, r.name), r.content);
  }
}

function writeConfig(dir: string, content: ProjectContent): void {
  const testsetSettings: Record<
    string,
    { enableGroups: boolean; groups: ProjectTestGroup[] }
  > = {};
  for (const ts of content.testsets) {
    testsetSettings[ts.name] = {
      enableGroups: ts.enableGroups,
      // Groups are derived from the tests: keep policy metadata only for group names
      // still referenced by a test, creating defaults for newly-referenced ones.
      groups: reconcileGroups(ts.tests, ts.groups),
    };
  }
  const config: ProjectConfig = {
    info: content.info,
    checker: content.checker || undefined,
    validator: content.validator || undefined,
    interactor: content.interactor || undefined,
    testsetSettings,
  };
  writeText(join(dir, CONFIG), JSON.stringify(config, null, 2));
}

function writeStatements(dir: string, statements: ProjectStatementEntry[]): void {
  const statementsDir = join(dir, "statements");
  const keep = new Set(statements.map((s) => s.lang));
  // Remove language folders no longer present (keep the shared "resources" dir).
  for (const d of listDirs(statementsDir)) {
    if (d !== "resources" && !keep.has(d)) {
      rmSync(join(statementsDir, d), { recursive: true, force: true });
    }
  }
  for (const st of statements) {
    const langDir = join(statementsDir, st.lang);
    for (const field of STATEMENT_FIELD_KEYS) {
      const file = join(langDir, STATEMENT_FILES[field]);
      const value = st[field];
      if (value !== undefined && value !== "") {
        writeText(file, value);
      } else if (existsSync(file)) {
        rmSync(file, { force: true });
      }
    }
  }
}

/**
 * Authoritative writer for the flat `files/` folder, which now holds both source/
 * resource files and solution files. Names present in neither list are deleted; binary
 * files are left untouched (their content isn't editable here).
 */
function writeFilesDir(
  dir: string,
  files: ProjectFileEntry[],
  solutions: ProjectSolutionEntry[],
): void {
  const filesDir = join(dir, "files");
  const keep = new Set<string>([
    ...files.map((f) => f.name),
    ...solutions.map((s) => s.name),
  ]);
  for (const name of listFilesShallow(filesDir)) {
    if (!keep.has(name)) rmSync(join(filesDir, name), { force: true });
  }
  for (const f of files) {
    if (f.binary) continue; // leave binary files untouched
    writeText(join(filesDir, f.name), f.content);
  }
  for (const s of solutions) {
    writeText(join(filesDir, s.name), s.content);
  }
}

function writeTestsets(dir: string, testsets: ProjectTestset[]): void {
  const testsDir = join(dir, "tests");
  const scriptsDir = join(dir, "scripts");
  const keepTests = new Set(testsets.map((t) => `${t.name}.json`));
  const keepScripts = new Set(testsets.map((t) => `${t.name}.txt`));
  for (const f of listFilesShallow(testsDir)) {
    if (f.endsWith(".json") && !keepTests.has(f)) rmSync(join(testsDir, f), { force: true });
  }
  for (const f of listFilesShallow(scriptsDir)) {
    if (f.endsWith(".txt") && !keepScripts.has(f)) {
      rmSync(join(scriptsDir, f), { force: true });
    }
  }
  for (const ts of testsets) {
    writeText(join(testsDir, `${ts.name}.json`), JSON.stringify(ts.tests, null, 2));
    writeText(join(scriptsDir, `${ts.name}.txt`), ts.script);
  }
}

// ---- Targeted per-unit save (per-file Save; non-authoritative) ----
//
// Unlike writeProjectContent (used only by Pull), these touch a single file unit and its
// own manifest/config entry, so a per-file save never deletes or clobbers siblings — that
// is what lets the editor detect and resolve external changes per file.

/** All disk paths backing a unit (statements span several field files). */
function unitPaths(dir: string, ref: ProjectFileRef): string[] {
  switch (ref.kind) {
    case "file":
      return [join(dir, "files", ref.name)];
    case "solution":
      // Solutions live in files/ now; include the legacy path so delete cleans both.
      return [join(dir, "files", ref.name), join(dir, "solutions", ref.name)];
    case "statementResource":
      return [join(dir, ...RESOURCES_SUBDIR, ref.name)];
    case "script":
      return [join(dir, "scripts", `${ref.testset}.txt`)];
    case "statement":
      return STATEMENT_FIELD_KEYS.map((f) =>
        join(dir, "statements", ref.lang, STATEMENT_FILES[f]),
      );
  }
}

/** Read one unit's current on-disk state (for external-change detection). */
export function readProjectUnit(dir: string, ref: ProjectFileRef): ProjectUnitSnapshot {
  if (ref.kind === "statement") {
    const langDir = join(dir, "statements", ref.lang);
    const fields: Record<string, string> = {};
    let exists = false;
    for (const field of STATEMENT_FIELD_KEYS) {
      const p = join(langDir, STATEMENT_FILES[field]);
      if (existsSync(p)) {
        fields[field] = readFileSync(p, "utf8");
        exists = true;
      }
    }
    const encoding = readManifestSafe(dir)?.statements.find(
      (s) => s.lang === ref.lang,
    )?.encoding;
    return { exists, binary: false, content: "", fields, encoding };
  }
  // Solutions may still sit in the legacy solutions/ dir until first re-saved.
  const path =
    ref.kind === "solution"
      ? solutionPath(dir, ref.name) ?? join(dir, "files", ref.name)
      : unitPaths(dir, ref)[0]!;
  if (!existsSync(path)) return { exists: false, binary: false, content: "" };
  const buf = readFileSync(path);
  const binary = isBinary(buf);
  return { exists: true, binary, content: binary ? "" : buf.toString("utf8") };
}

/** Read manifest (or an empty one), mutate it, and persist. */
function updateManifest(dir: string, fn: (m: SyncManifest) => void): void {
  const m = readManifestSafe(dir) ?? emptyManifest(0, undefined as unknown as string);
  fn(m);
  writeManifest(dir, m);
}

export function writeFileEntry(dir: string, entry: ProjectFileEntry): void {
  if (!entry.binary) writeText(join(dir, "files", entry.name), entry.content);
  updateManifest(dir, (m) => {
    // files/ and solutions[] share a namespace — a name is one or the other.
    m.solutions = m.solutions.filter((s) => s.name !== entry.name);
    m.files = [
      ...m.files.filter((f) => f.name !== entry.name),
      {
        name: entry.name,
        type: entry.type,
        sourceType: entry.sourceType,
        push: entry.push,
        resourceAdvancedProperties:
          entry.type === "resource" ? entry.resourceAdvancedProperties : undefined,
      },
    ];
  });
}

export function writeSolutionEntry(dir: string, entry: ProjectSolutionEntry): void {
  writeText(join(dir, "files", entry.name), entry.content);
  updateManifest(dir, (m) => {
    // files/ and solutions[] share a namespace — a name is one or the other.
    m.files = m.files.filter((f) => f.name !== entry.name);
    m.solutions = [
      ...m.solutions.filter((s) => s.name !== entry.name),
      { name: entry.name, tag: entry.tag, sourceType: entry.sourceType, push: entry.push },
    ];
  });
}

export function writeStatementEntry(dir: string, entry: ProjectStatementEntry): void {
  const langDir = join(dir, "statements", entry.lang);
  for (const field of STATEMENT_FIELD_KEYS) {
    const file = join(langDir, STATEMENT_FILES[field]);
    const value = entry[field];
    if (value !== undefined && value !== "") writeText(file, value);
    else if (existsSync(file)) rmSync(file, { force: true });
  }
  updateManifest(dir, (m) => {
    m.statements = [
      ...m.statements.filter((s) => s.lang !== entry.lang),
      { lang: entry.lang, encoding: entry.encoding },
    ];
  });
}

export function writeStatementResourceEntry(
  dir: string,
  entry: ProjectStatementResource,
): void {
  if (!entry.binary) writeText(join(dir, ...RESOURCES_SUBDIR, entry.name), entry.content);
  updateManifest(dir, (m) => {
    m.statementResources = [
      ...m.statementResources.filter((r) => r.name !== entry.name),
      { name: entry.name },
    ];
  });
}

/** Write a testset's generation script to the folder (push is a separate step). */
export function writeScript(dir: string, testset: string, script: string): void {
  writeText(join(dir, "scripts", `${testset}.txt`), script);
  updateManifest(dir, (m) => {
    m.testsets = [...new Set([...(m.testsets ?? []), testset])];
  });
}

/** Delete a unit's file(s) and drop its manifest entry. */
export function deleteUnit(dir: string, ref: ProjectFileRef): void {
  if (ref.kind === "statement") {
    rmSync(join(dir, "statements", ref.lang), { recursive: true, force: true });
    updateManifest(dir, (m) => {
      m.statements = m.statements.filter((s) => s.lang !== ref.lang);
    });
    return;
  }
  for (const p of unitPaths(dir, ref)) rmSync(p, { force: true });
  updateManifest(dir, (m) => {
    switch (ref.kind) {
      case "file":
        m.files = m.files.filter((f) => f.name !== ref.name);
        break;
      case "solution":
        m.solutions = m.solutions.filter((s) => s.name !== ref.name);
        break;
      case "statementResource":
        m.statementResources = m.statementResources.filter((r) => r.name !== ref.name);
        break;
      case "script":
        // The script file is gone, but keep the testset (its tests may still exist).
        break;
    }
  });
}

// ---- Targeted metadata-slice saves (non-file tabs) ----

export function writeInfoSlice(dir: string, slice: ProjectInfoSlice): void {
  const config = readConfig(dir);
  config.info = slice.info;
  config.checker = slice.checker || undefined;
  config.validator = slice.validator || undefined;
  config.interactor = slice.interactor || undefined;
  writeText(join(dir, CONFIG), JSON.stringify(config, null, 2));
}

/** Persist one testset's tests + group/points settings (not the script). */
export function writeTestsetMeta(dir: string, ts: ProjectTestset): void {
  writeText(join(dir, "tests", `${ts.name}.json`), JSON.stringify(ts.tests, null, 2));
  const config = readConfig(dir);
  config.testsetSettings = config.testsetSettings ?? {};
  config.testsetSettings[ts.name] = {
    enableGroups: ts.enableGroups,
    groups: reconcileGroups(ts.tests, ts.groups),
  };
  writeText(join(dir, CONFIG), JSON.stringify(config, null, 2));
  updateManifest(dir, (m) => {
    m.testsets = [...new Set([...(m.testsets ?? []), ts.name])];
  });
}

export function writeValidatorTestsFile(
  dir: string,
  tests: ProjectValidatorTest[],
): void {
  writeText(join(dir, VALIDATOR_TESTS), JSON.stringify(tests, null, 2));
}

export function writeCheckerTestsFile(dir: string, tests: ProjectCheckerTest[]): void {
  writeText(join(dir, CHECKER_TESTS), JSON.stringify(tests, null, 2));
}
