/**
 * Map a control on a page to the source behind it. The "codebase" is the
 * page's markup plus every script it loads, inline or external. Small apps
 * get all of it; larger ones get windows around lines that mention the
 * control's id, classes, placeholder, text, or route. Deterministic facts,
 * like whether a link target exists, are computed here in code rather than
 * asked of the model.
 */
import { access, readFile } from "node:fs/promises";
import { dirname, join, normalize, posix } from "node:path";
import type { ControlInfo } from "./trace.ts";

export type CodeSlice = {
  page: string;
  file: string;
  element: string;
  /** Source excerpts, one per script file, in load order. */
  code: { file: string; excerpt: string }[];
  /** For links to other pages: the target and whether that file exists. */
  link: { target: string; exists: boolean } | null;
};

const WHOLE_FILE_LIMIT = 6_000;
const EXCERPT_LIMIT = 9_000;
const WINDOW = 20;

function fileFor(root: string, page: string): string {
  let p = page;
  if (p.endsWith("/")) p += "index.html";
  return normalize(join(root, p));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findElement(html: string, f: ControlInfo): string {
  if (f.html) return f.html;
  const tag = f.tag;
  const candidates: RegExp[] = [];
  if (f.id) candidates.push(new RegExp(`<${tag}\\b[^>]*\\bid=["']${escapeRegExp(f.id)}["'][^>]*>(?:[\\s\\S]*?</${tag}>)?`, "i"));
  if (f.href) candidates.push(new RegExp(`<${tag}\\b[^>]*\\bhref=["']${escapeRegExp(f.href)}["'][^>]*>(?:[\\s\\S]*?</${tag}>)?`, "i"));
  if (f.text) candidates.push(new RegExp(`<${tag}\\b[^>]*>\\s*${escapeRegExp(f.text)}\\s*</${tag}>`, "i"));
  candidates.push(new RegExp(`<${tag}\\b[^>]*>(?:[\\s\\S]*?</${tag}>)?`, "i"));
  for (const re of candidates) {
    const m = re.exec(html);
    if (m) return m[0].slice(0, 1000);
  }
  return `<${tag}>`;
}

/** kebab-case or snake_case to camelCase and PascalCase, so a class like
 * `toggle-all` also finds `toggleAll` and `ToggleAll` in scripts. */
function caseVariants(word: string): string[] {
  const parts = word.split(/[-_]+/).filter(Boolean);
  if (parts.length < 2) return [word];
  const camel = parts[0]! + parts.slice(1).map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  return [word, camel, camel[0]!.toUpperCase() + camel.slice(1)];
}

/** Words that identify this control in source code. */
function tokensFor(f: ControlInfo): string[] {
  const tokens = new Set<string>();
  if (f.id) for (const v of caseVariants(f.id)) tokens.add(v);
  for (const c of f.classes) for (const v of caseVariants(c)) tokens.add(v);
  if (f.placeholder) tokens.add(f.placeholder);
  if (f.text) tokens.add(f.text.trim());
  if (f.href) {
    const route = f.href.replace(/^#\/?/, "").replace(/\/$/, "");
    if (route) tokens.add(route);
    tokens.add(f.href);
  }
  if (f.name) tokens.add(f.name);
  return [...tokens].filter((t) => t.length >= 3);
}

function excerpt(source: string, tokens: string[]): string | null {
  if (source.length <= WHOLE_FILE_LIMIT) return source;
  const lines = source.split("\n");
  const hits = new Set<number>();
  lines.forEach((line, i) => {
    if (tokens.some((t) => line.includes(t))) {
      for (let k = Math.max(0, i - WINDOW); k <= Math.min(lines.length - 1, i + WINDOW); k++) hits.add(k);
    }
  });
  if (hits.size === 0) return null;
  const sorted = [...hits].sort((a, b) => a - b);
  const out: string[] = [];
  let previous = -2;
  for (const i of sorted) {
    if (i !== previous + 1) out.push(`// ... line ${i + 1}`);
    out.push(lines[i]!);
    previous = i;
  }
  return out.join("\n").slice(0, EXCERPT_LIMIT);
}

async function scriptsOf(root: string, page: string, html: string): Promise<{ file: string; source: string }[]> {
  const out: { file: string; source: string }[] = [];
  const pageDir = dirname(page);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc=["']([^"']+)["']/i.exec(m[1]!)?.[1];
    if (src) {
      if (/^[a-z]+:/i.test(src)) continue;
      const target = posix.normalize(posix.join(pageDir, src));
      try {
        out.push({ file: target, source: await readFile(fileFor(root, target), "utf8") });
      } catch {
        // Missing external script: nothing to read.
      }
    } else if (m[2]!.trim()) {
      out.push({ file: `${page} (inline)`, source: m[2]!.trim() });
    }
  }
  return out;
}

export async function sliceFor(root: string, page: string, f: ControlInfo): Promise<CodeSlice> {
  const file = fileFor(root, page);
  const html = await readFile(file, "utf8");
  const tokens = tokensFor(f);
  const code: CodeSlice["code"] = [];
  for (const s of await scriptsOf(root, page, html)) {
    const e = excerpt(s.source, tokens);
    if (e !== null) code.push({ file: s.file, excerpt: e });
  }
  let link: CodeSlice["link"] = null;
  if (f.tag === "a" && f.href && !f.href.startsWith("#")) {
    const target = posix.normalize(posix.join(dirname(page), f.href));
    let exists = false;
    try {
      await access(fileFor(root, target));
      exists = true;
    } catch {
      exists = false;
    }
    link = { target, exists };
  }
  return { page, file, element: findElement(html, f), code, link };
}
