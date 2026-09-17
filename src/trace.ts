/**
 * Read a Bombadil trace and turn it into a graph: pages as nodes, actions as
 * edges, with visit counts and the violations each edge led to.
 */
import { readFile } from "node:fs/promises";
import { controlKey, pathnameOf, type ControlFields } from "../bombadil/key.ts";

/** Fingerprint as Bombadil's Rust side serializes it (snake_case). */
type RustFingerprint = {
  tag: string;
  test_id?: string | null;
  id?: string | null;
  href?: string | null;
  name_attr?: string | null;
  text_content?: string | null;
};
/** Fingerprint as the in-browser TypeScript produces it (camelCase). */
type JsFingerprint = {
  tag: string;
  testId?: string | null;
  id?: string | null;
  href?: string | null;
  nameAttr?: string | null;
  textContent?: string | null;
};

export function fieldsOf(f: RustFingerprint & JsFingerprint): ControlFields {
  return {
    tag: f.tag,
    id: f.id ?? null,
    href: f.href ?? null,
    text: f.text_content ?? f.textContent ?? null,
    testId: f.test_id ?? f.testId ?? null,
    name: f.name_attr ?? f.nameAttr ?? null,
  };
}

export type TraceEntry = {
  timestamp: number;
  action: unknown;
  state: { url: string; hash_current: number | null };
  snapshots: { name: string | null; value: unknown }[];
  violations: { name?: string; property?: string }[];
};

export type Edge = {
  from: string;
  action: string;
  kind: string;
  count: number;
  to: Map<string, number>;
  violations: Map<string, number>;
};

export type Node = {
  page: string;
  visits: number;
  hashes: Set<number>;
  violations: Map<string, number>;
  /** Controls seen on this page, keyed by controlKey. */
  controls: Map<string, ControlFields>;
};

export type Graph = {
  nodes: Map<string, Node>;
  edges: Map<string, Edge>;
  entries: number;
  durationMicros: number;
};

export async function readTrace(path: string): Promise<TraceEntry[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TraceEntry);
}

function describeAction(
  page: string,
  action: unknown,
): { key: string; kind: string } {
  if (typeof action === "string") return { key: action, kind: action };
  if (action && typeof action === "object") {
    const [kind, payload] = Object.entries(action)[0]!;
    const fp = (payload as { fingerprint?: RustFingerprint & JsFingerprint })
      ?.fingerprint;
    if ((kind === "Click" || kind === "DoubleClick") && fp) {
      return { key: `${kind}:${controlKey(page, fieldsOf(fp))}`, kind };
    }
    return { key: kind, kind };
  }
  return { key: "none", kind: "none" };
}

function violationName(v: { name?: string; property?: string }): string {
  return v.name ?? v.property ?? JSON.stringify(v);
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function buildGraph(entries: TraceEntry[]): Graph {
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const node = (page: string): Node => {
    let n = nodes.get(page);
    if (!n) {
      n = {
        page,
        visits: 0,
        hashes: new Set(),
        violations: new Map(),
        controls: new Map(),
      };
      nodes.set(page, n);
    }
    return n;
  };

  let previous: TraceEntry | null = null;
  for (const entry of entries) {
    const page = pathnameOf(entry.state.url);
    const n = node(page);
    n.visits++;
    if (entry.state.hash_current !== null) n.hashes.add(entry.state.hash_current);
    for (const v of entry.violations ?? []) bump(n.violations, violationName(v));

    for (const s of entry.snapshots ?? []) {
      if (s.name !== "clickTargets" && s.name !== "clickablePoints") continue;
      for (const t of (s.value as { fingerprint: RustFingerprint & JsFingerprint }[]) ?? []) {
        const fields = fieldsOf(t.fingerprint);
        n.controls.set(controlKey(page, fields), fields);
      }
    }

    if (previous && entry.action !== null) {
      const from = pathnameOf(previous.state.url);
      const { key, kind } = describeAction(from, entry.action);
      const id = `${from} ${key}`;
      let e = edges.get(id);
      if (!e) {
        e = { from, action: key, kind, count: 0, to: new Map(), violations: new Map() };
        edges.set(id, e);
      }
      e.count++;
      bump(e.to, page);
      for (const v of entry.violations ?? []) bump(e.violations, violationName(v));
    }
    previous = entry;
  }

  const first = entries[0]?.timestamp ?? 0;
  const last = entries[entries.length - 1]?.timestamp ?? first;
  return { nodes, edges, entries: entries.length, durationMicros: last - first };
}

export function summarize(g: Graph): string {
  const lines: string[] = [];
  lines.push(
    `${g.entries} states over ${(g.durationMicros / 1e6).toFixed(1)}s, ${g.nodes.size} pages, ${g.edges.size} distinct edges`,
  );
  for (const n of [...g.nodes.values()].sort((a, b) => b.visits - a.visits)) {
    const viol = [...n.violations].map(([k, c]) => `${k}×${c}`).join(", ");
    lines.push(
      `  ${n.page}  visits=${n.visits} dom-hashes=${n.hashes.size} controls=${n.controls.size}${viol ? `  VIOLATIONS: ${viol}` : ""}`,
    );
  }
  const hot = [...g.edges.values()]
    .filter((e) => e.violations.size > 0)
    .sort((a, b) => b.count - a.count);
  for (const e of hot) {
    lines.push(`  edge ${e.from} --${e.action}--> ${[...e.to.keys()].join("|")}  led to ${[...e.violations.keys()].join(", ")}`);
  }
  return lines.join("\n");
}
