import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PolygonCredentials } from "../core/client";
import {
  problemSolutions,
  problemFiles,
  problemViewSolution,
  problemViewFile,
  problemStatements,
  problemStatementResources,
  problemViewStatementResource,
  problemInfo,
  problemChecker,
  problemValidator,
  problemInteractor,
  problemTests,
  problemScript,
  problemSaveSolution,
  problemSaveFile,
  problemSaveStatement,
  problemSaveStatementResource,
  problemUpdateInfo,
  problemSetChecker,
  problemSetValidator,
  problemSetInteractor,
  problemSaveScript,
  problemSaveTest,
  problemDeleteTests,
  problemEnablePoints,
  problemEnableTreatPointsFromCheckerAsPercent,
  problemEnableGroups,
  problemViewTestGroups,
  problemSaveTestGroup,
  problemValidatorTests,
  problemSaveValidatorTest,
  problemCheckerTests,
  problemSaveCheckerTest,
  type FileType,
} from "../core/methods";
import type {
  PointsEnableMode,
  ProjectContent,
  ProjectStatementEntry,
  ProjectStatementResource,
  ProjectTestEntry,
  SyncProgress,
  SyncSummary,
} from "../shared/ipc";
import type { Test } from "../core/types";
import { emptyManifest, readManifest, writeManifest } from "./manifest";
import {
  STATEMENT_FILES,
  isBinary,
  writeBytes,
  readProjectContent,
  writeProjectContent,
} from "./projectContent";

/** Callback used to report pull/push progress to the caller (forwarded to the UI). */
export type ProgressReporter = (progress: SyncProgress) => void;

/**
 * Max in-flight Polygon requests during pull/push. Independent operations (files,
 * solutions, tests, …) run concurrently up to this limit, which cuts sync time
 * roughly N-fold while staying well within Polygon's tolerance.
 */
const SYNC_CONCURRENCY = 8;

/** Run an async task over each item with bounded concurrency (fail-fast). */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
}

/** Create an empty project skeleton bound to a problem. */
export function scaffoldProject(dir: string, problemId: number, name: string): void {
  // Solutions share the flat files/ folder, so no separate solutions/ dir is created.
  mkdirSync(join(dir, "files"), { recursive: true });
  mkdirSync(join(dir, "statements"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeManifest(dir, emptyManifest(problemId, name));
}

/**
 * Download everything editable about a problem into the project folder:
 * info + checker/validator/interactor, solutions, files, statements,
 * statement resources, tests and the test-generation script.
 */
export async function syncPull(
  creds: PolygonCredentials,
  problemId: number,
  dir: string,
  name?: string,
  pin?: string,
  onProgress?: ProgressReporter,
): Promise<SyncSummary> {
  if (!problemId) {
    throw new Error(
      "This project isn't bound to a Polygon problem yet. Set its problem id first.",
    );
  }
  const report = (phase: string, current: number, total: number) =>
    onProgress?.({ op: "pull", phase, current, total });

  // Polygon exposes no getter for "enable points"/"enable groups", so we infer them
  // from the pulled data below (the points/group fields only appear when enabled).
  // We still read the previous local content to recover the YES-vs-PERCENT points
  // distinction, which is genuinely undetectable from the API.
  const prev = readProjectContent(dir);

  report("Fetching problem data", 0, 0);
  const [info, solutions, files, statements, stmtResources, tests] = await Promise.all([
    problemInfo(creds, problemId, pin),
    problemSolutions(creds, problemId, pin),
    problemFiles(creds, problemId, pin),
    problemStatements(creds, problemId, pin),
    problemStatementResources(creds, problemId, pin),
    problemTests(creds, problemId, "tests", pin),
  ]);

  // checker/validator/interactor may legitimately be unset — tolerate failures.
  const [
    checker,
    validator,
    interactor,
    script,
    validatorTests,
    checkerTests,
    testGroups,
  ] = await Promise.all([
    problemChecker(creds, problemId, pin).catch(() => ""),
    problemValidator(creds, problemId, pin).catch(() => ""),
    problemInteractor(creds, problemId, pin).catch(() => ""),
    problemScript(creds, problemId, "tests", pin).catch(() => ""),
    problemValidatorTests(creds, problemId, pin).catch(() => []),
    problemCheckerTests(creds, problemId, pin).catch(() => []),
    problemViewTestGroups(creds, problemId, "tests", pin).catch(() => []),
  ]);

  // Statement resources: binary ones (images) are written to disk now; text ones
  // travel inside the content so writeProjectContent persists them. Downloaded
  // concurrently to keep pull fast.
  const resourceEntries: ProjectStatementResource[] = [];
  let resDone = 0;
  report("Downloading statement resources", 0, stmtResources.length);
  await runPool(stmtResources, SYNC_CONCURRENCY, async (r) => {
    const bytes = await problemViewStatementResource(creds, problemId, r.name, pin);
    const buf = Buffer.from(bytes);
    const binary = isBinary(buf);
    if (binary) {
      writeBytes(join(dir, "statements", "resources", r.name), bytes);
      resourceEntries.push({ name: r.name, content: "", binary: true });
    } else {
      resourceEntries.push({ name: r.name, content: buf.toString("utf8"), binary: false });
    }
    report("Downloading statement resources", ++resDone, stmtResources.length);
  });

  const fileEntries: ProjectContent["files"] = [];
  const fileTargets: { type: FileType; f: (typeof files.sourceFiles)[number] }[] = [
    ...files.sourceFiles.map((f) => ({ type: "source" as FileType, f })),
    ...files.resourceFiles.map((f) => ({ type: "resource" as FileType, f })),
    ...files.auxFiles.map((f) => ({ type: "aux" as FileType, f })),
  ];
  let fileDone = 0;
  report("Downloading files", 0, fileTargets.length);
  await runPool(fileTargets, SYNC_CONCURRENCY, async ({ type, f }) => {
    const content = await problemViewFile(creds, problemId, type, f.name, pin);
    fileEntries.push({
      name: f.name,
      type,
      sourceType: f.sourceType,
      content,
      binary: false,
      push: true,
      // Grader advanced properties are only present on resource files.
      resourceAdvancedProperties:
        type === "resource" ? f.resourceAdvancedProperties : undefined,
    });
    report("Downloading files", ++fileDone, fileTargets.length);
  });

  const solutionEntries: ProjectContent["solutions"] = [];
  let solDone = 0;
  report("Downloading solutions", 0, solutions.length);
  await runPool(solutions, SYNC_CONCURRENCY, async (s) => {
    const content = await problemViewSolution(creds, problemId, s.name, pin);
    solutionEntries.push({
      name: s.name,
      tag: s.tag,
      sourceType: s.sourceType,
      content,
      push: true,
    });
    report("Downloading solutions", ++solDone, solutions.length);
  });

  // Preserve local-only files/solutions: anything present in the folder but not on
  // Polygon is kept as-is (it would otherwise be deleted by the authoritative
  // writeProjectContent). This keeps locally-added files that were never pushed.
  const pulledFileNames = new Set(fileEntries.map((f) => f.name));
  for (const f of prev.files) {
    if (!pulledFileNames.has(f.name)) fileEntries.push(f);
  }
  const pulledSolutionNames = new Set(solutionEntries.map((s) => s.name));
  for (const s of prev.solutions) {
    if (!pulledSolutionNames.has(s.name)) solutionEntries.push(s);
  }

  const statementEntries: ProjectStatementEntry[] = Object.entries(statements).map(
    ([lang, st]) => ({
      lang,
      encoding: st.encoding,
      name: st.name,
      legend: st.legend,
      input: st.input,
      output: st.output,
      scoring: st.scoring,
      interaction: st.interaction,
      notes: st.notes,
      tutorial: st.tutorial,
    }),
  );

  // Infer enable-points / enable-groups from the data (those fields are present only
  // when the features are on). PERCENT vs YES isn't detectable, so keep the local
  // choice if points are on and the user had previously selected PERCENT.
  const groupsOn =
    testGroups.length > 0 || tests.some((t) => t.group !== undefined);
  const pointsOn = tests.some((t) => t.points !== undefined);
  const pointsMode: PointsEnableMode = pointsOn
    ? prev.info.enablePoints === "PERCENT"
      ? "PERCENT"
      : "YES"
    : "NO";

  const content: ProjectContent = {
    problemId,
    name,
    info: {
      inputFile: info.inputFile,
      outputFile: info.outputFile,
      interactive: info.interactive,
      wellFormed: info.wellFormed,
      enablePoints: pointsMode,
      timeLimit: info.timeLimit,
      memoryLimit: info.memoryLimit,
    },
    checker: checker || undefined,
    validator: validator || undefined,
    interactor: interactor || undefined,
    statements: statementEntries,
    statementResources: resourceEntries,
    solutions: solutionEntries,
    files: fileEntries,
    testsets: [
      {
        name: "tests",
        script,
        enableGroups: groupsOn,
        groups: testGroups.map((g) => ({
          name: g.name,
          pointsPolicy: g.pointsPolicy,
          feedbackPolicy: g.feedbackPolicy,
          dependencies: g.dependencies ?? [],
        })),
        tests: tests.map((t) => ({
          index: t.index,
          manual: t.manual,
          input: t.input,
          description: t.description,
          useInStatements: t.useInStatements,
          scriptLine: t.scriptLine,
          group: t.group,
          points: t.points,
        })),
      },
    ],
    validatorTests: validatorTests.map((v) => ({
      index: v.index,
      input: v.input,
      verdict: v.expectedVerdict,
      group: v.group,
      testset: v.testset,
    })),
    checkerTests: checkerTests.map((c) => ({
      index: c.index,
      input: c.input,
      output: c.output,
      answer: c.answer,
      verdict: c.expectedVerdict,
    })),
  };

  report("Saving to folder", 0, 0);
  writeProjectContent(dir, content);

  // Record the pull time (writeProjectContent rewrites the rest of the manifest).
  const manifest = readManifest(dir);
  manifest.pulledAt = new Date().toISOString();
  writeManifest(dir, manifest);

  return {
    files: fileEntries.length,
    solutions: solutionEntries.length,
    statements: statementEntries.length,
    statementResources: resourceEntries.length,
    validatorTests: content.validatorTests.length,
    checkerTests: content.checkerTests.length,
  };
}

/**
 * Upload the project folder's editable content back to Polygon's working copy.
 * Reads the canonical ProjectContent from disk so new/edited items are included.
 * Binary files are skipped (the client uploads text) — pull still fetches them.
 * Push edits the working copy only; Commit separately to save a revision.
 */
export async function syncPush(
  creds: PolygonCredentials,
  dir: string,
  pin?: string,
  onProgress?: ProgressReporter,
): Promise<SyncSummary> {
  const content = readProjectContent(dir);
  const problemId = content.problemId;
  if (!problemId) {
    throw new Error(
      "This project isn't bound to a Polygon problem yet. Set its problem id first.",
    );
  }
  const report = (phase: string, current: number, total: number) =>
    onProgress?.({ op: "push", phase, current, total });
  const summary: SyncSummary = {
    files: 0,
    solutions: 0,
    statements: 0,
    statementResources: 0,
    validatorTests: 0,
    checkerTests: 0,
  };

  // Info first so limits/flags are applied before everything else.
  report("Updating problem info", 0, 0);
  await problemUpdateInfo(creds, problemId, content.info, pin);
  // Points mode: NO → off; YES → on; PERCENT → on + treat checker points as percent.
  // enablePoints must be applied before the percent flag (which requires points on).
  const pointsOn = content.info.enablePoints !== "NO";
  await problemEnablePoints(creds, problemId, pointsOn, pin);
  await problemEnableTreatPointsFromCheckerAsPercent(
    creds,
    problemId,
    content.info.enablePoints === "PERCENT",
    pin,
  );

  // Files before checker/validator/interactor (those reference a source file name).
  // Files are mutually independent, so push them concurrently.
  const filesToPush = content.files.filter((f) => !f.binary && f.push !== false);
  report("Uploading files", 0, filesToPush.length);
  await runPool(filesToPush, SYNC_CONCURRENCY, async (f) => {
    // Resource files carry grader advanced properties; send them authoritatively
    // (set when present, cleared with forTypes="" when absent). Non-resource files
    // omit them entirely so Polygon leaves nothing of the sort.
    const adv = f.type === "resource" ? f.resourceAdvancedProperties : undefined;
    const hasAdv = adv !== undefined && adv.forTypes.trim() !== "";
    await problemSaveFile(
      creds,
      problemId,
      {
        type: f.type,
        name: f.name,
        file: f.content,
        sourceType: f.sourceType,
        checkExisting: false,
        forTypes:
          f.type === "resource" ? (hasAdv ? adv!.forTypes : "") : undefined,
        stages: hasAdv ? adv!.stages : undefined,
        assets: hasAdv ? adv!.assets : undefined,
      },
      pin,
    );
    report("Uploading files", ++summary.files, filesToPush.length);
  });

  // Checker/validator/interactor: always send the current value — including an empty
  // string — so clearing one in the app actually unsets it on Polygon. (Previously we
  // only sent non-empty values, so a removed checker/validator stayed attached.)
  // Clearing may be rejected for a required field (e.g. checker), so tolerate failures
  // when sending empty; a non-empty assignment still propagates real errors.
  report("Setting checker/validator/interactor", 0, 0);
  const setOrClear = async (
    value: string | undefined,
    set: (v: string) => Promise<void>,
  ): Promise<void> => {
    const v = value ?? "";
    try {
      await set(v);
    } catch (err) {
      if (v !== "") throw err; // a real assignment failed
      // Clearing isn't supported for this field — leave it as-is on Polygon.
    }
  };
  await setOrClear(content.checker, (v) => problemSetChecker(creds, problemId, v, pin));
  await setOrClear(content.validator, (v) =>
    problemSetValidator(creds, problemId, v, pin),
  );
  await setOrClear(content.interactor, (v) =>
    problemSetInteractor(creds, problemId, v, pin),
  );

  const solutionsToPush = content.solutions.filter((s) => s.push !== false);
  report("Uploading solutions", 0, solutionsToPush.length);
  await runPool(solutionsToPush, SYNC_CONCURRENCY, async (s) => {
    await problemSaveSolution(
      creds,
      problemId,
      {
        name: s.name,
        file: s.content,
        sourceType: s.sourceType,
        tag: s.tag,
        checkExisting: false,
      },
      pin,
    );
    report("Uploading solutions", ++summary.solutions, solutionsToPush.length);
  });

  report("Uploading statements", 0, content.statements.length);
  await runPool(content.statements, SYNC_CONCURRENCY, async (st) => {
    const fields: Record<string, string> = {};
    for (const field of Object.keys(STATEMENT_FILES) as (keyof typeof STATEMENT_FILES)[]) {
      const value = st[field];
      if (value !== undefined && value !== "") fields[field] = value;
    }
    if (st.encoding) fields.encoding = st.encoding;
    if (Object.keys(fields).length > 0) {
      await problemSaveStatement(creds, problemId, st.lang, fields, pin);
      summary.statements++;
    }
    report("Uploading statements", summary.statements, content.statements.length);
  });

  // Statement resources (text only; binary like images is skipped — the client
  // uploads text, and pull still fetches the binary ones).
  const resourcesToPush = content.statementResources.filter((r) => !r.binary);
  report("Uploading statement resources", 0, resourcesToPush.length);
  await runPool(resourcesToPush, SYNC_CONCURRENCY, async (r) => {
    await problemSaveStatementResource(
      creds,
      problemId,
      { name: r.name, file: r.content, checkExisting: false },
      pin,
    );
    report(
      "Uploading statement resources",
      ++summary.statementResources,
      resourcesToPush.length,
    );
  });

  // Test-generation scripts and manual tests, per testset.
  // Testsets are created on the Polygon website, never by this app — Polygon's API
  // has no create-testset endpoint (a testset only exists once a test is added, and
  // saveScript/enableGroups both require it to already exist). The app only edits
  // testsets that were pulled from Polygon, so we assume each one already exists.
  const totalTests = content.testsets.reduce((n, ts) => n + ts.tests.length, 0);
  let testsDone = 0;
  report("Uploading tests", 0, totalTests);
  for (const ts of content.testsets) {
    if (ts.script !== undefined && ts.script.trim() !== "") {
      report(`Saving script (${ts.name})`, testsDone, totalTests);
      await problemSaveScript(creds, problemId, ts.name, ts.script, pin);
    }

    // Delete tests removed locally: anything currently on Polygon but no longer in
    // the local content is removed (this is how a test gets deleted on Polygon).
    const localIndices = new Set(ts.tests.map((t) => t.index));
    let serverTests: Test[] = [];
    try {
      serverTests = await problemTests(creds, problemId, ts.name, pin);
    } catch {
      serverTests = [];
    }
    const serverByIndex = new Map(serverTests.map((t) => [t.index, t]));
    const toDelete = [...serverByIndex.keys()].filter((i) => !localIndices.has(i));
    if (toDelete.length > 0) {
      await problemDeleteTests(creds, problemId, ts.name, toDelete, pin);
    }

    // Enable/disable groups (the testset already exists; required before assigning
    // any test's group below).
    await problemEnableGroups(creds, problemId, ts.name, ts.enableGroups, pin);

    // A test already matches Polygon when every field we'd send equals the server's,
    // so re-uploading it would be a no-op. Skipping those is the main speed-up on
    // re-push (only changed tests hit the network). Input is normalized for CRLF and a
    // trailing newline (Polygon often stores one) to avoid false differences.
    const norm = (s: string | undefined): string =>
      (s ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    const unchanged = (t: ProjectTestEntry, sv: Test | undefined): boolean => {
      if (!sv) return false;
      const localManual = t.manual && t.input !== undefined;
      const serverManual = sv.manual && sv.input !== undefined;
      if (localManual !== serverManual) return false;
      if (localManual && norm(t.input) !== norm(sv.input)) return false;
      // group/points are always (re)sent when their feature is on.
      if (ts.enableGroups && (t.group ?? "") !== (sv.group ?? "")) return false;
      if (pointsOn && (t.points ?? 0) !== (sv.points ?? 0)) return false;
      // description/useInStatements are only sent when set locally — compare just then.
      if (t.description !== undefined && t.description !== (sv.description ?? ""))
        return false;
      if (t.useInStatements !== undefined && t.useInStatements !== sv.useInStatements)
        return false;
      return true;
    };

    // Tests target distinct indices, so push them concurrently.
    await runPool(ts.tests, SYNC_CONCURRENCY, async (t) => {
      const isManual = t.manual && t.input !== undefined;
      // Generated (script) tests are produced by the pushed script, so we DON'T upload
      // them one-by-one — that's the slow part and Polygon regenerates them. We only
      // edit a generated test when it carries per-test metadata that the script can't
      // express (group/points/description/use-in-statements) and it already exists on
      // Polygon (editing a not-yet-generated test would fail).
      const hasMeta =
        (ts.enableGroups && !!t.group && t.group.trim() !== "") ||
        (pointsOn && t.points !== undefined) ||
        (!!t.description && t.description.trim() !== "") ||
        t.useInStatements === true;
      if (!isManual && (!hasMeta || !serverByIndex.has(t.index))) {
        report("Uploading tests", ++testsDone, totalTests);
        return;
      }
      // Already identical on Polygon — nothing to upload.
      if (unchanged(t, serverByIndex.get(t.index))) {
        report("Uploading tests", ++testsDone, totalTests);
        return;
      }
      await problemSaveTest(
        creds,
        problemId,
        {
          testset: ts.name,
          testIndex: t.index,
          testInput: isManual ? t.input : undefined,
          // Only send group/points when the corresponding feature is enabled,
          // otherwise Polygon rejects them. When enabled, always send a value so
          // clearing the field is pushed as a removal: Polygon keeps the previous
          // value if the param is omitted, so a blank group becomes "" (drops the
          // test from its group) and blank points become 0.
          testGroup: ts.enableGroups ? (t.group ?? "") : undefined,
          testPoints:
            content.info.enablePoints !== "NO" ? (t.points ?? 0) : undefined,
          testDescription: t.description,
          testUseInStatements: t.useInStatements,
          checkExisting: false,
        },
        pin,
      );
      report("Uploading tests", ++testsDone, totalTests);
    });
  }

  // Group policies/feedback/dependencies, after tests exist. Groups are derived from
  // tests: a group exists on Polygon only while some test references it (and Polygon
  // drops it once empty), so we only push policies for groups still referenced here.
  // Script-generated groups may not exist until the package is built, so a failure is
  // tolerated rather than aborting the push.
  if (content.testsets.some((ts) => ts.enableGroups && ts.groups.length > 0)) {
    report("Updating test groups", 0, 0);
  }
  for (const ts of content.testsets) {
    if (!ts.enableGroups) continue;
    const present = new Set(
      ts.tests.map((t) => t.group).filter((g): g is string => !!g && g.trim() !== ""),
    );
    for (const g of ts.groups) {
      if (!present.has(g.name)) continue;
      try {
        await problemSaveTestGroup(
          creds,
          problemId,
          {
            testset: ts.name,
            group: g.name,
            pointsPolicy: g.pointsPolicy,
            feedbackPolicy: g.feedbackPolicy,
            dependencies: g.dependencies,
          },
          pin,
        );
      } catch {
        // Group not materialized yet (e.g. produced by a script on build) — skip.
      }
    }
  }

  // Validator tests (input + expected VALID/INVALID verdict).
  report("Uploading validator tests", 0, content.validatorTests.length);
  await runPool(content.validatorTests, SYNC_CONCURRENCY, async (vt) => {
    await problemSaveValidatorTest(
      creds,
      problemId,
      {
        testIndex: vt.index,
        testInput: vt.input,
        testVerdict: vt.verdict,
        testGroup: vt.group,
        testset: vt.testset,
        checkExisting: false,
      },
      pin,
    );
    report(
      "Uploading validator tests",
      ++summary.validatorTests,
      content.validatorTests.length,
    );
  });

  // Checker tests (input/output/answer + expected checker verdict).
  report("Uploading checker tests", 0, content.checkerTests.length);
  await runPool(content.checkerTests, SYNC_CONCURRENCY, async (ct) => {
    await problemSaveCheckerTest(
      creds,
      problemId,
      {
        testIndex: ct.index,
        testInput: ct.input,
        testOutput: ct.output,
        testAnswer: ct.answer,
        testVerdict: ct.verdict,
        checkExisting: false,
      },
      pin,
    );
    report("Uploading checker tests", ++summary.checkerTests, content.checkerTests.length);
  });

  return summary;
}

// Re-exported so callers can read/write the folder content directly.
export { readProjectContent, writeProjectContent };
