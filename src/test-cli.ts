/**
 * Tiny CLI to verify request signing against the real Polygon API.
 *
 * Credentials are read from environment variables (never hard-code them):
 *   POLYGON_API_KEY, POLYGON_API_SECRET
 *
 * Usage:
 *   npx tsx src/test-cli.ts <methodName> [key=value ...]
 *
 * Examples:
 *   npx tsx src/test-cli.ts problems.list
 *   npx tsx src/test-cli.ts problem.info problemId=12345
 *   npx tsx src/test-cli.ts problem.solutions problemId=12345
 *
 * PowerShell, set creds for the session first:
 *   $env:POLYGON_API_KEY="..."; $env:POLYGON_API_SECRET="..."
 */
import { callPolygon, PolygonApiError, type PolygonCredentials } from "./core/client";

function readCredentials(): PolygonCredentials {
  const apiKey = process.env.POLYGON_API_KEY;
  const apiSecret = process.env.POLYGON_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error(
      "Missing credentials. Set POLYGON_API_KEY and POLYGON_API_SECRET.\n" +
        'PowerShell: $env:POLYGON_API_KEY="..."; $env:POLYGON_API_SECRET="..."',
    );
    process.exit(1);
  }
  return { apiKey, apiSecret };
}

function parseParams(args: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq === -1) {
      console.error(`Ignoring malformed param (expected key=value): ${arg}`);
      continue;
    }
    params[arg.slice(0, eq)] = arg.slice(eq + 1);
  }
  return params;
}

async function main(): Promise<void> {
  const [method, ...rest] = process.argv.slice(2);
  if (!method) {
    console.error("Usage: tsx src/test-cli.ts <methodName> [key=value ...]");
    process.exit(1);
  }

  const creds = readCredentials();
  const params = parseParams(rest);

  console.error(`→ calling ${method} ${JSON.stringify(params)}`);
  try {
    const result = await callPolygon(creds, method, params);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof PolygonApiError) {
      console.error(`✗ ${err.message}`);
    } else {
      console.error("✗ Request error:", err);
    }
    process.exit(1);
  }
}

void main();
