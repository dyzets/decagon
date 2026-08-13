import { buildApiSig, type ParamPair } from "./sign";

export const POLYGON_BASE_URL = "https://polygon.codeforces.com/api";

export interface PolygonCredentials {
  apiKey: string;
  apiSecret: string;
}

/** Raw envelope returned by every Polygon API method. */
export interface PolygonEnvelope<T> {
  status: "OK" | "FAILED";
  comment?: string;
  result?: T;
}

/** Method params accepted by callPolygon: an object, or pairs for repeated keys. */
export type MethodParams =
  | Record<string, string | number | boolean>
  | ParamPair[];

/** Error thrown when Polygon returns status: "FAILED". */
export class PolygonApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly comment: string,
  ) {
    super(`Polygon API "${method}" FAILED: ${comment}`);
    this.name = "PolygonApiError";
  }
}

function toPairs(params: MethodParams): ParamPair[] {
  if (Array.isArray(params)) return params;
  return Object.entries(params).map(([k, v]) => [k, String(v)] as ParamPair);
}

// --- Rate limiting -----------------------------------------------------------
// Polygon rate-limits the API and does not publish the limit, so every request goes
// through a process-wide gate (min spacing between request starts) and is retried
// with exponential backoff when Polygon rejects it as "too many requests". This lives
// in core so both the app and `npm run cli` get it; main configures it from the user's
// settings (src/main/settings.ts).

/** Tunables for the request gate + rate-limit retry. */
export interface RateLimitPolicy {
  /** Minimum ms between two request starts across all callers (0 = no spacing). */
  minIntervalMs: number;
  /** Retries after a rate-limit rejection (0 = fail immediately). */
  maxRetries: number;
  /** First backoff in ms; doubles each retry (plus jitter). */
  baseBackoffMs: number;
}

const DEFAULT_RATE_LIMIT: RateLimitPolicy = {
  minIntervalMs: 0,
  maxRetries: 5,
  baseBackoffMs: 1000,
};

let policy: RateLimitPolicy = { ...DEFAULT_RATE_LIMIT };

/** Override the rate-limit policy (partial). Applies to subsequent requests. */
export function configureRateLimit(p: Partial<RateLimitPolicy>): void {
  policy = { ...policy, ...p };
}

export function getRateLimitPolicy(): RateLimitPolicy {
  return { ...policy };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Serializing on a promise chain spaces out concurrent callers too: each waiter takes
// its turn, then waits out the remaining gap since the previous request started.
let gateChain: Promise<void> = Promise.resolve();
let lastStart = 0;

function gate(): Promise<void> {
  const turn = gateChain.then(async () => {
    if (policy.minIntervalMs > 0) {
      const wait = lastStart + policy.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = Date.now();
  });
  gateChain = turn.catch(() => undefined);
  return turn;
}

/** Polygon's wording for a throttled call (it answers 200 + a FAILED envelope). */
const RATE_LIMIT_RE = /too many requests|rate limit|call limit/i;

/**
 * Detect a rate-limit rejection, returning Polygon's message (or null if the response
 * is something else). Binary responses simply fail to parse and yield null.
 */
function rateLimitReason(res: Response, bytes: Uint8Array): string | null {
  if (res.status === 429) return `HTTP 429 (too many requests)`;
  try {
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as PolygonEnvelope<unknown>;
    if (envelope.status === "FAILED" && RATE_LIMIT_RE.test(envelope.comment ?? "")) {
      return envelope.comment ?? "too many requests";
    }
  } catch {
    // Not JSON (a package/file download) — not a rate-limit envelope.
  }
  return null;
}

/**
 * POST a signed request through the gate, retrying rate-limit rejections with
 * exponential backoff. Returns the response plus its raw body; callers decode it.
 */
async function send(
  methodName: string,
  makeBody: () => string,
  fetchImpl: typeof fetch,
): Promise<{ res: Response; bytes: Uint8Array }> {
  for (let attempt = 0; ; attempt++) {
    await gate();
    // Re-signed per attempt: `time` must be within 5 min of the server, and waiting
    // out a backoff would otherwise age the signature.
    const res = await fetchImpl(`${POLYGON_BASE_URL}/${methodName}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: makeBody(),
    });
    const bytes = new Uint8Array(await res.arrayBuffer());

    const reason = rateLimitReason(res, bytes);
    if (!reason) return { res, bytes };
    if (attempt >= policy.maxRetries) {
      throw new PolygonApiError(
        methodName,
        `${reason} — still rate-limited after ${policy.maxRetries} retries. ` +
          `Lower "Parallel Polygon requests" in Settings (or raise the delay between requests).`,
      );
    }
    // Exponential backoff with jitter so parallel workers don't retry in lockstep.
    const backoff = policy.baseBackoffMs * 2 ** attempt;
    await sleep(backoff + Math.random() * backoff * 0.25);
  }
}

/** Build the signed urlencoded body for a method call. */
function signedBody(
  creds: PolygonCredentials,
  methodName: string,
  methodParams: MethodParams,
): string {
  const time = Math.floor(Date.now() / 1000).toString();
  const pairs: ParamPair[] = [
    ...toPairs(methodParams),
    ["apiKey", creds.apiKey],
    ["time", time],
  ];
  const apiSig = buildApiSig(methodName, pairs, creds.apiSecret);

  const body = new URLSearchParams();
  for (const [k, v] of pairs) body.append(k, v);
  body.append("apiSig", apiSig);
  return body.toString();
}

/**
 * Call a Polygon API method and return its `result` payload.
 *
 * The request is signed per the Polygon scheme and sent as
 * application/x-www-form-urlencoded POST (handles params of any size and
 * sidesteps URL length limits). Throws PolygonApiError on a FAILED status.
 *
 * Note: signing uses RAW param values; the HTTP body uses URL-encoded values.
 */
export async function callPolygon<T = unknown>(
  creds: PolygonCredentials,
  methodName: string,
  methodParams: MethodParams = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const { res, bytes } = await send(
    methodName,
    () => signedBody(creds, methodName, methodParams),
    fetchImpl,
  );

  const text = new TextDecoder().decode(bytes);
  let envelope: PolygonEnvelope<T>;
  try {
    envelope = JSON.parse(text) as PolygonEnvelope<T>;
  } catch {
    throw new Error(
      `Polygon "${methodName}": non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`,
    );
  }

  if (envelope.status !== "OK") {
    throw new PolygonApiError(methodName, envelope.comment ?? "unknown error");
  }
  return envelope.result as T;
}

/**
 * Call a Polygon method that returns raw bytes on success (e.g. problem.package,
 * problem.viewFile, problem.viewSolution). On failure Polygon still returns a JSON
 * envelope, which we detect and surface as a PolygonApiError.
 */
export async function callPolygonRaw(
  creds: PolygonCredentials,
  methodName: string,
  methodParams: MethodParams = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const { res, bytes } = await send(
    methodName,
    () => signedBody(creds, methodName, methodParams),
    fetchImpl,
  );

  // Polygon signals errors with a JSON envelope even on these endpoints.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const envelope = JSON.parse(new TextDecoder().decode(bytes)) as PolygonEnvelope<unknown>;
      if (envelope.status === "FAILED") {
        throw new PolygonApiError(methodName, envelope.comment ?? "unknown error");
      }
    } catch (err) {
      if (err instanceof PolygonApiError) throw err;
      // Not actually JSON — fall through and return the bytes.
    }
  }
  return bytes;
}

/** Decode raw bytes from a text endpoint to a UTF-8 string. */
export async function callPolygonText(
  creds: PolygonCredentials,
  methodName: string,
  methodParams: MethodParams = {},
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const bytes = await callPolygonRaw(creds, methodName, methodParams, fetchImpl);
  return new TextDecoder().decode(bytes);
}
