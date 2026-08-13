// Offline self-test for the API client's request gate + rate-limit retry.
// Uses a fake fetch — no network, no credentials. Run with `npm run selftest:ratelimit`.

import { callPolygon, configureRateLimit } from "./client";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

const creds = { apiKey: "k", apiSecret: "s" };

/** A fake Polygon response (Polygon answers 200 + a FAILED envelope when throttled). */
function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function main(): Promise<void> {
  // ---- retries a throttled call, then succeeds ----
  let calls = 0;
  configureRateLimit({ minIntervalMs: 0, maxRetries: 5, baseBackoffMs: 20 });
  const flaky = async (): Promise<Response> => {
    calls++;
    return calls <= 2
      ? jsonRes({ status: "FAILED", comment: "Too many requests. Please, wait." })
      : jsonRes({ status: "OK", result: 42 });
  };
  const got = await callPolygon<number>(creds, "problem.info", {}, flaky as typeof fetch);
  check("retries a throttled call then succeeds", got === 42 && calls === 3, {
    got,
    calls,
  });

  // ---- HTTP 429 counts as throttling too ----
  let n429 = 0;
  const http429 = async (): Promise<Response> => {
    n429++;
    return n429 === 1
      ? jsonRes({ status: "FAILED", comment: "nope" }, 429)
      : jsonRes({ status: "OK", result: "ok" });
  };
  await callPolygon(creds, "problem.info", {}, http429 as typeof fetch);
  check("HTTP 429 is retried", n429 === 2, n429);

  // ---- gives up after maxRetries with an actionable message ----
  configureRateLimit({ maxRetries: 2, baseBackoffMs: 10 });
  const always = async (): Promise<Response> =>
    jsonRes({ status: "FAILED", comment: "Too many requests" });
  let message = "";
  try {
    await callPolygon(creds, "problem.saveTest", {}, always as typeof fetch);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  check("gives up after maxRetries", /after 2 retries/.test(message), message);

  // ---- ordinary API failures are surfaced immediately, not retried ----
  let nDenied = 0;
  const denied = async (): Promise<Response> => {
    nDenied++;
    return jsonRes({ status: "FAILED", comment: "problemId: Problem not found" });
  };
  try {
    await callPolygon(creds, "problem.info", {}, denied as typeof fetch);
  } catch {
    // expected
  }
  check("ordinary errors are not retried", nDenied === 1, nDenied);

  // ---- minIntervalMs spaces out concurrent callers ----
  configureRateLimit({ minIntervalMs: 100, maxRetries: 0 });
  const ok = async (): Promise<Response> => jsonRes({ status: "OK", result: 1 });
  const started = Date.now();
  await Promise.all(
    Array.from({ length: 4 }, () =>
      callPolygon(creds, "problem.info", {}, ok as typeof fetch),
    ),
  );
  const elapsed = Date.now() - started;
  check("4 parallel calls are spaced ≥100ms apart", elapsed >= 300, `${elapsed}ms`);

  console.log(
    failures === 0
      ? "\nAll rate-limit self-tests passed."
      : `\n${failures} rate-limit self-test(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
