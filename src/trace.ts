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
  placeholder?: string | null;
  input_type?: string | null;
  structural_path?: string | null;
};
/** Fingerprint as the in-browser TypeScript produces it (camelCase). */
type JsFingerprint = {
  tag: string;
  testId?: string | null;
  id?: string | null;
  href?: string | null;
  nameAttr?: string | null;
  textContent?: string | null;
  placeholder?: string | null;
  inputType?: string | null;
  structuralPath?: string | null;
};

export function fieldsOf(f: RustFingerprint & JsFingerprint): ControlFields {
  return {
    tag: f.tag,
    id: f.id ?? null,
    href: f.href ?? null,
    text: f.text_content ?? f.textContent ?? null,
    testId: f.test_id ?? f.testId ?? null,
    name: f.name_attr ?? f.nameAttr ?? null,
    placeholder: f.placeholder ?? null,
    inputType: f.input_type ?? f.inputType ?? null,
    path: f.structural_path ?? f.structuralPath ?? null,
  };
}

/** What the spec's extractor recorded about a control beyond its identity. */
export type ControlInfo = ControlFields & { classes: string[]; html: string };

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
  controls: Map<string, ControlInfo>;
};

export type Graph = {
  nodes: Map<string, Node>;
  edges: Map<string, Edge>;
  entries: number;
  durationMicros: number;
};

export async function readTrace(path: string): Promise<TraceEntry[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TraceEntry);
}

type Point = { x: number; y: number };
type Target = { key: string; point: Point };

/** The click targets the spec extracted in a state, if it used our policy. */
function targetsIn(entry: TraceEntry): Target[] {
  const s = entry.snapshots?.find((s) => s.name === "clickTargets");
  return (s?.value as Target[] | undefined) ?? [];
}

function describeAction(
  page: string,
  action: unknown,
  previous: TraceEntry,
): { key: string; kind: string } {
  if (typeof action === "string") return { key: action, kind: action };
  if (action && typeof action === "object") {
    const [kind, payload] = Object.entries(action)[0]!;
    const p = payload as { fingerprint?: RustFingerprint & JsFingerprint; point?: Point };
    if ((kind === "Click" || kind === "DoubleClick") && p.fingerprint) {
      // Prefer the key our extractor computed for the element at that point.
      const hit = p.point
        ? targetsIn(previous).find(
            (t) => Math.abs(t.point.x - p.point!.x) < 0.01 && Math.abs(t.point.y - p.point!.y) < 0.01,
          )
        : undefined;
      const key = hit?.key ?? controlKey(page, fieldsOf(p.fingerprint));
      return { key: `${kind}:${key}`, kind };
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

    // Prefer our policy's snapshot (it carries the key with the class path);
    // fall back to Bombadil's default click extractor for other specs.
    const snaps = entry.snapshots ?? [];
    const ours = snaps.find((s) => s.name === "clickTargets");
    const source = ours ?? snaps.find((s) => s.name === "clickablePoints");
    type Seen = { key?: string; fingerprint: RustFingerprint & JsFingerprint; classes?: string[]; html?: string };
    for (const t of (source?.value as Seen[] | undefined) ?? []) {
      const fields = fieldsOf(t.fingerprint);
      if (t.key) fields.path = t.key.split("|").at(-1) || fields.path;
      n.controls.set(t.key ?? controlKey(page, fields), { ...fields, classes: t.classes ?? [], html: t.html ?? "" });
    }

    if (previous && entry.action !== null) {
      const from = pathnameOf(previous.state.url);
      const { key, kind } = describeAction(from, entry.action, previous);
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
