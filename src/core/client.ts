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

  const res = await fetchImpl(`${POLYGON_BASE_URL}/${methodName}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
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

  const res = await fetchImpl(`${POLYGON_BASE_URL}/${methodName}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const bytes = new Uint8Array(await res.arrayBuffer());

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
