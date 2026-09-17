/**
 * A click generator whose branch weights come from a table produced by the
 * Node tooling in ../src (Jev's judgments plus graph statistics). Controls
 * missing from the table get `floor`, so exploration never dies.
 */
import { branch, leaf, type Tree } from "@antithesishq/bombadil/actions";
import {
  actions,
  extract,
  getFingerprint,
  type ActionTemplate,
  type Fingerprint,
} from "@antithesishq/bombadil/browser";
import {
  clickablePoint,
  inViewport,
  isVisible,
  queryAll,
} from "@antithesishq/bombadil/browser/dom";
import { controlKey, pathnameOf } from "./key.ts";

export type WeightTable = {
  floor: number;
  weights: Record<string, { weight: number }>;
};

type Target = {
  key: string;
  fingerprint: Fingerprint;
  point: { x: number; y: number };
  /** Extra context for the tooling; not part of the key. */
  classes: string[];
  html: string;
};

/** `tag.class.class`, used in the control key so that class-only controls
 * (like `.toggle` vs `.toggle-all`) stay distinct. The tooling recovers this
 * key from the trace by matching the click point against this snapshot. */
function classPath(el: Element): string | null {
  const classes = [...el.classList].filter(Boolean).sort();
  return classes.length ? `${el.tagName.toLowerCase()}.${classes.join(".")}` : null;
}

export const clickTargets = extract((state): Target[] => {
  if (!state.document.body) return [];
  const page = pathnameOf(state.window.location.toString());
  const current = new URL(state.window.location.toString());
  const out: Target[] = [];
  const seen = new Set<Element>();

  const push = (el: Element) => {
    if (seen.has(el)) return;
    const point = clickablePoint(el);
    if (!point || !inViewport(state.window, point)) return;
    const fingerprint: Fingerprint = getFingerprint(el);
    out.push({
      key: controlKey(page, {
        tag: fingerprint.tag,
        id: fingerprint.id,
        href: fingerprint.href,
        text: fingerprint.textContent,
        testId: fingerprint.testId,
        name: fingerprint.nameAttr,
        placeholder: fingerprint.placeholder,
        inputType: fingerprint.inputType,
        path: classPath(el) ?? fingerprint.structuralPath,
      }),
      fingerprint,
      point,
      classes: [...el.classList],
      html: el.outerHTML.slice(0, 300),
    });
    seen.add(el);
  };

  for (const a of queryAll(state.document.body, "a[href]")) {
    if (!(a instanceof HTMLAnchorElement)) continue;
    let url: URL;
    try {
      url = new URL(a.href);
    } catch {
      continue;
    }
    if (a.target === "_blank") continue;
    if (!url.protocol.startsWith("http")) continue;
    if (url.host !== current.host) continue;
    if (!isVisible(state.window, a)) continue;
    push(a);
  }

  const controls = queryAll(
    state.document.body,
    "button:not(:disabled),input:not(:disabled),textarea:not(:disabled)",
  );
  for (const el of controls) {
    if (el instanceof HTMLInputElement && el.type === "file") continue;
    if (!(el instanceof HTMLInputElement) && !isVisible(state.window, el)) {
      continue;
    }
    if (
      el === state.document.activeElement &&
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.value
    ) {
      continue;
    }
    push(el);
  }
  return out;

}).named("clickTargets");

export function weightedClicks(table: WeightTable) {
  return actions((): Tree<ActionTemplate> => {
    const branches: [number, Tree<ActionTemplate>][] = [];
    for (const t of clickTargets.current) {
      const w = table.weights[t.key]?.weight ?? table.floor;
      branches.push([
        Math.max(0, Math.min(65535, Math.round(w))),
        leaf({ Click: { fingerprint: t.fingerprint, point: t.point } }),
      ]);
    }
    return branch(branches);
  });
}
