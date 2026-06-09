// Two-way mapping between a testset's generation script and its test list.
//
// Polygon keeps these linked: changing the script changes which tests exist, and
// reordering/deleting tests rewrites the script. Decagon can't run generators, so
// generated tests are shown as placeholders (index + command) derived from the
// script; their actual input is produced by Polygon on build.

import type { ProjectTestEntry, ProjectTestset } from "../shared/ipc";
import {
  parseScript,
  formatScript,
  resolveGenerated,
  isRaw,
  type ScriptLine,
  type ScriptTarget,
} from "../core/script";

/**
 * Recompute the test list from the script, preserving manual tests and carrying over
 * per-test metadata (group/points/description/useInStatements) for generated tests
 * whose index is unchanged. Used when the script text is edited.
 */
export function deriveTests(
  script: string,
  prev: ProjectTestEntry[],
): ProjectTestEntry[] {
  const manual = prev.filter((t) => t.manual);
  const manualIdx = new Set(manual.map((t) => t.index));
  const prevGen = new Map(prev.filter((t) => !t.manual).map((t) => [t.index, t]));

  const generated: ProjectTestEntry[] = [];
  const seen = new Set<number>();
  for (const g of resolveGenerated(parseScript(script), manualIdx)) {
    if (manualIdx.has(g.index) || seen.has(g.index)) continue; // manual wins on collision
    seen.add(g.index);
    const p = prevGen.get(g.index);
    generated.push({
      index: g.index,
      manual: false,
      scriptLine: g.command,
      group: p?.group,
      points: p?.points,
      description: p?.description,
      useInStatements: p?.useInStatements,
    });
  }
  return [...manual, ...generated].sort((a, b) => a.index - b.index);
}

/**
 * Apply a new visual ordering of a testset's tests: renumber them 1..N in the given
 * order, and regenerate the script so each generated test's line targets its new
 * index (multi-file `{…}` lines keep their grouping; `$`/explicit targets become
 * explicit indices). Manual tests keep their input; metadata moves with each row.
 */
export function applyTestOrder(
  ts: ProjectTestset,
  ordered: ProjectTestEntry[],
): ProjectTestset {
  // Provenance for generated tests, keyed by their CURRENT index (before renumbering).
  const manualIdx = ts.tests.filter((t) => t.manual).map((t) => t.index);
  const prov = new Map<number, { command: string; lineId: number; fileOrder: number }>();
  for (const g of resolveGenerated(parseScript(ts.script), manualIdx)) {
    prov.set(g.index, { command: g.command, lineId: g.lineId, fileOrder: g.fileOrder });
  }

  const renum = ordered.map((t, i) => ({ old: t, oldIndex: t.index, newIndex: i + 1 }));
  const newTests = renum
    .map(({ old, newIndex }) => ({ ...old, index: newIndex }))
    .sort((a, b) => a.index - b.index);

  // Group generated tests by their source line so `{…}` invocations stay together.
  interface Group {
    command: string;
    items: { fileOrder: number; newIndex: number }[];
  }
  const groups = new Map<number, Group>();
  let synthId = 1_000_000; // generated rows without provenance each get their own line
  for (const { old, oldIndex, newIndex } of renum) {
    if (old.manual) continue;
    const p = prov.get(oldIndex);
    const lineId = p ? p.lineId : synthId++;
    const command = p ? p.command : old.scriptLine ?? "gen";
    const fileOrder = p ? p.fileOrder : 0;
    const g = groups.get(lineId) ?? { command, items: [] };
    g.items.push({ fileOrder, newIndex });
    groups.set(lineId, g);
  }

  const cmdLines = [...groups.values()]
    .map((g) => {
      const indices = g.items
        .sort((a, b) => a.fileOrder - b.fileOrder)
        .map((x) => x.newIndex);
      const target: ScriptTarget =
        indices.length === 1
          ? { kind: "index", index: indices[0]! }
          : { kind: "set", indices };
      return { command: g.command, target, min: Math.min(...indices) };
    })
    .sort((a, b) => a.min - b.min)
    .map(({ command, target }): ScriptLine => ({ command, target }));

  // Keep any raw (comment/unparseable) lines, placed first in their original order.
  const rawLines = parseScript(ts.script).filter(isRaw);
  return { ...ts, tests: newTests, script: formatScript([...rawLines, ...cmdLines]) };
}
