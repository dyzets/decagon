/**
 * Offline self-test for the signing logic (no network, no credentials).
 * Run: npx tsx src/core/sign.selftest.ts
 *
 * It checks structural invariants of apiSig and recomputes the hash with a
 * fixed prefix so the value is reproducible and inspectable.
 */
import { createHash } from "node:crypto";
import { buildApiSig, sortParams, type ParamPair } from "./sign";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.error(`  FAIL ${name}`);
    failures++;
  }
}

// 1) apiSig structure: 6-char prefix + 128 hex chars (sha512).
const sig = buildApiSig(
  "problems.list",
  [["apiKey", "abc"], ["time", "1700000000"]],
  "secret",
);
check("apiSig length is 6 + 128", sig.length === 6 + 128);
check("apiSig body is hex", /^[0-9a-z]{6}[0-9a-f]{128}$/.test(sig));

// 2) Sorting is by name, then value.
const sorted = sortParams([
  ["time", "2"],
  ["apiKey", "z"],
  ["apiKey", "a"],
]);
check(
  "sort by name then value",
  JSON.stringify(sorted) ===
    JSON.stringify([["apiKey", "a"], ["apiKey", "z"], ["time", "2"]]),
);

// 3) Reproducible value with a fixed prefix matches an independent recompute.
const params: ParamPair[] = [["apiKey", "key1"], ["time", "100"], ["problemId", "42"]];
const rand = "abcdef";
const expectedQuery = "apiKey=key1&problemId=42&time=100";
const expectedHash = createHash("sha512")
  .update(`${rand}/problem.info?${expectedQuery}#mysecret`, "utf8")
  .digest("hex");
const got = buildApiSig("problem.info", params, "mysecret", rand);
check("reproducible sig with fixed prefix", got === rand + expectedHash);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll signing self-tests passed.");
