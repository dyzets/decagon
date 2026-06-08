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
  SyncSummary,
} from "../shared/ipc";
import { emptyManifest, readManifest, writeManifest } from "./manifest";
import {
  STATEMENT_FILES,
  isBinary,
  writeBytes,
  readProjectContent,
  writeProjectContent,
} from "./projectContent";

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
): Promise<SyncSummary> {
  if (!problemId) {
    throw new Error(
      "This project isn't bound to a Polygon problem yet. Set its problem id first.",
    );
  }
  // Polygon exposes no getter for "enable points"/"enable groups", so we infer them
  // from the pulled data below (the points/group fields only appear when enabled).
  // We still read the previous local content to recover the YES-vs-PERCENT points
  // distinction, which is genuinely undetectable from the API.
  const prev = readProjectContent(dir);

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
  // travel inside the content so writeProjectContent persists them.
  const resourceEntries: ProjectStatementResource[] = [];
  for (const r of stmtResources) {
    const bytes = await problemViewStatementResource(creds, problemId, r.name, pin);
    const buf = Buffer.from(bytes);
    const binary = isBinary(buf);
    if (binary) {
      writeBytes(join(dir, "statements", "resources", r.name), bytes);
      resourceEntries.push({ name: r.name, content: "", binary: true });
    } else {
      resourceEntries.push({ name: r.name, content: buf.toString("utf8"), binary: false });
    }
  }

  const fileEntries = [];
  const groups: [FileType, typeof files.sourceFiles][] = [
    ["source", files.sourceFiles],
    ["resource", files.resourceFiles],
    ["aux", files.auxFiles],
  ];
  for (const [type, list] of groups) {
    for (const f of list) {
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
    }
  }

  const solutionEntries = [];
  for (const s of solutions) {
    const content = await problemViewSolution(creds, problemId, s.name, pin);
    solutionEntries.push({
      name: s.name,
      tag: s.tag,
      sourceType: s.sourceType,
      content,
      push: true,
    });
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
): Promise<SyncSummary> {
  const content = readProjectContent(dir);
  const problemId = content.problemId;
  if (!problemId) {
    throw new Error(
      "This project isn't bound to a Polygon problem yet. Set its problem id first.",
    );
  }
  const summary: SyncSummary = {
    files: 0,
    solutions: 0,
    statements: 0,
    statementResources: 0,
    validatorTests: 0,
    checkerTests: 0,
  };

  // Info first so limits/flags are applied before everything else.
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
  for (const f of content.files) {
    if (f.binary) continue;
    if (f.push === false) continue; // excluded from push (local-only)
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
    summary.files++;
  }

  if (content.checker) await problemSetChecker(creds, problemId, content.checker, pin);
  if (content.validator)
    await problemSetValidator(creds, problemId, content.validator, pin);
  if (content.interactor)
    await problemSetInteractor(creds, problemId, content.interactor, pin);

  for (const s of content.solutions) {
    if (s.push === false) continue; // excluded from push (local-only)
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
    summary.solutions++;
  }

  for (const st of content.statements) {
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
  }

  // Statement resources (text only; binary like images is skipped — the client
  // uploads text, and pull still fetches the binary ones).
  for (const r of content.statementResources) {
    if (r.binary) continue;
    await problemSaveStatementResource(
      creds,
      problemId,
      { name: r.name, file: r.content, checkExisting: false },
      pin,
    );
    summary.statementResources++;
  }

  // Test-generation scripts and manual tests, per testset.
  // Testsets are created on the Polygon website, never by this app — Polygon's API
  // has no create-testset endpoint (a testset only exists once a test is added, and
  // saveScript/enableGroups both require it to already exist). The app only edits
  // testsets that were pulled from Polygon, so we assume each one already exists.
  for (const ts of content.testsets) {
    if (ts.script !== undefined && ts.script.trim() !== "") {
      await problemSaveScript(creds, problemId, ts.name, ts.script, pin);
    }

    // Delete tests removed locally: anything currently on Polygon but no longer in
    // the local content is removed (this is how a test gets deleted on Polygon).
    const localIndices = new Set(ts.tests.map((t) => t.index));
    let serverTests: typeof ts.tests | { index: number }[] = [];
    try {
      serverTests = await problemTests(creds, problemId, ts.name, pin);
    } catch {
      serverTests = [];
    }
    const serverIndices = new Set(serverTests.map((t) => t.index));
    const toDelete = [...serverIndices].filter((i) => !localIndices.has(i));
    if (toDelete.length > 0) {
      await problemDeleteTests(creds, problemId, ts.name, toDelete, pin);
    }

    // Enable/disable groups (the testset already exists; required before assigning
    // any test's group below).
    await problemEnableGroups(creds, problemId, ts.name, ts.enableGroups, pin);

    for (const t of ts.tests) {
      const isManual = t.manual && t.input !== undefined;
      // Manual tests carry their input (add or edit). Generated tests are produced by
      // the script, but we still push their metadata (group/points/description/example)
      // by editing the existing test — only if it already exists on Polygon, otherwise
      // saveTest would try to *add* it (which requires an input we don't have).
      if (!isManual && !serverIndices.has(t.index)) continue;
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
    }
  }

  // Group policies/feedback/dependencies, after tests exist. Groups are derived from
  // tests: a group exists on Polygon only while some test references it (and Polygon
  // drops it once empty), so we only push policies for groups still referenced here.
  // Script-generated groups may not exist until the package is built, so a failure is
  // tolerated rather than aborting the push.
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
  for (const vt of content.validatorTests) {
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
    summary.validatorTests++;
  }

  // Checker tests (input/output/answer + expected checker verdict).
  for (const ct of content.checkerTests) {
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
    summary.checkerTests++;
  }

  return summary;
}

// Re-exported so callers can read/write the folder content directly.
export { readProjectContent, writeProjectContent };
