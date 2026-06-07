// Subset of Polygon API return objects — extend as more methods are wrapped.
// Field names follow the official API docs:
// https://codeforces.github.io/polygon-misc/API

export type AccessType = "READ" | "WRITE" | "OWNER";

/** Returned by problems.list, problem.create, contest.problems. */
export interface Problem {
  id: number;
  owner: string;
  name: string;
  deleted: boolean;
  favourite: boolean;
  accessType: AccessType;
  revision: number;
  latestPackage?: number;
  modified: boolean;
}

/** Returned by problem.info. */
export interface ProblemInfo {
  inputFile: string;
  outputFile: string;
  interactive: boolean;
  wellFormed: boolean;
  timeLimit: number; // ms
  memoryLimit: number; // MB
}

/** Returned by problem.solutions. */
export type SolutionTag =
  | "MA" // main correct solution
  | "OK" // correct
  | "RJ" // rejected (any)
  | "TL"
  | "TO"
  | "TM"
  | "WA"
  | "PE"
  | "ML"
  | "NR"
  | "RE";

export interface Solution {
  name: string;
  modificationTimeSeconds: number;
  length: number;
  sourceType: string;
  tag: SolutionTag;
}

/** Returned by problem.tests. */
export interface Test {
  index: number;
  manual: boolean;
  input?: string;
  description?: string;
  useInStatements: boolean;
  scriptLine?: string;
  group?: string;
  points?: number;
}

/** Verdict of a validator test (problem.validatorTests / saveValidatorTest). */
export type ValidatorVerdict = "VALID" | "INVALID";

/** Returned by problem.validatorTests. */
export interface ValidatorTest {
  index: number;
  input: string;
  expectedVerdict: ValidatorVerdict;
  testset?: string;
  group?: string;
  runVerdict?: string;
  runComment?: string;
}

/** Verdict of a checker test (problem.checkerTests / saveCheckerTest). */
export type CheckerVerdict = "OK" | "WRONG_ANSWER" | "PRESENTATION_ERROR" | "CRASHED";

/** Returned by problem.checkerTests. */
export interface CheckerTest {
  index: number;
  input: string;
  output: string;
  answer: string;
  expectedVerdict: CheckerVerdict;
  runVerdict?: string;
  runComment?: string;
}

/** Points policy of a test group. */
export type PointsPolicy = "COMPLETE_GROUP" | "EACH_TEST";

/** Feedback policy of a test group. */
export type FeedbackPolicy = "NONE" | "POINTS" | "ICPC" | "COMPLETE";

/** Returned by problem.viewTestGroup. */
export interface TestGroup {
  name: string;
  pointsPolicy: PointsPolicy;
  feedbackPolicy: FeedbackPolicy;
  dependencies: string[];
}

/** A single-language statement (problem.statements returns lang -> Statement). */
export interface Statement {
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

/** Map of language code (e.g. "english") to its Statement. */
export type Statements = Record<string, Statement>;

/** Compile-time or runtime stage a grader resource is applied at. */
export type ResourceStage = "COMPILE" | "RUN";

/** Asset a grader resource is applied to. */
export type ResourceAsset = "VALIDATOR" | "INTERACTOR" | "CHECKER" | "SOLUTION";

/**
 * Advanced (grader) properties of a resource file — an experimental Polygon feature
 * that supports IOI-like graders. Only cpp.* and python.* language groups are
 * supported, and it applies to solutions/checker/validator/interactor.
 */
export interface ResourceAdvancedProperties {
  /** Semicolon-separated applicable language groups, e.g. "cpp.*" or "cpp.*;python.*". */
  forTypes: string;
  /** Reserved by Polygon (currently always false). */
  main: boolean;
  stages: ResourceStage[];
  assets: ResourceAsset[];
}

/** A file entry returned by problem.files (named PolygonFile to avoid DOM File). */
export interface PolygonFile {
  name: string;
  modificationTimeSeconds: number;
  length: number;
  sourceType?: string;
  /** Present only for resource files that carry grader advanced properties. */
  resourceAdvancedProperties?: ResourceAdvancedProperties;
}

/** Returned by problem.files. */
export interface ProblemFiles {
  resourceFiles: PolygonFile[];
  sourceFiles: PolygonFile[];
  auxFiles: PolygonFile[];
}

/** Returned by problem.packages. */
export interface Package {
  id: number;
  revision: number;
  creationTimeSeconds: number;
  state: string; // PENDING / RUNNING / READY / FAILED
  comment: string;
  type: string; // standard / linux / windows
}
