import {
  callPolygon,
  callPolygonRaw,
  callPolygonText,
  type PolygonCredentials,
} from "./client";
import type {
  CheckerTest,
  CheckerVerdict,
  FeedbackPolicy,
  Package,
  PointsPolicy,
  PolygonFile,
  Problem,
  ProblemFiles,
  ProblemInfo,
  ResourceAsset,
  ResourceStage,
  Solution,
  SolutionTag,
  Statements,
  Test,
  TestGroup,
  ValidatorTest,
  ValidatorVerdict,
} from "./types";

/** File category used by problem.viewFile / problem.saveFile. */
export type FileType = "resource" | "source" | "aux";

function withPin(
  params: Record<string, string | number>,
  pin?: string,
): Record<string, string | number> {
  return pin ? { ...params, pin } : params;
}

/** Create a new empty problem and return it. */
export function problemCreate(
  creds: PolygonCredentials,
  name: string,
): Promise<Problem> {
  return callPolygon<Problem>(creds, "problem.create", { name });
}

/** List problems visible to the credentials (optionally filtered). */
export function problemsList(
  creds: PolygonCredentials,
  filter: { showDeleted?: boolean; id?: number; name?: string; owner?: string } = {},
): Promise<Problem[]> {
  const params: Record<string, string | number | boolean> = {};
  if (filter.showDeleted !== undefined) params.showDeleted = filter.showDeleted;
  if (filter.id !== undefined) params.id = filter.id;
  if (filter.name !== undefined) params.name = filter.name;
  if (filter.owner !== undefined) params.owner = filter.owner;
  return callPolygon<Problem[]>(creds, "problems.list", params);
}

/** Read a problem's general info (limits, I/O files, interactive flag). */
export function problemInfo(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<ProblemInfo> {
  const params: Record<string, string | number> = { problemId };
  if (pin) params.pin = pin;
  return callPolygon<ProblemInfo>(creds, "problem.info", params);
}

/** List a problem's solutions and their tags. */
export function problemSolutions(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<Solution[]> {
  const params: Record<string, string | number> = { problemId };
  if (pin) params.pin = pin;
  return callPolygon<Solution[]>(creds, "problem.solutions", params);
}

/** List a problem's tests for a testset (defaults to "tests"). */
export function problemTests(
  creds: PolygonCredentials,
  problemId: number,
  testset = "tests",
  pin?: string,
): Promise<Test[]> {
  const params: Record<string, string | number> = { problemId, testset };
  if (pin) params.pin = pin;
  return callPolygon<Test[]>(creds, "problem.tests", params);
}

/** Get all statements keyed by language. */
export function problemStatements(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<Statements> {
  return callPolygon<Statements>(
    creds,
    "problem.statements",
    withPin({ problemId }, pin),
  );
}

/** List resource/source/aux files of a problem. */
export function problemFiles(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<ProblemFiles> {
  return callPolygon<ProblemFiles>(
    creds,
    "problem.files",
    withPin({ problemId }, pin),
  );
}

/** Read the content of a problem file (resource/source/aux) as text. */
export function problemViewFile(
  creds: PolygonCredentials,
  problemId: number,
  type: FileType,
  name: string,
  pin?: string,
): Promise<string> {
  return callPolygonText(
    creds,
    "problem.viewFile",
    withPin({ problemId, type, name }, pin),
  );
}

/** Read a solution's source as text. */
export function problemViewSolution(
  creds: PolygonCredentials,
  problemId: number,
  name: string,
  pin?: string,
): Promise<string> {
  return callPolygonText(
    creds,
    "problem.viewSolution",
    withPin({ problemId, name }, pin),
  );
}

/** Add or edit a problem file. */
export function problemSaveFile(
  creds: PolygonCredentials,
  problemId: number,
  args: {
    type: FileType;
    name: string;
    file: string;
    sourceType?: string;
    checkExisting?: boolean;
    /**
     * Resource advanced properties (graders). When `forTypes` is defined, all three of
     * forTypes/stages/assets are sent together (Polygon requires this); pass an empty
     * `forTypes: ""` to clear any existing advanced properties. Omit `forTypes` entirely
     * to leave them untouched.
     */
    forTypes?: string;
    stages?: ResourceStage[];
    assets?: ResourceAsset[];
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = {
    problemId,
    type: args.type,
    name: args.name,
    file: args.file,
  };
  if (args.sourceType) params.sourceType = args.sourceType;
  if (args.checkExisting !== undefined) params.checkExisting = String(args.checkExisting);
  // Advanced properties must be sent as a trio (or all omitted).
  if (args.forTypes !== undefined) {
    params.forTypes = args.forTypes;
    params.stages = (args.stages ?? []).join(";");
    params.assets = (args.assets ?? []).join(";");
  }
  return callPolygon<void>(creds, "problem.saveFile", withPin(params, pin));
}

/** Add or edit a solution. */
export function problemSaveSolution(
  creds: PolygonCredentials,
  problemId: number,
  args: {
    name: string;
    file: string;
    sourceType?: string;
    tag: SolutionTag;
    checkExisting?: boolean;
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = {
    problemId,
    name: args.name,
    file: args.file,
    tag: args.tag,
  };
  if (args.sourceType) params.sourceType = args.sourceType;
  if (args.checkExisting !== undefined) params.checkExisting = String(args.checkExisting);
  return callPolygon<void>(creds, "problem.saveSolution", withPin(params, pin));
}

/** Create or update a statement for one language. */
export function problemSaveStatement(
  creds: PolygonCredentials,
  problemId: number,
  lang: string,
  fields: {
    encoding?: string;
    name?: string;
    legend?: string;
    input?: string;
    output?: string;
    scoring?: string;
    interaction?: string;
    notes?: string;
    tutorial?: string;
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = { problemId, lang };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) params[k] = v;
  }
  return callPolygon<void>(creds, "problem.saveStatement", withPin(params, pin));
}

/** Update a problem's general info (limits, I/O files, interactive flag). */
export function problemUpdateInfo(
  creds: PolygonCredentials,
  problemId: number,
  fields: {
    inputFile?: string;
    outputFile?: string;
    interactive?: boolean;
    wellFormed?: boolean;
    timeLimit?: number;
    memoryLimit?: number;
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = { problemId };
  if (fields.inputFile !== undefined) params.inputFile = fields.inputFile;
  if (fields.outputFile !== undefined) params.outputFile = fields.outputFile;
  if (fields.interactive !== undefined) params.interactive = String(fields.interactive);
  if (fields.wellFormed !== undefined) params.wellFormed = String(fields.wellFormed);
  if (fields.timeLimit !== undefined) params.timeLimit = fields.timeLimit;
  if (fields.memoryLimit !== undefined) params.memoryLimit = fields.memoryLimit;
  return callPolygon<void>(creds, "problem.updateInfo", withPin(params, pin));
}

/** Enable or disable per-test points for the whole problem. */
export function problemEnablePoints(
  creds: PolygonCredentials,
  problemId: number,
  enable: boolean,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.enablePoints",
    withPin({ problemId, enable: String(enable) }, pin),
  );
}

/** Treat the checker's points as a percentage (requires points enabled). */
export function problemEnableTreatPointsFromCheckerAsPercent(
  creds: PolygonCredentials,
  problemId: number,
  enable: boolean,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.enableTreatPointsFromCheckerAsPercent",
    withPin({ problemId, enable: String(enable) }, pin),
  );
}

/** Enable or disable test groups for a testset. */
export function problemEnableGroups(
  creds: PolygonCredentials,
  problemId: number,
  testset: string,
  enable: boolean,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.enableGroups",
    withPin({ problemId, testset, enable: String(enable) }, pin),
  );
}

/** List test groups of a testset. */
export function problemViewTestGroups(
  creds: PolygonCredentials,
  problemId: number,
  testset: string,
  pin?: string,
): Promise<TestGroup[]> {
  return callPolygon<TestGroup[]>(
    creds,
    "problem.viewTestGroup",
    withPin({ problemId, testset }, pin),
  );
}

/** Create or update a test group's policies and dependencies. */
export function problemSaveTestGroup(
  creds: PolygonCredentials,
  problemId: number,
  args: {
    testset: string;
    group: string;
    pointsPolicy?: PointsPolicy;
    feedbackPolicy?: FeedbackPolicy;
    dependencies?: string[];
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = {
    problemId,
    testset: args.testset,
    group: args.group,
  };
  if (args.pointsPolicy) params.pointsPolicy = args.pointsPolicy;
  if (args.feedbackPolicy) params.feedbackPolicy = args.feedbackPolicy;
  if (args.dependencies) params.dependencies = args.dependencies.join(",");
  return callPolygon<void>(creds, "problem.saveTestGroup", withPin(params, pin));
}

/** Get the current checker name (empty string if none). */
export function problemChecker(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<string> {
  return callPolygon<string>(creds, "problem.checker", withPin({ problemId }, pin));
}

/** Set the checker by source-file name. */
export function problemSetChecker(
  creds: PolygonCredentials,
  problemId: number,
  checker: string,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.setChecker",
    withPin({ problemId, checker }, pin),
  );
}

/** Get the current validator name (empty string if none). */
export function problemValidator(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<string> {
  return callPolygon<string>(creds, "problem.validator", withPin({ problemId }, pin));
}

/** Set the validator by source-file name. */
export function problemSetValidator(
  creds: PolygonCredentials,
  problemId: number,
  validator: string,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.setValidator",
    withPin({ problemId, validator }, pin),
  );
}

/** Get the current interactor name (empty string if none). */
export function problemInteractor(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<string> {
  return callPolygon<string>(creds, "problem.interactor", withPin({ problemId }, pin));
}

/** Set the interactor by source-file name. */
export function problemSetInteractor(
  creds: PolygonCredentials,
  problemId: number,
  interactor: string,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.setInteractor",
    withPin({ problemId, interactor }, pin),
  );
}

/** Get the test-generation script for a testset (defaults to "tests"). */
export function problemScript(
  creds: PolygonCredentials,
  problemId: number,
  testset = "tests",
  pin?: string,
): Promise<string> {
  return callPolygonText(
    creds,
    "problem.script",
    withPin({ problemId, testset }, pin),
  );
}

/** Save the test-generation script for a testset. */
export function problemSaveScript(
  creds: PolygonCredentials,
  problemId: number,
  testset: string,
  source: string,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.saveScript",
    withPin({ problemId, testset, source }, pin),
  );
}

/** Add or edit a single test in a testset. */
export function problemSaveTest(
  creds: PolygonCredentials,
  problemId: number,
  args: {
    testset: string;
    testIndex: number;
    testInput?: string;
    testGroup?: string;
    testPoints?: number;
    testDescription?: string;
    testUseInStatements?: boolean;
    checkExisting?: boolean;
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = {
    problemId,
    testset: args.testset,
    testIndex: args.testIndex,
  };
  if (args.testInput !== undefined) params.testInput = args.testInput;
  if (args.testGroup !== undefined) params.testGroup = args.testGroup;
  if (args.testPoints !== undefined) params.testPoints = args.testPoints;
  if (args.testDescription !== undefined) params.testDescription = args.testDescription;
  if (args.testUseInStatements !== undefined)
    params.testUseInStatements = String(args.testUseInStatements);
  if (args.checkExisting !== undefined) params.checkExisting = String(args.checkExisting);
  return callPolygon<void>(creds, "problem.saveTest", withPin(params, pin));
}

/** List validator tests. */
export function problemValidatorTests(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<ValidatorTest[]> {
  return callPolygon<ValidatorTest[]>(
    creds,
    "problem.validatorTests",
    withPin({ problemId }, pin),
  );
}

/** Add or edit a validator test. */
export function problemSaveValidatorTest(
  creds: PolygonCredentials,
  problemId: number,
  args: {
    testIndex: number;
    testInput: string;
    testVerdict: ValidatorVerdict;
    testGroup?: string;
    testset?: string;
    checkExisting?: boolean;
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = {
    problemId,
    testIndex: args.testIndex,
    testInput: args.testInput,
    testVerdict: args.testVerdict,
  };
  if (args.testGroup !== undefined) params.testGroup = args.testGroup;
  if (args.testset !== undefined) params.testset = args.testset;
  if (args.checkExisting !== undefined) params.checkExisting = String(args.checkExisting);
  return callPolygon<void>(creds, "problem.saveValidatorTest", withPin(params, pin));
}

/** List checker tests. */
export function problemCheckerTests(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<CheckerTest[]> {
  return callPolygon<CheckerTest[]>(
    creds,
    "problem.checkerTests",
    withPin({ problemId }, pin),
  );
}

/** Add or edit a checker test. */
export function problemSaveCheckerTest(
  creds: PolygonCredentials,
  problemId: number,
  args: {
    testIndex: number;
    testInput: string;
    testOutput: string;
    testAnswer: string;
    testVerdict: CheckerVerdict;
    checkExisting?: boolean;
  },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = {
    problemId,
    testIndex: args.testIndex,
    testInput: args.testInput,
    testOutput: args.testOutput,
    testAnswer: args.testAnswer,
    testVerdict: args.testVerdict,
  };
  if (args.checkExisting !== undefined) params.checkExisting = String(args.checkExisting);
  return callPolygon<void>(creds, "problem.saveCheckerTest", withPin(params, pin));
}

/** Delete one or more tests from a testset (all-or-nothing pre-check on Polygon). */
export function problemDeleteTests(
  creds: PolygonCredentials,
  problemId: number,
  testset: string,
  testIndices: number[],
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.deleteTest",
    withPin({ problemId, testset, testIndices: testIndices.join(",") }, pin),
  );
}

/** List built packages for a problem. */
export function problemPackages(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<Package[]> {
  return callPolygon<Package[]>(
    creds,
    "problem.packages",
    withPin({ problemId }, pin),
  );
}

/** Start building a package (requires WRITE access). */
export function problemBuildPackage(
  creds: PolygonCredentials,
  problemId: number,
  full: boolean,
  verify: boolean,
  pin?: string,
): Promise<void> {
  return callPolygon<void>(
    creds,
    "problem.buildPackage",
    withPin({ problemId, full: String(full), verify: String(verify) }, pin),
  );
}

/** Download a built package as raw ZIP bytes. */
export function problemPackageBytes(
  creds: PolygonCredentials,
  problemId: number,
  packageId: number,
  type?: string,
  pin?: string,
): Promise<Uint8Array> {
  const params: Record<string, string | number> = { problemId, packageId };
  if (type) params.type = type;
  return callPolygonRaw(creds, "problem.package", withPin(params, pin));
}

/** List statement resource files (images, .sty, ...) shared by all statements. */
export function problemStatementResources(
  creds: PolygonCredentials,
  problemId: number,
  pin?: string,
): Promise<PolygonFile[]> {
  return callPolygon<PolygonFile[]>(
    creds,
    "problem.statementResources",
    withPin({ problemId }, pin),
  );
}

/** Read a statement resource file as raw bytes (may be binary, e.g. images). */
export function problemViewStatementResource(
  creds: PolygonCredentials,
  problemId: number,
  name: string,
  pin?: string,
): Promise<Uint8Array> {
  return callPolygonRaw(
    creds,
    "problem.viewStatementResource",
    withPin({ problemId, name }, pin),
  );
}

/** Add or edit a statement resource file (text content). */
export function problemSaveStatementResource(
  creds: PolygonCredentials,
  problemId: number,
  args: { name: string; file: string; checkExisting?: boolean },
  pin?: string,
): Promise<void> {
  const params: Record<string, string | number> = {
    problemId,
    name: args.name,
    file: args.file,
  };
  if (args.checkExisting !== undefined) params.checkExisting = String(args.checkExisting);
  return callPolygon<void>(
    creds,
    "problem.saveStatementResource",
    withPin(params, pin),
  );
}

/** Commit working-copy changes (requires WRITE access). */
export function problemCommitChanges(
  creds: PolygonCredentials,
  problemId: number,
  message: string,
  minorChanges = false,
  pin?: string,
): Promise<unknown> {
  return callPolygon(
    creds,
    "problem.commitChanges",
    withPin(
      { problemId, message, minorChanges: String(minorChanges) },
      pin,
    ),
  );
}
