/**
 * Turn Jev's judgments and the graph into Bombadil branch weights. The policy
 * lives here, in code: change a coefficient and rerun without re-asking Jev.
 */
import { writeFile } from "node:fs/promises";
import { controlKey, type ControlFields } from "../bombadil/key.ts";
import type { ControlInfo } from "./trace.ts";
import type { CodeSlice } from "./link.ts";
import { Judge, type Judgment } from "./judge.ts";
import type { Graph } from "./trace.ts";
import { sliceFor } from "./link.ts";

export const FLOOR = 100;
export const SCALE = 1000;
/** How much of a destination page's risk a link inherits per hop. */
export const LINK_DECAY = 0.5;

export type WeightEntry = {
  weight: number;
  risk: number;
  page: string;
  control: string;
  reasons: string[];
  judgment?: Judgment;
};

export type WeightTable = {
  generatedAt: string;
  floor: number;
  scale: number;
  weights: Record<string, WeightEntry>;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Risk that interacting with a non-link control produces a violation. */
export function controlRisk(j: Judgment): { risk: number; reasons: string[] } {
  const reasons: string[] = [];
  const crash = Math.max(j.throwsOrRejects, 0.6 * j.logsConsoleError);
  const inconsistency = Math.max(
    1 - j.handlerBoundToControl,
    1 - j.updatesCorrectElements,
    1 - j.updatesAllDependentViews,
  );
  const severity = j.severity / 2;
  const risk = clamp01(0.35 * crash + 0.35 * inconsistency + 0.1 * j.unguardedState + 0.2 * severity);
  if (j.throwsOrRejects >= 0.5) reasons.push(`throws/rejects ${j.throwsOrRejects.toFixed(2)}`);
  if (j.logsConsoleError >= 0.5) reasons.push(`console.error ${j.logsConsoleError.toFixed(2)}`);
  if (j.handlerBoundToControl < 0.5) reasons.push(`no direct handler ${(1 - j.handlerBoundToControl).toFixed(2)}`);
  if (j.updatesCorrectElements < 0.5) reasons.push(`wrong update target ${(1 - j.updatesCorrectElements).toFixed(2)}`);
  if (j.updatesAllDependentViews < 0.5) reasons.push(`stale dependent view ${(1 - j.updatesAllDependentViews).toFixed(2)}`);
  if (j.unguardedState >= 0.5) reasons.push(`unguarded state ${j.unguardedState.toFixed(2)}`);
  if (j.needsRepetition >= 0.5) reasons.push(`needs repetition ${j.needsRepetition.toFixed(2)}`);
  reasons.push(`severity ${j.severity.toFixed(2)} (conf ${j.severityConfidence.toFixed(2)})`);
  return { risk, reasons };
}

export async function computeWeights(
  graph: Graph,
  siteRoot: string,
  judge: Judge,
  log: (line: string) => void,
): Promise<WeightTable> {
  type Item = { page: string; key: string; fields: ControlInfo; slice: CodeSlice };
  const items: Item[] = [];
  for (const node of graph.nodes.values()) {
    for (const [key, fields] of node.controls) {
      items.push({ page: node.page, key, fields, slice: await sliceFor(siteRoot, node.page, fields) });
    }
  }

  // Judge every non-link control. Links are weighted by their destination.
  const judged = new Map<string, { judgment: Judgment; risk: number; reasons: string[] }>();
  const pageRisk = new Map<string, number>();
  let asked = 0;
  let cached = 0;
  await Promise.all(
    items
      .filter((it) => it.slice.link === null)
      .map(async (it) => {
        const { judgment, cached: hit } = await judge.judge(it.fields, it.slice);
        hit ? cached++ : asked++;
        const { risk, reasons } = controlRisk(judgment);
        judged.set(it.key, { judgment, risk, reasons });
        pageRisk.set(it.page, Math.max(pageRisk.get(it.page) ?? 0, risk));
      }),
  );
  log(`judged ${judged.size} controls (${asked} new requests, ${cached} cached)`);

  // Propagate risk backwards through links with decay, so a page that only
  // links onward inherits some of the risk of what it leads to.
  const linkTargets = new Map<string, string[]>();
  for (const it of items) {
    if (!it.slice.link?.exists) continue;
    linkTargets.set(it.page, [...(linkTargets.get(it.page) ?? []), it.slice.link.target]);
  }
  for (let round = 0; round < 4; round++) {
    for (const [page, targets] of linkTargets) {
      const inherited = Math.max(0, ...targets.map((t) => (pageRisk.get(t) ?? 0) * LINK_DECAY));
      pageRisk.set(page, Math.max(pageRisk.get(page) ?? 0, inherited));
    }
  }

  // Graph statistics: how often each click edge has already been taken.
  const taken = new Map<string, number>();
  for (const e of graph.edges.values()) {
    if (e.kind === "Click") taken.set(e.action.replace(/^Click:/, ""), e.count);
  }

  const weights: Record<string, WeightEntry> = {};
  for (const it of items) {
    let risk: number;
    const reasons: string[] = [];
    let judgment: Judgment | undefined;
    if (it.slice.link) {
      if (!it.slice.link.exists) {
        risk = 1;
        reasons.push(`link target ${it.slice.link.target} does not exist (checked in code)`);
      } else {
        const dest = pageRisk.get(it.slice.link.target);
        risk = dest ?? 0.2;
        reasons.push(
          dest === undefined
            ? `destination ${it.slice.link.target} unknown; exploration prior`
            : `destination ${it.slice.link.target} risk ${dest.toFixed(2)}`,
        );
      }
    } else {
      const j = judged.get(it.key)!;
      risk = j.risk;
      judgment = j.judgment;
      reasons.push(...j.reasons);
    }
    const count = taken.get(it.key) ?? 0;
    if (count === 0) {
      risk = clamp01(risk + 0.15);
      reasons.push("never taken: +0.15 novelty");
    }
    weights[it.key] = {
      weight: FLOOR + Math.round(SCALE * risk),
      risk,
      page: it.page,
      control: `${it.fields.path ?? it.fields.tag}${it.fields.id ? "#" + it.fields.id : ""} ${it.fields.text ?? it.fields.href ?? it.fields.placeholder ?? ""}`.trim(),
      reasons,
      ...(judgment ? { judgment } : {}),
    };
  }
  return { generatedAt: new Date().toISOString(), floor: FLOOR, scale: SCALE, weights };
}

export async function writeWeights(path: string, table: WeightTable): Promise<void> {
  await writeFile(path, JSON.stringify(table, null, 2) + "\n");
}

export function keyFor(page: string, f: ControlFields): string {
  return controlKey(page, f);
}
