// Offline self-test for the Polygon script parser/formatter (no network/creds).
// Run with `npm run selftest:script`.

import {
  parseScript,
  formatScript,
  resolveGenerated,
  isRaw,
  type ScriptLine,
} from "./script";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, `got ${g} want ${w}`);
}

// ---- parsing ----
const parsed = parseScript(
  ["gen 7 0.2 abaca > 13", "gen > $", "gen2 4 7 > {1-3,7}", "# a comment"].join("\n"),
);
eq("parse: line count", parsed.length, 4);
eq("parse: explicit index", parsed[0], { command: "gen 7 0.2 abaca", target: { kind: "index", index: 13 } });
eq("parse: dollar", parsed[1], { command: "gen", target: { kind: "dollar" } });
eq("parse: set", parsed[2], {
  command: "gen2 4 7",
  target: { kind: "set", indices: [1, 2, 3, 7] },
});
check("parse: comment kept raw", isRaw(parsed[3]!));

// ---- formatting round-trips (set ranges compress) ----
eq(
  "format: set compresses ranges",
  formatScript([{ command: "gen2 4 7", target: { kind: "set", indices: [1, 2, 3, 7] } }]),
  "gen2 4 7 > {1-3,7}",
);
eq(
  "format: non-consecutive set",
  formatScript([{ command: "g", target: { kind: "set", indices: [5, 2, 8] } }]),
  "g > {5,2,8}",
);

// ---- $ resolution against reserved (manual) indices ----
const lines: ScriptLine[] = parseScript(["a > 2", "b > $", "c > $"].join("\n"));
const gen = resolveGenerated(lines, [1]); // index 1 is a manual test
eq(
  "resolve: dollars skip reserved + explicit",
  gen.map((g) => g.index),
  [2, 3, 4],
);

// set produces one test per file index, grouped under one lineId
const setGen = resolveGenerated(parseScript("g 1 > {4-5}"), []);
eq("resolve: set indices", setGen.map((g) => g.index), [4, 5]);
check("resolve: set shares lineId", setGen[0]!.lineId === setGen[1]!.lineId);
eq("resolve: set fileOrder", setGen.map((g) => g.fileOrder), [0, 1]);

if (failures > 0) {
  console.error(`\nscript selftest: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nscript selftest: all passed");
