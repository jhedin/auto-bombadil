/**
 * Discover controls from an app's static HTML, so the first weight table can
 * be built with no Bombadil run at all. Keys are computed exactly as the
 * policy computes them in the browser; controls that only appear after
 * interaction (rendered list items, dialogs) are picked up from the trace of
 * the first weighted run and merged in on the next `weights`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { controlKey } from "../bombadil/key.ts";
import type { ControlInfo } from "./trace.ts";

async function htmlFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...(await htmlFiles(root, full)));
    } else if (entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

function attr(tagSource: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tagSource);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

const CONTROL = /<(a|button|input|textarea)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi;

export async function discoverControls(root: string): Promise<Map<string, { page: string; control: ControlInfo }>> {
  const found = new Map<string, { page: string; control: ControlInfo }>();
  for (const file of await htmlFiles(root)) {
    const page = "/" + relative(root, file).split("\\").join("/");
    const html = await readFile(file, "utf8");
    for (const m of html.matchAll(CONTROL)) {
      const tag = m[1]!.toLowerCase();
      const attrs = m[2]!;
      if (tag === "a" && !attr(attrs, "href")) continue;
      if (/\sdisabled\b/i.test(attrs)) continue;
      const href = tag === "a" ? attr(attrs, "href") : null;
      if (href && /^[a-z]+:/i.test(href) && !href.startsWith("http")) continue;
      if (href && /^https?:/i.test(href)) continue; // other origins are out of bounds
      const inputType = tag === "input" ? (attr(attrs, "type") ?? "text") : null;
      if (inputType === "file" || inputType === "hidden") continue;
      const classes = (attr(attrs, "class") ?? "").split(/\s+/).filter(Boolean);
      const rawText = stripTags(m[3] ?? "");
      const text = rawText.length > 0 && rawText.length <= 200 ? rawText : null;
      const fields: ControlInfo = {
        tag,
        id: attr(attrs, "id"),
        href,
        text,
        testId: attr(attrs, "data-testid") ?? attr(attrs, "data-test-id") ?? attr(attrs, "data-cy") ?? attr(attrs, "data-test"),
        name: attr(attrs, "name"),
        placeholder: attr(attrs, "placeholder"),
        inputType: tag === "input" ? attr(attrs, "type") : null,
        path: classes.length ? `${tag}.${[...classes].sort().join(".")}` : null,
        classes,
        html: m[0].slice(0, 300),
      };
      const key = controlKey(page, fields);
      if (!found.has(key)) found.set(key, { page, control: fields });
    }
  }
  return found;
}
