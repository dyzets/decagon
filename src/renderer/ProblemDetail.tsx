import { useEffect, useRef, useState } from "react";
import type {
  CheckerVerdict,
  FeedbackPolicy,
  Package,
  PointsPolicy,
  ResourceAdvancedProperties,
  ResourceAsset,
  ResourceStage,
  SolutionTag,
  ValidatorVerdict,
} from "../core/types";
import type {
  PointsEnableMode,
  ProjectCheckerTest,
  ProjectContent,
  ProjectFileEntry,
  ProjectFileRef,
  ProjectSolutionEntry,
  ProjectStatementEntry,
  ProjectStatementResource,
  ProjectTestEntry,
  ProjectTestGroup,
  ProjectTestset,
  ProjectUnitSnapshot,
  ProjectValidatorTest,
  SyncProgress,
  SyncSummary,
} from "../shared/ipc";
import { NotificationsPanel, StatusSidebar } from "./StatusSidebar";
import { useToast } from "./Toast";
import { deriveTests, applyTestOrder } from "./testScript";

function describeSync(s: SyncSummary): string {
  return (
    `${s.files} files, ${s.solutions} solutions, ${s.statements} statements, ` +
    `${s.statementResources} resources, ${s.validatorTests} validator tests, ` +
    `${s.checkerTests} checker tests`
  );
}

/** Inline pull/push progress: the current phase label, a counter, and a thin bar. */
function SyncProgressBar({ progress }: { progress: SyncProgress }): JSX.Element {
  const verb = progress.op === "pull" ? "Pulling" : "Pushing";
  const hasTotal = progress.total > 0;
  const pct = hasTotal ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className="sync-progress" title={`${verb}…`}>
      <span className="muted">
        {progress.phase}
        {hasTotal ? ` ${progress.current}/${progress.total}` : "…"}
      </span>
      <span className="sync-progress-track">
        <span
          className={`sync-progress-fill${hasTotal ? "" : " indeterminate"}`}
          style={hasTotal ? { width: `${pct}%` } : undefined}
        />
      </span>
    </div>
  );
}

type TabId =
  | "info"
  | "statements"
  | "files"
  | "tests"
  | "validator"
  | "checker"
  | "packages"
  | "commit"
  | "access";

const TABS: { id: TabId; label: string }[] = [
  { id: "info", label: "Info" },
  { id: "statements", label: "Statements" },
  { id: "files", label: "Files" },
  { id: "tests", label: "Tests" },
  { id: "validator", label: "Validator tests" },
  { id: "checker", label: "Checker tests" },
  { id: "packages", label: "Packages" },
  { id: "commit", label: "Commit" },
  { id: "access", label: "Manage access" },
];

const CHECKER_VERDICTS: CheckerVerdict[] = [
  "OK",
  "WRONG_ANSWER",
  "PRESENTATION_ERROR",
  "CRASHED",
];

const VALIDATOR_VERDICTS: ValidatorVerdict[] = ["VALID", "INVALID"];

const POINTS_MODES: { value: PointsEnableMode; label: string }[] = [
  { value: "NO", label: "No" },
  { value: "YES", label: "Yes" },
  { value: "PERCENT", label: "Treat points from checker as a percent" },
];

const POINTS_POLICIES: PointsPolicy[] = ["COMPLETE_GROUP", "EACH_TEST"];
const FEEDBACK_POLICIES: FeedbackPolicy[] = ["NONE", "POINTS", "ICPC", "COMPLETE"];

const SOLUTION_TAGS: SolutionTag[] = [
  "MA", "OK", "RJ", "TL", "TO", "TM", "WA", "PE", "ML", "NR", "RE",
];

/** Human-readable label for each Polygon solution tag, so users needn't memorize codes. */
const SOLUTION_TAG_LABELS: Record<SolutionTag, string> = {
  MA: "Main correct solution",
  OK: "Correct",
  RJ: "Incorrect (rejected — any verdict)",
  TL: "Time limit exceeded",
  TO: "Time limit exceeded or accepted",
  TM: "Time limit exceeded or memory limit exceeded",
  WA: "Wrong answer",
  PE: "Presentation error",
  ML: "Memory limit exceeded",
  NR: "Do not run",
  RE: "Runtime error",
};

/**
 * UI categories for a unit in the Files tab. "solution" is stored as a solution entry
 * (with a tag); "source"/"resource"/"aux" are Polygon file types. Picking a different
 * category in a unit's Type dropdown moves it between the sections.
 */
type FileCategory = "solution" | "source" | "resource" | "aux";
const FILE_CATEGORIES: FileCategory[] = ["solution", "source", "resource", "aux"];
const CATEGORY_LABELS: Record<FileCategory, string> = {
  solution: "Solution",
  source: "Source",
  resource: "Resource",
  aux: "Attachment",
};

// Resource advanced properties (graders) — Polygon supports only cpp.* and python.*.
const RESOURCE_LANG_GROUPS = ["cpp.*", "python.*"];
const RESOURCE_STAGES: { value: ResourceStage; label: string }[] = [
  { value: "COMPILE", label: "Compile time" },
  { value: "RUN", label: "Runtime" },
];
const RESOURCE_ASSETS: ResourceAsset[] = [
  "VALIDATOR",
  "INTERACTOR",
  "CHECKER",
  "SOLUTION",
];
const RESOURCE_ASSET_LABELS: Record<ResourceAsset, string> = {
  VALIDATOR: "Validator",
  INTERACTOR: "Interactor",
  CHECKER: "Checker",
  SOLUTION: "Solution",
};

/** Default advanced properties when the feature is first enabled on a resource. */
function defaultAdvancedProperties(): ResourceAdvancedProperties {
  return { forTypes: "cpp.*", main: false, stages: ["COMPILE"], assets: ["SOLUTION"] };
}

/** Short human-readable summary of advanced properties for a file's summary line. */
function describeAdvanced(adv?: ResourceAdvancedProperties): string | null {
  if (!adv || adv.forTypes.trim() === "") return null;
  const parts = [adv.forTypes];
  if (adv.stages.length) parts.push(`stages: ${adv.stages.join(", ").toLowerCase()}`);
  if (adv.assets.length)
    parts.push(`assets: ${adv.assets.map((a) => a.toLowerCase()).join(", ")}`);
  return parts.join(" · ");
}

const STATEMENT_FIELDS: Array<keyof ProjectStatementEntry> = [
  "name",
  "legend",
  "input",
  "output",
  "scoring",
  "interaction",
  "notes",
  "tutorial",
];

// ---- Per-file save + external-change detection ----

/** Stable map key for a file unit. */
function refId(ref: ProjectFileRef): string {
  switch (ref.kind) {
    case "statement":
      return `statement:${ref.lang}`;
    case "script":
      return `script:${ref.testset}`;
    default:
      return `${ref.kind}:${ref.name}`;
  }
}

/** Compare two on-disk snapshots; binary units never conflict (not editable here). */
function snapshotEqual(a: ProjectUnitSnapshot, b: ProjectUnitSnapshot): boolean {
  if (a.binary || b.binary) return true;
  if (a.fields || b.fields) {
    const af = a.fields ?? {};
    const bf = b.fields ?? {};
    return STATEMENT_FIELDS.every(
      (f) => (af[f as string] ?? "") === (bf[f as string] ?? ""),
    );
  }
  return a.content === b.content;
}

/** Build the snapshot the app *would* write for a unit, to seed/refresh its baseline. */
function snapshotFromContent(
  ref: ProjectFileRef,
  content: ProjectContent,
): ProjectUnitSnapshot {
  switch (ref.kind) {
    case "file": {
      const f = content.files.find((x) => x.name === ref.name);
      return f
        ? { exists: true, binary: f.binary, content: f.content }
        : { exists: false, binary: false, content: "" };
    }
    case "solution": {
      const s = content.solutions.find((x) => x.name === ref.name);
      return { exists: !!s, binary: false, content: s?.content ?? "" };
    }
    case "statementResource": {
      const r = content.statementResources.find((x) => x.name === ref.name);
      return r
        ? { exists: true, binary: r.binary, content: r.content }
        : { exists: false, binary: false, content: "" };
    }
    case "script": {
      const ts = content.testsets.find((x) => x.name === ref.testset);
      return { exists: !!ts, binary: false, content: ts?.script ?? "" };
    }
    case "statement": {
      const st = content.statements.find((x) => x.lang === ref.lang);
      const fields: Record<string, string> = {};
      if (st) {
        for (const f of STATEMENT_FIELDS) {
          const v = st[f];
          if (typeof v === "string" && v !== "") fields[f as string] = v;
        }
      }
      return { exists: !!st, binary: false, content: "", fields };
    }
  }
}

/** Build the initial baselines map (one snapshot per file-backed unit) from a load. */
function buildBaselines(content: ProjectContent): Map<string, ProjectUnitSnapshot> {
  const m = new Map<string, ProjectUnitSnapshot>();
  const add = (ref: ProjectFileRef): void => {
    m.set(refId(ref), snapshotFromContent(ref, content));
  };
  for (const f of content.files) add({ kind: "file", name: f.name });
  for (const s of content.solutions) add({ kind: "solution", name: s.name });
  for (const st of content.statements) add({ kind: "statement", lang: st.lang });
  for (const r of content.statementResources)
    add({ kind: "statementResource", name: r.name });
  for (const ts of content.testsets) add({ kind: "script", testset: ts.name });
  return m;
}

/**
 * The save surface passed to file-backed editor cards: per-unit save with a conflict
 * check, an open/edit conflict check, and dirty bookkeeping.
 */
interface SaveApi {
  dirty: Set<string>;
  isDirty(id: string): boolean;
  markDirty(id: string): void;
  clearDirty(id: string): void;
  /** Save one unit (writes the folder) after checking for external changes. */
  saveUnit(opts: {
    ref: ProjectFileRef;
    id: string;
    write: () => Promise<void>;
    /** Replace the in-memory unit with the on-disk version (user chose "use local"). */
    applyLocal: (disk: ProjectUnitSnapshot) => void;
    label?: string;
  }): Promise<void>;
  /** Check for an external change when a unit's editor is opened/focused. */
  checkOnOpen(
    ref: ProjectFileRef,
    id: string,
    applyLocal: (disk: ProjectUnitSnapshot) => void,
  ): void;
  /** Re-read a unit from disk and store it as the new external-change baseline. */
  refreshBaseline(ref: ProjectFileRef): Promise<void>;
}

export function ProblemDetail({
  path,
  problemId,
  problemName,
  onBack,
}: {
  path: string;
  problemId: number;
  problemName: string;
  onBack: () => void;
}): JSX.Element {
  const [content, setContent] = useState<ProjectContent | null>(null);
  // Per-unit on-disk baselines (captured at load/save) to detect external changes.
  const [baselines, setBaselines] = useState<Map<string, ProjectUnitSnapshot>>(new Map());
  // Ids of sections/units with unsaved in-memory edits.
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("info");
  // Bumped after each load/pull/push so the status sidebar re-fetches live metadata.
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [conflict, setConflict] = useState<{
    ref: ProjectFileRef;
    disk: ProjectUnitSnapshot;
    resolve: (choice: "keep" | "local") => void;
  } | null>(null);
  const toast = useToast();

  async function load(): Promise<void> {
    setError(null);
    try {
      const c = await window.polygon.readProject(path);
      setContent(c);
      setBaselines(buildBaselines(c));
      setDirty(new Set());
      setStatusRefresh((n) => n + 1);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Live pull/push progress from main, shown in the savebar while busy.
  useEffect(() => window.polygon.onSyncProgress(setProgress), []);

  // Auto-reload: watch the project folder and reload when it changes on disk. We skip
  // reloading while busy (pull/push reload themselves) or when there are unsaved edits —
  // those are surfaced per-unit by the existing external-change conflict prompts, so a
  // blanket reload never clobbers work in progress.
  const dirtyRef = useRef(dirty);
  const busyRef = useRef(busy);
  dirtyRef.current = dirty;
  busyRef.current = busy;
  useEffect(() => {
    void window.polygon.watchProject(path);
    const off = window.polygon.onProjectChanged((changed) => {
      if (changed !== path || busyRef.current !== null || dirtyRef.current.size > 0) {
        return;
      }
      void load();
    });
    return () => {
      off();
      void window.polygon.unwatchProject();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Apply an immutable patch to the loaded content and mark its section dirty.
  function update(mut: (c: ProjectContent) => ProjectContent, id?: string): void {
    setContent((prev) => (prev ? mut(prev) : prev));
    if (id) setDirty((d) => new Set(d).add(id));
  }
  function clearDirty(id: string): void {
    setDirty((d) => {
      const n = new Set(d);
      n.delete(id);
      return n;
    });
  }
  function setBaseline(rid: string, snap: ProjectUnitSnapshot): void {
    setBaselines((b) => new Map(b).set(rid, snap));
  }

  function requestConflict(
    ref: ProjectFileRef,
    disk: ProjectUnitSnapshot,
  ): Promise<"keep" | "local"> {
    return new Promise((resolve) => {
      setConflict({
        ref,
        disk,
        resolve: (choice) => {
          setConflict(null);
          resolve(choice);
        },
      });
    });
  }

  // Save surface shared by the file-backed editor cards.
  const saveApi: SaveApi = {
    dirty,
    isDirty: (id) => dirty.has(id),
    markDirty: (id) => setDirty((d) => new Set(d).add(id)),
    clearDirty,
    async saveUnit({ ref, id, write, applyLocal, label }) {
      const rid = refId(ref);
      let disk: ProjectUnitSnapshot;
      try {
        disk = await window.polygon.readProjectUnit(path, ref);
      } catch {
        disk = { exists: false, binary: false, content: "" };
      }
      const base = baselines.get(rid);
      // Saving over an externally-changed file — ask before overwriting.
      if (base && !snapshotEqual(disk, base)) {
        const choice = await requestConflict(ref, disk);
        if (choice === "local") {
          applyLocal(disk);
          setBaseline(rid, disk);
          clearDirty(id);
          toast.show("Loaded the on-disk version.");
          return;
        }
      }
      try {
        await write();
        // Re-read so the baseline exactly matches what's now on disk.
        const fresh = await window.polygon
          .readProjectUnit(path, ref)
          .catch(() => null);
        if (fresh) setBaseline(rid, fresh);
        clearDirty(id);
        toast.success(`Saved ${label ?? "file"}.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    checkOnOpen(ref, id, applyLocal) {
      const rid = refId(ref);
      const base = baselines.get(rid);
      if (!base) return;
      void (async () => {
        let disk: ProjectUnitSnapshot;
        try {
          disk = await window.polygon.readProjectUnit(path, ref);
        } catch {
          return;
        }
        if (snapshotEqual(disk, base)) return;
        const choice = await requestConflict(ref, disk);
        if (choice === "local") {
          applyLocal(disk);
          setBaseline(rid, disk);
          clearDirty(id);
        } else {
          // Keep the app version: acknowledge the on-disk state so we stop prompting, and
          // mark the unit dirty so its Save is enabled to overwrite the changed file.
          setBaseline(rid, disk);
          setDirty((d) => new Set(d).add(id));
        }
      })();
    },
    async refreshBaseline(ref) {
      const rid = refId(ref);
      const disk = await window.polygon.readProjectUnit(path, ref).catch(() => null);
      if (disk) setBaseline(rid, disk);
    },
  };

  async function pull(): Promise<void> {
    if (
      dirty.size > 0 &&
      !window.confirm("Discard unsaved changes and pull from Polygon?")
    ) {
      return;
    }
    setBusy("pull");
    setProgress(null);
    setError(null);
    try {
      const s = await window.polygon.pullProject(path);
      await load();
      toast.success(`Pulled from Polygon: ${describeSync(s)}.`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  /** Push the saved folder contents to Polygon (only saved files are uploaded). */
  async function push(): Promise<void> {
    if (!content) return;
    if (
      dirty.size > 0 &&
      !window.confirm(
        `You have ${dirty.size} unsaved item(s). Push only uploads files you've saved to ` +
          `the folder — unsaved edits won't go to Polygon. Continue?`,
      )
    ) {
      return;
    }
    setBusy("push");
    setProgress(null);
    setError(null);
    try {
      const s = await window.polygon.pushProject(path);
      toast.success(`Pushed to Polygon: ${describeSync(s)}.`);
      // Pushing scripts generates tests/groups and deletions are applied — re-pull so the
      // updated state (and baselines) show up locally.
      await window.polygon.pullProject(path);
      await load();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  // The live problem id comes from the folder manifest (via content) so it stays correct
  // after rebinding; fall back to the id the row was opened with until content loads.
  const pid = content?.problemId ?? problemId;

  return (
    <div className="detail-layout">
      <div className="detail-main">
      <div className="row">
        <button className="link" onClick={onBack}>
          ← Back
        </button>
        <span className="muted">{pid ? `#${pid}` : "(not bound)"}</span>
      </div>
      <h2>{problemName}</h2>
      <p className="muted">
        Editing the local project folder. Each file has its own <strong>Save</strong>{" "}
        (writes that file to the folder); <strong>Push to Polygon</strong> uploads the
        saved folder. <strong>Pull</strong> downloads the current Polygon state.
      </p>

      <BindingBar
        path={path}
        problemId={pid}
        problemName={problemName}
        onChanged={load}
      />

      <div className="row savebar">
        <div>
          {busy && progress ? (
            <SyncProgressBar progress={progress} />
          ) : dirty.size > 0 ? (
            <span className="muted">
              {dirty.size} unsaved item{dirty.size === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="muted">No unsaved changes</span>
          )}
        </div>
        <div className="actions">
          <button className="link" onClick={pull} disabled={busy !== null || !pid}>
            {busy === "pull" ? (
              <>
                <span className="spinner" /> Pulling…
              </>
            ) : (
              "Pull"
            )}
          </button>
          <button className="link" onClick={load} disabled={busy !== null}>
            Reload
          </button>
          <button onClick={push} disabled={busy !== null || !content || !pid}>
            {busy === "push" ? (
              <>
                <span className="spinner" /> Pushing…
              </>
            ) : (
              "Push to Polygon"
            )}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <nav className="tabs detail-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="tab-content">
        {!content && tab !== "packages" && tab !== "commit" && (
          <p className="loading">Loading…</p>
        )}
        {content && tab === "info" && (
          <InfoCard content={content} update={update} path={path} save={saveApi} />
        )}
        {content && tab === "statements" && (
          <>
            <StatementsCard
              statements={content.statements}
              update={update}
              path={path}
              save={saveApi}
            />
            <StatementResourcesCard
              resources={content.statementResources}
              update={update}
              path={path}
              save={saveApi}
            />
          </>
        )}
        {content && tab === "files" && (
          <>
            <SolutionsCard
              solutions={content.solutions}
              update={update}
              path={path}
              save={saveApi}
            />
            <FilesCard files={content.files} update={update} path={path} save={saveApi} />
          </>
        )}
        {content && tab === "tests" && (
          <TestsCard
            testsets={content.testsets}
            enablePoints={content.info.enablePoints}
            update={update}
            path={path}
            save={saveApi}
          />
        )}
        {content && tab === "validator" && (
          <ValidatorTestsCard
            tests={content.validatorTests}
            update={update}
            path={path}
            save={saveApi}
          />
        )}
        {content && tab === "checker" && (
          <CheckerTestsCard
            tests={content.checkerTests}
            update={update}
            path={path}
            save={saveApi}
          />
        )}
        {tab === "packages" &&
          (pid ? <PackagesCard problemId={pid} /> : <UnboundNotice />)}
        {tab === "commit" && (pid ? <CommitCard problemId={pid} /> : <UnboundNotice />)}
        {tab === "access" && (pid ? <AccessCard problemId={pid} /> : <UnboundNotice />)}
      </div>
      </div>

      <aside className="detail-side">
        <StatusSidebar
          content={content}
          problemId={pid}
          problemName={problemName}
          refreshKey={statusRefresh}
        />
        <NotificationsPanel />
      </aside>

      {conflict && (
        <ConflictDialog
          fileRef={conflict.ref}
          disk={conflict.disk}
          onResolve={conflict.resolve}
        />
      )}
    </div>
  );
}

/** Modal asking whether to keep the app's edits or load the externally-changed file. */
function ConflictDialog({
  fileRef,
  disk,
  onResolve,
}: {
  fileRef: ProjectFileRef;
  disk: ProjectUnitSnapshot;
  onResolve: (choice: "keep" | "local") => void;
}): JSX.Element {
  const label = refLabel(fileRef);
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal card">
        <h3>File changed on disk</h3>
        <p>
          <strong>{label}</strong> was modified outside the app since you loaded it
          {disk.exists ? "" : " (it was deleted on disk)"}. Keep your edits in the app, or
          replace them with the version currently on disk?
        </p>
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button className="link" onClick={() => onResolve("keep")}>
            Keep app version
          </button>
          <button onClick={() => onResolve("local")}>Use disk version</button>
        </div>
      </div>
    </div>
  );
}

/** Human-readable name of a file unit for messages. */
function refLabel(ref: ProjectFileRef): string {
  switch (ref.kind) {
    case "file":
      return `file ${ref.name}`;
    case "solution":
      return `solution ${ref.name}`;
    case "statement":
      return `statement (${ref.lang})`;
    case "statementResource":
      return `resource ${ref.name}`;
    case "script":
      return `script (${ref.testset})`;
  }
}

// ---- Polygon problem binding (set/change the id Pull/Push/Commit target) ----

function UnboundNotice(): JSX.Element {
  return (
    <div className="card">
      <p className="muted">
        This project isn't bound to a Polygon problem yet. Bind a problem id above to use
        Polygon features (packages, commit, access).
      </p>
    </div>
  );
}

/** Suggest a Polygon-safe problem name (lowercase, hyphenated) from a project name. */
function suggestPolygonName(projectName: string): string {
  const s = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "problem";
}

function BindingBar({
  path,
  problemId,
  problemName,
  onChanged,
}: {
  path: string;
  problemId: number;
  problemName: string;
  onChanged: () => void;
}): JSX.Element {
  // null = no inline editor; "bind" = enter an existing id; "create" = name a new problem.
  const [mode, setMode] = useState<null | "bind" | "create">(null);
  const [idValue, setIdValue] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  function startBind(): void {
    setIdValue("");
    setMode("bind");
  }
  function startCreate(): void {
    // The Polygon problem name is independent of the project name — prefill a safe
    // suggestion derived from it, but let the user enter anything.
    setNameValue(suggestPolygonName(problemName));
    setMode("create");
  }
  function cancel(): void {
    setMode(null);
    setIdValue("");
    setNameValue("");
  }

  async function bind(): Promise<void> {
    const newId = Number(idValue);
    if (!Number.isFinite(newId) || newId <= 0) {
      toast.error("Enter a valid numeric problem id.");
      return;
    }
    // Warn when retargeting an already-bound project: this changes which Polygon problem
    // every Pull/Push/Commit hits.
    if (
      problemId &&
      newId !== problemId &&
      !window.confirm(
        `Change the bound problem id from #${problemId} to #${newId}?\n\n` +
          `All Pull / Push / Commit / package operations will then target problem ` +
          `#${newId} instead of #${problemId}. The local folder contents are not changed ` +
          `until you Pull or Push.`,
      )
    ) {
      return;
    }
    setBusy("bind");
    try {
      await window.polygon.setProjectId(path, newId);
      cancel();
      onChanged();
      toast.success(`Bound to Polygon problem #${newId}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function createOnPolygon(): Promise<void> {
    const name = nameValue.trim();
    if (!name) {
      toast.error("Enter a name for the new Polygon problem.");
      return;
    }
    // When already bound, creating a fresh problem rebinds this project to it.
    if (
      problemId &&
      !window.confirm(
        `This project is currently bound to #${problemId}.\n\n` +
          `Create a NEW Polygon problem named "${name}" and rebind this project to it? ` +
          `All Pull / Push / Commit / package operations will then target the new problem. ` +
          `The local folder contents are not changed until you Pull or Push.`,
      )
    ) {
      return;
    }
    setBusy("create");
    try {
      const entry = await window.polygon.createPolygonProblem(path, name);
      cancel();
      onChanged();
      toast.success(`Created and bound Polygon problem #${entry.problemId}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ marginTop: 0 }}>
        <div>
          <strong>Polygon binding:</strong>{" "}
          {problemId ? (
            <span className="badge">#{problemId}</span>
          ) : (
            <span className="muted">not bound</span>
          )}
        </div>
        <div className="actions">
          <button className="link" onClick={startBind} disabled={busy !== null}>
            {problemId ? "Change id" : "Set id"}
          </button>
          <button className="link" onClick={startCreate} disabled={busy !== null}>
            {problemId ? "Create new on Polygon" : "Create on Polygon"}
          </button>
        </div>
      </div>
      {mode === "bind" && (
        <div className="row addrow" style={{ marginTop: 8 }}>
          <input
            placeholder="Polygon problem id (e.g. 123456)"
            value={idValue}
            onChange={(e) => setIdValue(e.target.value)}
            inputMode="numeric"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void bind();
              }
            }}
          />
          <button className="link" onClick={bind} disabled={busy !== null || !idValue.trim()}>
            {busy === "bind" ? "Binding…" : "Bind"}
          </button>
          <button className="link" onClick={cancel} disabled={busy !== null}>
            Cancel
          </button>
        </div>
      )}
      {mode === "create" && (
        <div style={{ marginTop: 8 }}>
          <div className="row addrow">
            <input
              placeholder="New Polygon problem name (e.g. div2-a-apples)"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createOnPolygon();
                }
              }}
            />
            <button
              className="link"
              onClick={createOnPolygon}
              disabled={busy !== null || !nameValue.trim()}
            >
              {busy === "create" ? "Creating…" : "Create & bind"}
            </button>
            <button className="link" onClick={cancel} disabled={busy !== null}>
              Cancel
            </button>
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            The Polygon problem name is independent of this project's name
            {problemName ? ` ("${problemName}")` : ""}. Polygon names are usually
            lowercase letters, digits and hyphens.
          </p>
        </div>
      )}
    </div>
  );
}

type Updater = (mut: (c: ProjectContent) => ProjectContent, id?: string) => void;

// Inline "add by name" control (Electron renderers don't support window.prompt).
function AddRow({
  placeholder,
  label,
  onAdd,
}: {
  placeholder: string;
  label: string;
  onAdd: (value: string) => void;
}): JSX.Element {
  const [value, setValue] = useState("");
  function submit(): void {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue("");
  }
  return (
    <div className="row addrow">
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className="link" onClick={submit} disabled={!value.trim()}>
        {label}
      </button>
    </div>
  );
}

/**
 * Per-file checkbox controlling whether the file is uploaded on "Push to Polygon".
 * Sits in the file's summary row (operable without expanding); when off, the file stays
 * local-only. The checkbox is a real form control, so clicking it doesn't toggle the
 * surrounding <details> (Chromium ignores form-control clicks); the text is made inert so
 * clicking the words doesn't expand the file either.
 */
function PushToggle({
  push,
  onChange,
}: {
  push: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <label className="inline" title="Include this file when pushing to Polygon">
      <input
        type="checkbox"
        checked={push}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        Push to Polygon
      </span>
    </label>
  );
}

// ---- Info + checker/validator/interactor ----

function InfoCard({
  content,
  update,
  path,
  save,
}: {
  content: ProjectContent;
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  const { info } = content;
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const setInfo = (patch: Partial<typeof info>): void =>
    update((c) => ({ ...c, info: { ...c.info, ...patch } }), "info");

  async function saveInfo(): Promise<void> {
    setBusy(true);
    try {
      await window.polygon.saveInfoSlice(path, {
        info: content.info,
        checker: content.checker,
        validator: content.validator,
        interactor: content.interactor,
      });
      save.clearDirty("info");
      toast.success("Saved info.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ marginTop: 0 }}>
        <h3>Info</h3>
        <button onClick={saveInfo} disabled={busy || !save.isDirty("info")}>
          {busy ? "Saving…" : save.isDirty("info") ? "Save info" : "Saved"}
        </button>
      </div>
      <div className="grid2">
        <label>
          Time limit (ms)
          <input
            type="number"
            value={info.timeLimit}
            onChange={(e) => setInfo({ timeLimit: Number(e.target.value) })}
          />
        </label>
        <label>
          Memory limit (MB)
          <input
            type="number"
            value={info.memoryLimit}
            onChange={(e) => setInfo({ memoryLimit: Number(e.target.value) })}
          />
        </label>
        <label>
          Input file
          <input
            placeholder="stdin"
            value={info.inputFile}
            onChange={(e) => setInfo({ inputFile: e.target.value })}
          />
        </label>
        <label>
          Output file
          <input
            placeholder="stdout"
            value={info.outputFile}
            onChange={(e) => setInfo({ outputFile: e.target.value })}
          />
        </label>
      </div>
      <div className="row" style={{ justifyContent: "flex-start", gap: 20 }}>
        <label className="inline">
          <input
            type="checkbox"
            checked={info.interactive}
            onChange={(e) => setInfo({ interactive: e.target.checked })}
          />
          Interactive
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={info.wellFormed}
            onChange={(e) => setInfo({ wellFormed: e.target.checked })}
          />
          Tests well-formed
        </label>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <label>
          Checker
          <input
            placeholder="e.g. std::wcmp.cpp or a source file name"
            value={content.checker ?? ""}
            onChange={(e) => update((c) => ({ ...c, checker: e.target.value }), "info")}
          />
        </label>
        <label>
          Validator
          <input
            placeholder="source file name"
            value={content.validator ?? ""}
            onChange={(e) => update((c) => ({ ...c, validator: e.target.value }), "info")}
          />
        </label>
        <label>
          Interactor
          <input
            placeholder="source file name"
            value={content.interactor ?? ""}
            onChange={(e) =>
              update((c) => ({ ...c, interactor: e.target.value }), "info")
            }
          />
        </label>
      </div>
    </div>
  );
}

// ---- Statements ----

function StatementsCard({
  statements,
  update,
  path,
  save,
}: {
  statements: ProjectStatementEntry[];
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  function setStatement(lang: string, patch: Partial<ProjectStatementEntry>): void {
    update(
      (c) => ({
        ...c,
        statements: c.statements.map((s) => (s.lang === lang ? { ...s, ...patch } : s)),
      }),
      `statement:${lang}`,
    );
  }
  function addStatement(lang: string): void {
    update(
      (c) =>
        c.statements.some((s) => s.lang === lang)
          ? c
          : { ...c, statements: [...c.statements, { lang }] },
      `statement:${lang}`,
    );
  }
  async function removeStatement(lang: string): Promise<void> {
    if (!window.confirm(`Remove the ${lang} statement from the folder?`)) return;
    await window.polygon.deleteProjectUnit(path, { kind: "statement", lang });
    update((c) => ({ ...c, statements: c.statements.filter((s) => s.lang !== lang) }));
    save.clearDirty(`statement:${lang}`);
  }
  function applyLocal(lang: string, disk: ProjectUnitSnapshot): void {
    const fields = disk.fields ?? {};
    update((c) => ({
      ...c,
      statements: c.statements.map((s) => {
        if (s.lang !== lang) return s;
        const next: ProjectStatementEntry = { lang, encoding: disk.encoding ?? s.encoding };
        for (const f of STATEMENT_FIELDS) {
          const v = fields[f as string];
          if (v !== undefined) (next as unknown as Record<string, unknown>)[f as string] = v;
        }
        return next;
      }),
    }));
  }

  return (
    <div className="card">
      <h3>Statements ({statements.length})</h3>
      {statements.length === 0 && <p className="muted">No statements.</p>}
      {statements.map((st) => (
        <details
          key={st.lang}
          className="editor-block"
          onToggle={(e) => {
            if ((e.target as HTMLDetailsElement).open) {
              save.checkOnOpen({ kind: "statement", lang: st.lang }, `statement:${st.lang}`, (disk) =>
                applyLocal(st.lang, disk),
              );
            }
          }}
        >
          <summary>
            {st.lang} {st.name ? `— ${st.name}` : ""}
            {save.isDirty(`statement:${st.lang}`) ? (
              <span className="muted"> · unsaved</span>
            ) : null}
          </summary>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="muted">Language: {st.lang}</span>
            <div className="actions">
              <button
                disabled={!save.isDirty(`statement:${st.lang}`)}
                onClick={() =>
                  save.saveUnit({
                    ref: { kind: "statement", lang: st.lang },
                    id: `statement:${st.lang}`,
                    write: () => window.polygon.saveStatementEntry(path, st),
                    applyLocal: (disk) => applyLocal(st.lang, disk),
                    label: `statement (${st.lang})`,
                  })
                }
              >
                {save.isDirty(`statement:${st.lang}`) ? "Save" : "Saved"}
              </button>
              <button className="link danger" onClick={() => removeStatement(st.lang)}>
                Remove
              </button>
            </div>
          </div>
          {STATEMENT_FIELDS.map((f) => (
            <label key={f} className="field">
              <span className="muted">{f}</span>
              {f === "name" ? (
                <input
                  value={(st[f] as string) ?? ""}
                  onChange={(e) =>
                    setStatement(st.lang, {
                      [f]: e.target.value,
                    } as Partial<ProjectStatementEntry>)
                  }
                />
              ) : (
                <textarea
                  rows={4}
                  value={(st[f] as string) ?? ""}
                  onChange={(e) =>
                    setStatement(st.lang, {
                      [f]: e.target.value,
                    } as Partial<ProjectStatementEntry>)
                  }
                />
              )}
            </label>
          ))}
        </details>
      ))}
      <AddRow
        placeholder="Language code (e.g. english, russian)"
        label="+ Add language"
        onAdd={addStatement}
      />
    </div>
  );
}

// ---- Solutions ----

function SolutionsCard({
  solutions,
  update,
  path,
  save,
}: {
  solutions: ProjectSolutionEntry[];
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  function setSolution(name: string, patch: Partial<ProjectSolutionEntry>): void {
    update(
      (c) => ({
        ...c,
        solutions: c.solutions.map((s) => (s.name === name ? { ...s, ...patch } : s)),
      }),
      `solution:${name}`,
    );
  }
  // Metadata edits (tag, push, …) take effect immediately: apply the patch and write the
  // unit to the folder right away (no Save button). Content is read-only here.
  function patchAndSaveSolution(s: ProjectSolutionEntry, patch: Partial<ProjectSolutionEntry>): void {
    const next = { ...s, ...patch };
    setSolution(s.name, patch);
    void save.saveUnit({
      ref: { kind: "solution", name: s.name },
      id: `solution:${s.name}`,
      write: () => window.polygon.saveSolutionEntry(path, next),
      applyLocal: (disk) => applyLocal(s.name, disk),
      label: `solution ${s.name}`,
    });
  }
  function addSolution(name: string): void {
    if (solutions.some((s) => s.name === name)) return;
    const entry: ProjectSolutionEntry = { name, tag: "OK", content: "", push: false };
    update((c) => ({ ...c, solutions: [...c.solutions, entry] }), `solution:${name}`);
    // No Save button — scaffold the solution file in the folder right away.
    patchAndSaveSolution(entry, {});
  }
  async function removeSolution(name: string): Promise<void> {
    if (!window.confirm(`Remove solution ${name} from the folder?`)) return;
    await window.polygon.deleteProjectUnit(path, { kind: "solution", name });
    update((c) => ({ ...c, solutions: c.solutions.filter((s) => s.name !== name) }));
    save.clearDirty(`solution:${name}`);
  }
  function applyLocal(name: string, disk: ProjectUnitSnapshot): void {
    update((c) => ({
      ...c,
      solutions: c.solutions.map((s) =>
        s.name === name ? { ...s, content: disk.content } : s,
      ),
    }));
  }
  /** Turn a solution into a source/resource/aux file (it stays the same file in files/). */
  function changeSolutionCategory(s: ProjectSolutionEntry, cat: FileCategory): void {
    if (cat === "solution") return;
    const file: ProjectFileEntry = {
      name: s.name,
      type: cat,
      content: s.content,
      binary: false,
      sourceType: s.sourceType,
      push: s.push,
    };
    update((c) => ({
      ...c,
      solutions: c.solutions.filter((x) => x.name !== s.name),
      files: c.files.some((f) => f.name === s.name) ? c.files : [...c.files, file],
    }));
    save.clearDirty(`solution:${s.name}`);
    // Reclassification is saved immediately (the file moves category in the manifest).
    void save.saveUnit({
      ref: { kind: "file", name: s.name },
      id: `file:${s.name}`,
      write: () => window.polygon.saveFileEntry(path, file),
      applyLocal: (disk) =>
        update((c) => ({
          ...c,
          files: c.files.map((f) => (f.name === s.name ? { ...f, content: disk.content } : f)),
        })),
      label: `file ${s.name}`,
    });
  }

  return (
    <div className="card">
      <h3>Solution files ({solutions.length})</h3>
      <p className="muted">
        Model and judge solutions (tagged so Polygon knows the expected verdict). Stored in
        the project's <code>files/</code> folder alongside source files.
      </p>
      {solutions.length === 0 && <p className="muted">No solutions.</p>}
      {solutions.map((s) => (
        <details
          key={s.name}
          className="editor-block"
          onToggle={(e) => {
            if ((e.target as HTMLDetailsElement).open) {
              save.checkOnOpen({ kind: "solution", name: s.name }, `solution:${s.name}`, (disk) =>
                applyLocal(s.name, disk),
              );
            }
          }}
        >
          <summary>
            <span className="unit-name">{s.name}</span>{" "}
            <span className="badge" data-tag={s.tag}>
              {s.tag}
            </span>
            <span
          className="unit-actions"
          onClick={(e) => {
            e.stopPropagation();
            // A click on the container's own padding/gap (not a child control) would
            // otherwise toggle the <details> — suppress only that case.
            if (e.target === e.currentTarget) e.preventDefault();
          }}
        >
              <PushToggle
                push={s.push}
                onChange={(v) => patchAndSaveSolution(s, { push: v })}
              />
              <button className="link danger" onClick={() => removeSolution(s.name)}>
                Remove
              </button>
            </span>
          </summary>
          <div className="row" style={{ marginTop: 6, justifyContent: "flex-start", gap: 20 }}>
            <label className="inline">
              Type
              <select
                value="solution"
                onChange={(e) =>
                  changeSolutionCategory(s, e.target.value as FileCategory)
                }
              >
                {FILE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline">
              Tag
              <select
                value={s.tag}
                onChange={(e) =>
                  patchAndSaveSolution(s, { tag: e.target.value as SolutionTag })
                }
              >
                {SOLUTION_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t} — {SOLUTION_TAG_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea className="code" rows={10} value={s.content} readOnly />
        </details>
      ))}
      <AddRow
        placeholder="Solution file name (e.g. main.cpp)"
        label="+ Add solution"
        onAdd={addSolution}
      />
    </div>
  );
}

// ---- Files ----

function FilesCard({
  files,
  update,
  path,
  save,
}: {
  files: ProjectFileEntry[];
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  function setFile(name: string, patch: Partial<ProjectFileEntry>): void {
    update(
      (c) => ({
        ...c,
        files: c.files.map((f) => (f.name === name ? { ...f, ...patch } : f)),
      }),
      `file:${name}`,
    );
  }
  // Metadata edits (type, push, advanced props) take effect immediately: apply the patch
  // and write the unit to the folder right away (no Save button). Content is read-only here.
  function patchAndSaveFile(f: ProjectFileEntry, patch: Partial<ProjectFileEntry>): void {
    const next = { ...f, ...patch };
    setFile(f.name, patch);
    void save.saveUnit({
      ref: { kind: "file", name: f.name },
      id: `file:${f.name}`,
      write: () => window.polygon.saveFileEntry(path, next),
      applyLocal: (disk) => setFile(f.name, { content: disk.content }),
      label: `file ${f.name}`,
    });
  }
  function addFile(name: string, type: ProjectFileEntry["type"]): void {
    if (files.some((f) => f.name === name)) return;
    const entry: ProjectFileEntry = { name, type, content: "", binary: false, push: false };
    update((c) => ({ ...c, files: [...c.files, entry] }), `file:${name}`);
    // No Save button — scaffold the file in the folder right away (content is edited
    // externally and shown read-only here).
    patchAndSaveFile(entry, {});
  }
  async function removeFile(name: string): Promise<void> {
    if (!window.confirm(`Remove file ${name} from the folder?`)) return;
    await window.polygon.deleteProjectUnit(path, { kind: "file", name });
    update((c) => ({ ...c, files: c.files.filter((f) => f.name !== name) }));
    save.clearDirty(`file:${name}`);
  }
  /**
   * Move a file to another category. "solution" turns it into a solution entry (it stays
   * the same file on disk — both live in files/); the others just change its Polygon type.
   * The moved unit is marked unsaved; Save in its new section persists the reclassification.
   */
  function changeFileCategory(f: ProjectFileEntry, cat: FileCategory): void {
    if (cat === f.type) return;
    if (cat === "solution") {
      const sol: ProjectSolutionEntry = {
        name: f.name,
        tag: "OK",
        content: f.content,
        sourceType: f.sourceType,
        push: f.push,
      };
      update((c) => ({
        ...c,
        files: c.files.filter((x) => x.name !== f.name),
        solutions: c.solutions.some((s) => s.name === f.name) ? c.solutions : [...c.solutions, sol],
      }));
      save.clearDirty(`file:${f.name}`);
      // Reclassification is saved immediately (the file becomes a solution in the manifest).
      void save.saveUnit({
        ref: { kind: "solution", name: f.name },
        id: `solution:${f.name}`,
        write: () => window.polygon.saveSolutionEntry(path, sol),
        applyLocal: (disk) =>
          update((c) => ({
            ...c,
            solutions: c.solutions.map((s) =>
              s.name === f.name ? { ...s, content: disk.content } : s,
            ),
          })),
        label: `solution ${f.name}`,
      });
    } else {
      patchAndSaveFile(f, { type: cat });
    }
  }

  const sourceFiles = files.filter((f) => f.type === "source");
  const resourceFiles = files.filter((f) => f.type === "resource");
  const auxFiles = files.filter((f) => f.type === "aux");

  return (
    <>
      <div className="card">
        <h3>Source files ({sourceFiles.length})</h3>
        <p className="muted">
          Generators, validators, checkers and interactors (use <code>testlib.h</code>).
          Don't put solutions here — use the <strong>Solution files</strong> section above.
        </p>
        {sourceFiles.length === 0 && <p className="muted">No source files.</p>}
        {sourceFiles.map((f) => (
          <FileEditor
            key={f.name}
            file={f}
            setFile={setFile}
            patchSave={patchAndSaveFile}
            removeFile={removeFile}
            onCategory={changeFileCategory}
            save={save}
          />
        ))}
        <AddRow
          placeholder="File name (e.g. gen.cpp, validator.cpp)"
          label="+ Add source file"
          onAdd={(n) => addFile(n, "source")}
        />
      </div>

      <div className="card">
        <h3>Resource files ({resourceFiles.length})</h3>
        <p className="muted">
          Headers (<code>.h</code>), <code>.sty</code> and other files copied into the
          compile directory of each source. Resource <strong>advanced properties</strong>{" "}
          support IOI-like graders (experimental; cpp.* and python.* only).
        </p>
        {resourceFiles.length === 0 && <p className="muted">No resource files.</p>}
        {resourceFiles.map((f) => (
          <FileEditor
            key={f.name}
            file={f}
            setFile={setFile}
            patchSave={patchAndSaveFile}
            removeFile={removeFile}
            onCategory={changeFileCategory}
            save={save}
            advanced
          />
        ))}
        <AddRow
          placeholder="File name (e.g. testlib.h, grader.cpp, olymp.sty)"
          label="+ Add resource file"
          onAdd={(n) => addFile(n, "resource")}
        />
      </div>

      <div className="card">
        <h3>Attachments ({auxFiles.length})</h3>
        <p className="muted">
          Auxiliary (<code>aux</code>) files attached to the problem but not compiled with
          solutions — e.g. supplementary materials.
        </p>
        {auxFiles.length === 0 && <p className="muted">No attachments.</p>}
        {auxFiles.map((f) => (
          <FileEditor
            key={f.name}
            file={f}
            setFile={setFile}
            patchSave={patchAndSaveFile}
            removeFile={removeFile}
            onCategory={changeFileCategory}
            save={save}
          />
        ))}
        <AddRow
          placeholder="File name (e.g. notes.txt, image.png)"
          label="+ Add attachment"
          onAdd={(n) => addFile(n, "aux")}
        />
      </div>
    </>
  );
}

function FileEditor({
  file: f,
  setFile,
  patchSave,
  removeFile,
  onCategory,
  save,
  advanced,
}: {
  file: ProjectFileEntry;
  setFile: (name: string, patch: Partial<ProjectFileEntry>) => void;
  patchSave: (file: ProjectFileEntry, patch: Partial<ProjectFileEntry>) => void;
  removeFile: (name: string) => void;
  onCategory: (file: ProjectFileEntry, cat: FileCategory) => void;
  save: SaveApi;
  advanced?: boolean;
}): JSX.Element {
  // Binary files can't become solutions (solution content must be editable text).
  const categories = f.binary
    ? FILE_CATEGORIES.filter((c) => c !== "solution")
    : FILE_CATEGORIES;
  const advSummary = advanced ? describeAdvanced(f.resourceAdvancedProperties) : null;
  const id = `file:${f.name}`;
  const ref: ProjectFileRef = { kind: "file", name: f.name };
  const applyLocal = (disk: ProjectUnitSnapshot): void =>
    setFile(f.name, { content: disk.content });
  return (
    <details
      className="editor-block"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && !f.binary) {
          save.checkOnOpen(ref, id, applyLocal);
        }
      }}
    >
      <summary>
        <span className="unit-name">{f.name}</span>
        <span className="muted"> · {CATEGORY_LABELS[f.type]}</span>
        {f.binary ? <span className="muted"> · binary</span> : null}
        {advSummary ? <span className="muted"> · {advSummary}</span> : null}
        <span
          className="unit-actions"
          onClick={(e) => {
            e.stopPropagation();
            // A click on the container's own padding/gap (not a child control) would
            // otherwise toggle the <details> — suppress only that case.
            if (e.target === e.currentTarget) e.preventDefault();
          }}
        >
          {!f.binary && (
            <PushToggle push={f.push} onChange={(v) => patchSave(f, { push: v })} />
          )}
          <button className="link danger" onClick={() => removeFile(f.name)}>
            Remove
          </button>
        </span>
      </summary>
      <div className="row" style={{ marginTop: 6 }}>
        <label className="inline">
          Type
          <select
            value={f.type}
            onChange={(e) => onCategory(f, e.target.value as FileCategory)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {f.binary ? (
        <p className="muted">Binary file — content not editable here.</p>
      ) : (
        <textarea className="code" rows={10} value={f.content} readOnly />
      )}
      {advanced && f.type === "resource" && (
        <AdvancedPropsEditor
          adv={f.resourceAdvancedProperties}
          onChange={(adv) => patchSave(f, { resourceAdvancedProperties: adv })}
        />
      )}
    </details>
  );
}

/** Editor for a resource file's grader advanced properties (experimental Polygon feature). */
function AdvancedPropsEditor({
  adv,
  onChange,
}: {
  adv?: ResourceAdvancedProperties;
  onChange: (adv: ResourceAdvancedProperties | undefined) => void;
}): JSX.Element {
  const enabled = adv !== undefined && adv.forTypes.trim() !== "";
  const langs = enabled
    ? new Set(adv!.forTypes.split(";").map((s) => s.trim()).filter(Boolean))
    : new Set<string>();

  function patch(p: Partial<ResourceAdvancedProperties>): void {
    onChange({ ...(adv ?? defaultAdvancedProperties()), ...p });
  }
  function toggleLang(group: string, on: boolean): void {
    const next = new Set(langs);
    if (on) next.add(group);
    else next.delete(group);
    // Preserve the canonical order (cpp.* before python.*) when joining.
    patch({ forTypes: RESOURCE_LANG_GROUPS.filter((g) => next.has(g)).join(";") });
  }
  function toggleStage(stage: ResourceStage, on: boolean): void {
    const cur = adv?.stages ?? [];
    patch({
      stages: on ? [...new Set([...cur, stage])] : cur.filter((s) => s !== stage),
    });
  }
  function toggleAsset(asset: ResourceAsset, on: boolean): void {
    const cur = adv?.assets ?? [];
    patch({
      assets: on ? [...new Set([...cur, asset])] : cur.filter((a) => a !== asset),
    });
  }

  return (
    <div className="editor-block" style={{ marginTop: 8 }}>
      <label className="inline">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(e.target.checked ? defaultAdvancedProperties() : undefined)
          }
        />
        Advanced properties (graders)
      </label>
      {enabled && (
        <div style={{ marginTop: 8 }}>
          <div className="row" style={{ justifyContent: "flex-start", gap: 24, flexWrap: "wrap" }}>
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <div className="muted">Stages</div>
              {RESOURCE_STAGES.map((s) => (
                <label key={s.value} className="inline">
                  <input
                    type="checkbox"
                    checked={(adv!.stages ?? []).includes(s.value)}
                    onChange={(e) => toggleStage(s.value, e.target.checked)}
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <div className="muted">Assets</div>
              {RESOURCE_ASSETS.map((a) => (
                <label key={a} className="inline">
                  <input
                    type="checkbox"
                    checked={(adv!.assets ?? []).includes(a)}
                    onChange={(e) => toggleAsset(a, e.target.checked)}
                  />
                  {RESOURCE_ASSET_LABELS[a]}
                </label>
              ))}
            </fieldset>
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <div className="muted">For language groups</div>
              {RESOURCE_LANG_GROUPS.map((g) => (
                <label key={g} className="inline">
                  <input
                    type="checkbox"
                    checked={langs.has(g)}
                    onChange={(e) => toggleLang(g, e.target.checked)}
                  />
                  {g}
                </label>
              ))}
            </fieldset>
          </div>
          {langs.size === 0 && (
            <p className="muted">
              Select at least one language group, or the advanced properties are cleared.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Tests + scripts ----

function TestsCard({
  testsets,
  enablePoints,
  update,
  path,
  save,
}: {
  testsets: ProjectTestset[];
  enablePoints: PointsEnableMode;
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  return (
    <div className="card">
      <h3>Tests & scripts</h3>
      <label className="inline">
        Enable points
        <select
          value={enablePoints}
          onChange={(e) =>
            update(
              (c) => ({
                ...c,
                info: { ...c.info, enablePoints: e.target.value as PointsEnableMode },
              }),
              "info",
            )
          }
        >
          {POINTS_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        Points mode is problem-wide — save it from the <strong>Info</strong> tab. Each
        testset has one <strong>Save tests</strong> that writes its tests, groups and
        generation script to the folder. Nothing is pushed until you use{" "}
        <strong>Push to Polygon</strong>.
      </p>
      {testsets.length === 0 && <p className="muted">No testsets.</p>}
      {testsets.map((ts, tsi) => (
        <TestsetEditor
          key={ts.name}
          ts={ts}
          tsi={tsi}
          update={update}
          path={path}
          save={save}
        />
      ))}
      <p className="muted">
        Testsets can't be created from here — Polygon's API has no way to create a
        testset. Add one on the Polygon website, then Pull to edit it.
      </p>
    </div>
  );
}

/** Distinct, sorted group names referenced by a testset's tests. */
function presentGroups(ts: ProjectTestset): string[] {
  const s = new Set<string>();
  for (const t of ts.tests) if (t.group && t.group.trim() !== "") s.add(t.group);
  return [...s].sort();
}

function groupMeta(ts: ProjectTestset, name: string): ProjectTestGroup {
  return (
    ts.groups.find((g) => g.name === name) ?? {
      name,
      pointsPolicy: "EACH_TEST",
      feedbackPolicy: "COMPLETE",
      dependencies: [],
    }
  );
}

function TestsetEditor({
  ts,
  tsi,
  update,
  path,
  save,
}: {
  ts: ProjectTestset;
  tsi: number;
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  // Selection state (by test index / group name) for bulk edits.
  const [selTests, setSelTests] = useState<number[]>([]);
  const [lastTest, setLastTest] = useState<number | null>(null);
  const [selGroups, setSelGroups] = useState<string[]>([]);
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkPoints, setBulkPoints] = useState("");
  const [bulkPP, setBulkPP] = useState<PointsPolicy>("EACH_TEST");
  const [bulkFP, setBulkFP] = useState<FeedbackPolicy>("COMPLETE");
  const [savingTests, setSavingTests] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const toast = useToast();

  // Everything in this testset — tests, groups, and the generation script — shares one
  // unsaved flag and is persisted together by "Save tests" (locally; Push is separate).
  const testsId = `tests:${ts.name}`;

  function mutate(fn: (ts: ProjectTestset) => ProjectTestset): void {
    update(
      (c) => ({
        ...c,
        testsets: c.testsets.map((x, j) => (j === tsi ? fn(x) : x)),
      }),
      testsId,
    );
  }
  function setTestset(patch: Partial<ProjectTestset>): void {
    mutate((x) => ({ ...x, ...patch }));
  }
  function setScript(script: string): void {
    mutate((x) => ({ ...x, script }));
  }

  // Save the whole testset to the folder: tests + group settings + the generation
  // script. This does NOT push to Polygon — use the toolbar's "Push to Polygon".
  async function saveTests(): Promise<void> {
    setSavingTests(true);
    try {
      await window.polygon.saveTestset(path, ts);
      await window.polygon.saveScript(path, ts.name, ts.script);
      await save.refreshBaseline({ kind: "script", testset: ts.name });
      save.clearDirty(testsId);
      toast.success(`Saved ${ts.name} tests, groups & script (not pushed).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTests(false);
    }
  }

  function setTest(index: number, patch: Partial<ProjectTestEntry>): void {
    mutate((x) => ({
      ...x,
      tests: x.tests.map((t) => (t.index === index ? { ...t, ...patch } : t)),
    }));
  }

  // Reorder/delete renumber tests 1..N and rewrite the generation script to match;
  // tests + script share one unsaved flag, persisted together by "Save tests".
  function applyOrder(ordered: ProjectTestEntry[]): void {
    mutate((x) => applyTestOrder(x, ordered));
  }
  // Drag-and-drop: drop the dragged test at the position of the test it's dropped on.
  function dropOnTest(targetIndex: number): void {
    if (dragIdx === null || dragIdx === targetIndex) {
      setDragIdx(null);
      return;
    }
    const order = [...ts.tests];
    const from = order.findIndex((t) => t.index === dragIdx);
    const to = order.findIndex((t) => t.index === targetIndex);
    setDragIdx(null);
    if (from < 0 || to < 0) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    applyOrder(order);
  }
  // Re-derive generated tests from the (just-edited) script, keeping manual tests.
  function syncTestsFromScript(): void {
    const next = deriveTests(ts.script, ts.tests);
    if (JSON.stringify(next) === JSON.stringify(ts.tests)) return;
    mutate((x) => ({ ...x, tests: next }));
  }
  function addManualTest(): void {
    mutate((x) => {
      const nextIndex = x.tests.reduce((m, t) => Math.max(m, t.index), 0) + 1;
      return { ...x, tests: [...x.tests, { index: nextIndex, manual: true, input: "" }] };
    });
  }
  function setGroupMeta(name: string, patch: Partial<ProjectTestGroup>): void {
    mutate((x) => {
      const exists = x.groups.some((g) => g.name === name);
      const groups = exists
        ? x.groups.map((g) => (g.name === name ? { ...g, ...patch } : g))
        : [...x.groups, { ...groupMeta(x, name), ...patch }];
      return { ...x, groups };
    });
  }

  // ----- bulk test actions -----
  const sel = new Set(selTests);
  // Click a test's checkbox. Shift-click selects the whole range between the last
  // clicked test and this one (in displayed order).
  function clickTest(index: number, shift: boolean): void {
    const order = ts.tests.map((t) => t.index);
    if (shift && lastTest !== null) {
      const a = order.indexOf(lastTest);
      const b = order.indexOf(index);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = order.slice(lo, hi + 1);
        setSelTests((s) => [...new Set([...s, ...range])]);
        setLastTest(index);
        return;
      }
    }
    setSelTests((s) =>
      s.includes(index) ? s.filter((i) => i !== index) : [...s, index],
    );
    setLastTest(index);
  }
  function selectAllTests(): void {
    setSelTests(ts.tests.map((t) => t.index));
  }
  function clearTestSel(): void {
    setSelTests([]);
    setLastTest(null);
  }
  function bulkAssignGroup(): void {
    const name = bulkGroup.trim() || undefined;
    mutate((x) => ({
      ...x,
      tests: x.tests.map((t) => (sel.has(t.index) ? { ...t, group: name } : t)),
    }));
  }
  function bulkAssignPoints(): void {
    const points = bulkPoints === "" ? undefined : Number(bulkPoints);
    mutate((x) => ({
      ...x,
      tests: x.tests.map((t) => (sel.has(t.index) ? { ...t, points } : t)),
    }));
  }
  function bulkDeleteTests(): void {
    applyOrder(ts.tests.filter((t) => !sel.has(t.index)));
    clearTestSel();
  }

  // ----- bulk group actions -----
  const groups = presentGroups(ts);
  const selG = new Set(selGroups);
  function toggleGroup(name: string): void {
    setSelGroups((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));
  }
  function applyGroupBulk(): void {
    mutate((x) => ({
      ...x,
      groups: presentGroups(x).map((name) => {
        const base = groupMeta(x, name);
        return selG.has(name)
          ? { ...base, pointsPolicy: bulkPP, feedbackPolicy: bulkFP }
          : base;
      }),
    }));
  }

  return (
    <div className="editor-block">
      <div className="row" style={{ marginTop: 0 }}>
        <h4>
          {ts.name}
          {save.isDirty(testsId) ? <span className="muted"> · unsaved tests</span> : null}
        </h4>
        <div className="actions">
          <label className="inline">
            <input
              type="checkbox"
              checked={ts.enableGroups}
              onChange={(e) => setTestset({ enableGroups: e.target.checked })}
            />
            Enable groups
          </label>
          <button onClick={saveTests} disabled={savingTests || !save.isDirty(testsId)}>
            {savingTests ? "Saving…" : save.isDirty(testsId) ? "Save tests" : "Saved"}
          </button>
        </div>
      </div>

      {ts.enableGroups && (
        <div className="editor-block">
          <div className="muted">Groups points policy and dependencies</div>
          {groups.length === 0 ? (
            <p className="muted">
              No groups yet. Groups are created automatically when you assign a group name
              to one or more tests (Group field or bulk action below).
            </p>
          ) : (
            <>
              <div className="row addrow" style={{ flexWrap: "wrap" }}>
                <span className="muted">Selected {selG.size} group(s):</span>
                <label className="inline">
                  Points
                  <select
                    value={bulkPP}
                    onChange={(e) => setBulkPP(e.target.value as PointsPolicy)}
                  >
                    {POINTS_POLICIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline">
                  Feedback
                  <select
                    value={bulkFP}
                    onChange={(e) => setBulkFP(e.target.value as FeedbackPolicy)}
                  >
                    {FEEDBACK_POLICIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="link"
                  onClick={applyGroupBulk}
                  disabled={selG.size === 0}
                >
                  Apply to selected
                </button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Tests</th>
                    <th>Points policy</th>
                    <th>Feedback policy</th>
                    <th>Dependencies</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((name) => {
                    const g = groupMeta(ts, name);
                    const count = ts.tests.filter((t) => t.group === name).length;
                    return (
                      <tr key={name}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selG.has(name)}
                            onChange={() => toggleGroup(name)}
                          />
                        </td>
                        <td>{name}</td>
                        <td className="muted">{count}</td>
                        <td>
                          <select
                            value={g.pointsPolicy}
                            onChange={(e) =>
                              setGroupMeta(name, {
                                pointsPolicy: e.target.value as PointsPolicy,
                              })
                            }
                          >
                            {POINTS_POLICIES.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={g.feedbackPolicy}
                            onChange={(e) =>
                              setGroupMeta(name, {
                                feedbackPolicy: e.target.value as FeedbackPolicy,
                              })
                            }
                          >
                            {FEEDBACK_POLICIES.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            placeholder="comma-separated group names"
                            value={g.dependencies.join(",")}
                            onChange={(e) =>
                              setGroupMeta(name, {
                                dependencies: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter((s) => s !== ""),
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div className="field">
        <div className="row" style={{ marginTop: 0 }}>
          <span className="muted">Generation script</span>
        </div>
        <textarea
          className="code"
          rows={6}
          placeholder="gen 1 5 > $"
          value={ts.script}
          onFocus={() =>
            save.checkOnOpen({ kind: "script", testset: ts.name }, testsId, (disk) =>
              setScript(disk.content),
            )
          }
          onChange={(e) => setScript(e.target.value)}
          onBlur={syncTestsFromScript}
        />
        <p className="muted">
          Editing the script updates the test list below. Each line is{" "}
          <code>generator [params] &gt; index</code>, <code>&gt; $</code> (next free
          index), or <code>&gt; {"{1-3,7}"}</code> (one run, several tests). Drag tests by
          the <span aria-hidden>⠿</span> handle to reorder — this rewrites the script.
        </p>
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <span className="muted">Tests ({ts.tests.length})</span>
        <button className="link" onClick={addManualTest}>
          + Add manual test
        </button>
      </div>

      {ts.tests.length > 0 && (
        <div className="row addrow" style={{ flexWrap: "wrap" }}>
          <span className="muted">
            {sel.size} selected <em>(Shift-click to select a range)</em>
          </span>
          <button className="link" onClick={selectAllTests}>
            Select all
          </button>
          <button className="link" onClick={clearTestSel}>
            Clear
          </button>
          <input
            style={{ flex: "0 0 140px" }}
            placeholder="group name"
            value={bulkGroup}
            onChange={(e) => setBulkGroup(e.target.value)}
          />
          <button className="link" onClick={bulkAssignGroup} disabled={sel.size === 0}>
            Set group
          </button>
          <input
            type="number"
            style={{ flex: "0 0 90px" }}
            placeholder="points"
            value={bulkPoints}
            onChange={(e) => setBulkPoints(e.target.value)}
          />
          <button className="link" onClick={bulkAssignPoints} disabled={sel.size === 0}>
            Set points
          </button>
          <button className="link danger" onClick={bulkDeleteTests} disabled={sel.size === 0}>
            Delete selected
          </button>
        </div>
      )}

      {ts.tests.map((t) => (
        <details
          key={t.index}
          className={`editor-block${dragIdx === t.index ? " dragging" : ""}`}
          onDragOver={(e) => {
            if (dragIdx !== null) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            dropOnTest(t.index);
          }}
        >
          <summary>
            <span
              className="drag-handle"
              draggable
              title="Drag to reorder"
              onDragStart={(e) => {
                e.stopPropagation();
                setDragIdx(t.index);
              }}
              onDragEnd={() => setDragIdx(null)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              aria-hidden
            >
              ⠿
            </span>
            <input
              type="checkbox"
              checked={sel.has(t.index)}
              onClick={(e) => {
                e.stopPropagation();
                clickTest(t.index, e.shiftKey);
              }}
              onChange={() => {}}
              style={{ width: "auto", margin: "0 8px 0 0" }}
            />
            Test {t.index}{" "}
            <span className="muted">
              {t.manual ? "manual" : t.scriptLine ? `script: ${t.scriptLine}` : "generated"}
              {t.group ? ` · group ${t.group}` : ""}
              {t.points !== undefined ? ` · ${t.points} pts` : ""}
            </span>
          </summary>
          <div className="grid2" style={{ marginTop: 6 }}>
            <label>
              Group
              <input
                value={t.group ?? ""}
                onChange={(e) => setTest(t.index, { group: e.target.value || undefined })}
              />
            </label>
            <label>
              Points
              <input
                type="number"
                value={t.points ?? ""}
                onChange={(e) =>
                  setTest(t.index, {
                    points: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Description
              <input
                value={t.description ?? ""}
                onChange={(e) =>
                  setTest(t.index, { description: e.target.value || undefined })
                }
              />
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={t.useInStatements ?? false}
                onChange={(e) => setTest(t.index, { useInStatements: e.target.checked })}
              />
              Use in statements
            </label>
          </div>
          {t.manual ? (
            <label className="field">
              <span className="muted">Input</span>
              <textarea
                className="code"
                rows={6}
                value={t.input ?? ""}
                onChange={(e) => setTest(t.index, { input: e.target.value })}
              />
            </label>
          ) : (
            <p className="muted">
              Generated test{t.scriptLine ? ` — ${t.scriptLine}` : ""}. Edit the
              generation script above.
            </p>
          )}
        </details>
      ))}
    </div>
  );
}

// ---- Statement resources ----

function StatementResourcesCard({
  resources,
  update,
  path,
  save,
}: {
  resources: ProjectStatementResource[];
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  function setResource(name: string, patch: Partial<ProjectStatementResource>): void {
    update(
      (c) => ({
        ...c,
        statementResources: c.statementResources.map((r) =>
          r.name === name ? { ...r, ...patch } : r,
        ),
      }),
      `statementResource:${name}`,
    );
  }
  function addResource(name: string): void {
    update(
      (c) =>
        c.statementResources.some((r) => r.name === name)
          ? c
          : {
              ...c,
              statementResources: [
                ...c.statementResources,
                { name, content: "", binary: false },
              ],
            },
      `statementResource:${name}`,
    );
  }
  async function removeResource(name: string): Promise<void> {
    if (!window.confirm(`Remove resource ${name} from the folder?`)) return;
    await window.polygon.deleteProjectUnit(path, { kind: "statementResource", name });
    update((c) => ({
      ...c,
      statementResources: c.statementResources.filter((r) => r.name !== name),
    }));
    save.clearDirty(`statementResource:${name}`);
  }

  return (
    <div className="card">
      <h3>Statement resources ({resources.length})</h3>
      <p className="muted">
        Files shared by all statements (images, <code>.sty</code>, …). Pulled and pushed
        with the project; binary files (e.g. images) are fetched on pull but not editable
        here.
      </p>
      {resources.length === 0 && <p className="muted">No statement resources.</p>}
      {resources.map((r) => {
        const id = `statementResource:${r.name}`;
        const ref: ProjectFileRef = { kind: "statementResource", name: r.name };
        const applyLocal = (disk: ProjectUnitSnapshot): void =>
          setResource(r.name, { content: disk.content });
        return (
          <details
            key={r.name}
            className="editor-block"
            onToggle={(e) => {
              if ((e.target as HTMLDetailsElement).open && !r.binary) {
                save.checkOnOpen(ref, id, applyLocal);
              }
            }}
          >
            <summary>
              {r.name}
              {r.binary ? <span className="muted"> · binary</span> : null}
              {save.isDirty(id) ? <span className="muted"> · unsaved</span> : null}
            </summary>
            <div className="row" style={{ marginTop: 6 }}>
              <span className="muted">{r.name}</span>
              <div className="actions">
                {!r.binary && (
                  <button
                    disabled={!save.isDirty(id)}
                    onClick={() =>
                      save.saveUnit({
                        ref,
                        id,
                        write: () => window.polygon.saveStatementResourceEntry(path, r),
                        applyLocal,
                        label: `resource ${r.name}`,
                      })
                    }
                  >
                    {save.isDirty(id) ? "Save" : "Saved"}
                  </button>
                )}
                <button className="link danger" onClick={() => removeResource(r.name)}>
                  Remove
                </button>
              </div>
            </div>
            {r.binary ? (
              <p className="muted">Binary file — content not editable here.</p>
            ) : (
              <textarea
                className="code"
                rows={8}
                value={r.content}
                onChange={(e) => setResource(r.name, { content: e.target.value })}
              />
            )}
          </details>
        );
      })}
      <AddRow
        placeholder="Resource name (e.g. statement.sty, fig.png)"
        label="+ Add resource"
        onAdd={addResource}
      />
    </div>
  );
}

// ---- Validator tests ----

function ValidatorTestsCard({
  tests,
  update,
  path,
  save,
}: {
  tests: ProjectValidatorTest[];
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  function setTest(i: number, patch: Partial<ProjectValidatorTest>): void {
    update(
      (c) => ({
        ...c,
        validatorTests: c.validatorTests.map((t, j) => (j === i ? { ...t, ...patch } : t)),
      }),
      "vtests",
    );
  }
  function addTest(): void {
    update((c) => {
      const nextIndex = c.validatorTests.reduce((m, t) => Math.max(m, t.index), 0) + 1;
      return {
        ...c,
        validatorTests: [
          ...c.validatorTests,
          { index: nextIndex, input: "", verdict: "VALID" },
        ],
      };
    }, "vtests");
  }
  async function saveAll(): Promise<void> {
    setBusy(true);
    try {
      await window.polygon.saveValidatorTests(path, tests);
      save.clearDirty("vtests");
      toast.success("Saved validator tests.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ marginTop: 0 }}>
        <h3>Validator tests ({tests.length})</h3>
        <div className="actions">
          <button className="link" onClick={addTest}>
            + Add validator test
          </button>
          <button onClick={saveAll} disabled={busy || !save.isDirty("vtests")}>
            {busy ? "Saving…" : save.isDirty("vtests") ? "Save validator tests" : "Saved"}
          </button>
        </div>
      </div>
      <p className="muted">
        Each test feeds an input to the validator and asserts it is accepted (VALID) or
        rejected (INVALID).
      </p>
      {tests.length === 0 && <p className="muted">No validator tests.</p>}
      {tests.map((t, i) => (
        <details key={t.index} className="editor-block">
          <summary>
            Test {t.index} <span className="muted">· expect {t.verdict}</span>
            {t.group ? <span className="muted"> · group {t.group}</span> : null}
          </summary>
          <div className="grid2" style={{ marginTop: 6 }}>
            <label className="inline">
              Expected verdict
              <select
                value={t.verdict}
                onChange={(e) =>
                  setTest(i, { verdict: e.target.value as ValidatorVerdict })
                }
              >
                {VALIDATOR_VERDICTS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Group
              <input
                value={t.group ?? ""}
                onChange={(e) => setTest(i, { group: e.target.value || undefined })}
              />
            </label>
          </div>
          <label className="field">
            <span className="muted">Input</span>
            <textarea
              className="code"
              rows={6}
              value={t.input}
              onChange={(e) => setTest(i, { input: e.target.value })}
            />
          </label>
        </details>
      ))}
    </div>
  );
}

// ---- Checker tests ----

function CheckerTestsCard({
  tests,
  update,
  path,
  save,
}: {
  tests: ProjectCheckerTest[];
  update: Updater;
  path: string;
  save: SaveApi;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  function setTest(i: number, patch: Partial<ProjectCheckerTest>): void {
    update((c) => ({
      ...c,
      checkerTests: c.checkerTests.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    }), "ctests");
  }
  function addTest(): void {
    update((c) => {
      const nextIndex = c.checkerTests.reduce((m, t) => Math.max(m, t.index), 0) + 1;
      return {
        ...c,
        checkerTests: [
          ...c.checkerTests,
          { index: nextIndex, input: "", output: "", answer: "", verdict: "OK" },
        ],
      };
    }, "ctests");
  }
  async function saveAll(): Promise<void> {
    setBusy(true);
    try {
      await window.polygon.saveCheckerTests(path, tests);
      save.clearDirty("ctests");
      toast.success("Saved checker tests.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ marginTop: 0 }}>
        <h3>Checker tests ({tests.length})</h3>
        <div className="actions">
          <button className="link" onClick={addTest}>
            + Add checker test
          </button>
          <button onClick={saveAll} disabled={busy || !save.isDirty("ctests")}>
            {busy ? "Saving…" : save.isDirty("ctests") ? "Save checker tests" : "Saved"}
          </button>
        </div>
      </div>
      <p className="muted">
        Each test feeds input/output/answer to the checker and asserts the verdict it
        should return.
      </p>
      {tests.length === 0 && <p className="muted">No checker tests.</p>}
      {tests.map((t, i) => (
        <details key={t.index} className="editor-block">
          <summary>
            Test {t.index} <span className="muted">· expect {t.verdict}</span>
          </summary>
          <label className="inline" style={{ marginTop: 6 }}>
            Expected verdict
            <select
              value={t.verdict}
              onChange={(e) => setTest(i, { verdict: e.target.value as CheckerVerdict })}
            >
              {CHECKER_VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted">Input</span>
            <textarea
              className="code"
              rows={4}
              value={t.input}
              onChange={(e) => setTest(i, { input: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="muted">Participant output</span>
            <textarea
              className="code"
              rows={4}
              value={t.output}
              onChange={(e) => setTest(i, { output: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="muted">Jury answer</span>
            <textarea
              className="code"
              rows={4}
              value={t.answer}
              onChange={(e) => setTest(i, { answer: e.target.value })}
            />
          </label>
        </details>
      ))}
    </div>
  );
}

// ---- Packages (live Polygon — unchanged) ----

function PackagesCard({ problemId }: { problemId: number }): JSX.Element {
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [full, setFull] = useState(true);
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function refresh(): Promise<void> {
    setError(null);
    try {
      setPackages(await window.polygon.problemPackages(problemId));
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId]);

  async function build(): Promise<void> {
    setBusy("build");
    setError(null);
    try {
      await window.polygon.buildPackage(problemId, full, verify);
      toast.success("Build started. Refresh in a moment to see its state.");
      await refresh();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  async function download(pkg: Package): Promise<void> {
    setBusy(`dl-${pkg.id}`);
    setError(null);
    try {
      const path = await window.polygon.downloadPackage(problemId, pkg.id);
      if (path) toast.success(`Saved package to ${path}.`);
      else toast.show("Download cancelled.");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h3>Packages</h3>
      <div className="row" style={{ justifyContent: "flex-start", gap: 16 }}>
        <label className="inline">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          full
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={verify}
            onChange={(e) => setVerify(e.target.checked)}
          />
          verify
        </label>
        <button onClick={build} disabled={busy === "build"}>
          {busy === "build" ? "Building…" : "Build package"}
        </button>
        <button className="link" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {packages && (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Rev</th>
              <th>Type</th>
              <th>State</th>
              <th>Comment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={`${p.id}-${p.type}`}>
                <td>{p.id}</td>
                <td>{p.revision}</td>
                <td>{p.type}</td>
                <td>
                  <span className="badge" data-state={p.state}>
                    {p.state}
                  </span>
                </td>
                <td className="muted">{p.comment}</td>
                <td>
                  {p.state === "READY" && (
                    <button
                      className="link"
                      onClick={() => download(p)}
                      disabled={busy === `dl-${p.id}`}
                    >
                      {busy === `dl-${p.id}` ? "Saving…" : "Download"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {packages.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No packages yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CommitCard({ problemId }: { problemId: number }): JSX.Element {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function commit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.polygon.commitChanges(problemId, message || "Update via Decagon");
      setMessage("");
      toast.success("Committed working copy.");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Commit changes</h3>
      <input
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div style={{ marginTop: 10 }}>
        <button onClick={commit} disabled={busy}>
          {busy ? "Committing…" : "Commit working copy"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---- Manage access ----
// Polygon's API has no access-management endpoints, so this tab shows the current
// access level and opens Polygon in the browser to change collaborators there.

const POLYGON_PROBLEMS_URL = "https://polygon.codeforces.com/problems";

function AccessCard({ problemId }: { problemId: number }): JSX.Element {
  const [meta, setMeta] = useState<import("../core/types").Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    setError(null);
    setBusy(true);
    window.polygon
      .problemMeta(problemId)
      .then(setMeta)
      .catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        setError(m);
        toast.error(m);
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId]);

  async function open(): Promise<void> {
    try {
      await window.polygon.openExternal(POLYGON_PROBLEMS_URL);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="card">
      <h3>Manage access</h3>
      <p className="muted">
        Polygon's API can't change permissions, so collaborator management is done on the
        Polygon website. This tab shows your current access to the problem.
      </p>
      {busy && <p className="loading">Loading…</p>}
      {meta && (
        <ul className="kv">
          <li>
            Your access:{" "}
            <span className="badge" data-access={meta.accessType}>
              {meta.accessType}
            </span>
          </li>
          <li>Owner: {meta.owner}</li>
          <li>Name: {meta.name}</li>
          <li>Revision: {meta.revision}</li>
          {meta.latestPackage !== undefined && (
            <li>Latest package: {meta.latestPackage}</li>
          )}
          <li>Has uncommitted changes: {meta.modified ? "yes" : "no"}</li>
        </ul>
      )}
      <div style={{ marginTop: 10 }}>
        <button onClick={open}>Open access settings on Polygon ↗</button>
      </div>
      {meta && meta.accessType !== "OWNER" && (
        <p className="muted">
          Only the OWNER can change access. You have {meta.accessType} access.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
