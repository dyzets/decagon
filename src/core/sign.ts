import { createHash, randomBytes } from "node:crypto";

/**
 * A single request parameter as a [name, value] pair.
 * Pairs are used (instead of a plain object) so that repeated parameter names
 * (e.g. multiple `testIndex`) are supported, which some Polygon methods require.
 */
export type ParamPair = [name: string, value: string];

/** Characters used for the 6-char random prefix of apiSig. */
const RAND_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate the random prefix required by the Polygon signature scheme.
 * The doc specifies the first 6 characters of apiSig are a random string.
 */
export function randomPrefix(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += RAND_CHARS[bytes[i]! % RAND_CHARS.length];
  }
  return out;
}

/**
 * Sort params lexicographically by name, then by value — exactly as the
 * Polygon signature scheme requires. Returns a new array (does not mutate).
 */
export function sortParams(params: ParamPair[]): ParamPair[] {
  return [...params].sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return 0;
  });
}

/**
 * Build the `apiSig` value for a Polygon API request.
 *
 * apiSig = <rand> + SHA512_hex( "<rand>/<methodName>?<sortedParams>#<secret>" )
 *
 * where:
 *  - <rand> is a 6-character random string,
 *  - <sortedParams> is "name=value" pairs joined by "&", sorted by name then value,
 *    using the RAW (un-encoded) values, and including apiKey and time,
 *  - apiSig itself is NOT part of the signed string.
 *
 * @param methodName e.g. "problems.list" or "problem.info"
 * @param params     all request params INCLUDING apiKey and time, EXCLUDING apiSig
 * @param secret     the apiSecret
 * @param rand       optional fixed prefix (used by tests); random by default
 */
export function buildApiSig(
  methodName: string,
  params: ParamPair[],
  secret: string,
  rand: string = randomPrefix(),
): string {
  const query = sortParams(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const toHash = `${rand}/${methodName}?${query}#${secret}`;
  const hash = createHash("sha512").update(toHash, "utf8").digest("hex");
  return rand + hash;
}
