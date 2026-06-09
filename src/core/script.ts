// Polygon test-generation script parsing/formatting and the script→tests mapping.
//
// A script is a list of lines. Each generator line has the form
//   generator-name [params] > <target>
// where <target> is one of:
//   - a single index   (e.g. `> 13`)
//   - `$`              (the smallest still-available index)
//   - `{indices}`      (e.g. `> {1-3,7}` — one invocation producing several files)
// (see https://codeforces.github.io/polygon-misc/API and the in-app help).
//
// This module is UI-agnostic and Node-runnable so it can be unit-tested
// (`npm run selftest:script`). Keep it free of Electron/DOM imports.

/** Where a generator line writes its output test(s). */
export type ScriptTarget =
  | { kind: "dollar" }
  | { kind: "index"; index: number }
  | { kind: "set"; indices: number[] };

/** A parsed generator line: the command (name + params) and its output target. */
export interface ScriptCommand {
  command: string;
  target: ScriptTarget;
}

/** A line we couldn't parse (comment/blank/other) — preserved verbatim. */
export interface ScriptRaw {
  raw: string;
}

export type ScriptLine = ScriptCommand | ScriptRaw;

export function isRaw(line: ScriptLine): line is ScriptRaw {
  return (line as ScriptRaw).raw !== undefined;
}

/** Parse the index list inside `{…}` (supports `a`, `a-b`, comma-separated). */
function parseIndexSet(inner: string): number[] | null {
  const out: number[] = [];
  for (const part of inner.split(",")) {
    const p = part.trim();
    if (p === "") continue;
    const range = /^(\d+)-(\d+)$/.exec(p);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > b) return null;
      for (let k = a; k <= b; k++) out.push(k);
    } else if (/^\d+$/.test(p)) {
      out.push(Number(p));
    } else {
      return null;
    }
  }
  return out.length > 0 ? out : null;
}

/** Compress an ordered index list into `{…}` form, merging consecutive runs. */
function formatIndexSet(indices: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < indices.length) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j]! + 1) j++;
    parts.push(i === j ? String(indices[i]) : `${indices[i]}-${indices[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

function formatTarget(target: ScriptTarget): string {
  switch (target.kind) {
    case "dollar":
      return "$";
    case "index":
      return String(target.index);
    case "set":
      return `{${formatIndexSet(target.indices)}}`;
  }
}

/** Parse a script's text into lines. Unparseable/blank lines become raw passthrough. */
export function parseScript(text: string): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue; // drop blank lines
    const gt = line.lastIndexOf(">");
    if (gt === -1) {
      lines.push({ raw: rawLine });
      continue;
    }
    const command = line.slice(0, gt).trim();
    const targetStr = line.slice(gt + 1).trim();
    if (command === "") {
      lines.push({ raw: rawLine });
      continue;
    }
    let target: ScriptTarget | null = null;
    if (targetStr === "$") target = { kind: "dollar" };
    else if (/^\d+$/.test(targetStr)) target = { kind: "index", index: Number(targetStr) };
    else if (/^\{.*\}$/.test(targetStr)) {
      const set = parseIndexSet(targetStr.slice(1, -1));
      if (set) target = { kind: "set", indices: set };
    }
    if (!target) {
      lines.push({ raw: rawLine });
      continue;
    }
    lines.push({ command, target });
  }
  return lines;
}

/** Render parsed lines back to script text. */
export function formatScript(lines: ScriptLine[]): string {
  return lines
    .map((l) => (isRaw(l) ? l.raw : `${l.command} > ${formatTarget(l.target)}`))
    .join("\n");
}

/** A test produced by the script, with provenance back to its generator line. */
export interface GeneratedTest {
  index: number;
  command: string;
  /** Index of the source line in the parsed array (groups `{…}` files together). */
  lineId: number;
  /** Position of this file within its line's output (0 for single-output lines). */
  fileOrder: number;
}

/**
 * Resolve the concrete test indices a script generates, mirroring Polygon:
 * explicit (`> N` / `> {…}`) targets occupy their indices, then each `$` takes the
 * smallest index not already used by a reserved (manual) index or another target.
 */
export function resolveGenerated(
  lines: ScriptLine[],
  reserved: Iterable<number>,
): GeneratedTest[] {
  const used = new Set<number>(reserved);
  for (const l of lines) {
    if (isRaw(l)) continue;
    if (l.target.kind === "index") used.add(l.target.index);
    else if (l.target.kind === "set") for (const i of l.target.indices) used.add(i);
  }
  const out: GeneratedTest[] = [];
  let lineId = -1;
  for (const l of lines) {
    lineId++;
    if (isRaw(l)) continue;
    if (l.target.kind === "dollar") {
      let k = 1;
      while (used.has(k)) k++;
      used.add(k);
      out.push({ index: k, command: l.command, lineId, fileOrder: 0 });
    } else if (l.target.kind === "index") {
      out.push({ index: l.target.index, command: l.command, lineId, fileOrder: 0 });
    } else {
      l.target.indices.forEach((idx, fileOrder) =>
        out.push({ index: idx, command: l.command, lineId, fileOrder }),
      );
    }
  }
  return out;
}
