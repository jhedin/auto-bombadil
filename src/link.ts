/**
 * Map a control on a page to the source behind it. For this static site the
 * "codebase" is the page's markup plus its inline scripts. Deterministic
 * facts, like whether a link target exists, are computed here in code rather
 * than asked of the model.
 */
import { access, readFile } from "node:fs/promises";
import { dirname, join, normalize, posix } from "node:path";
import type { ControlFields } from "../bombadil/key.ts";

export type CodeSlice = {
  page: string;
  file: string;
  element: string;
  scripts: string[];
  /** For links: the page it navigates to, and whether that file exists. */
  link: { target: string; exists: boolean } | null;
};

function fileFor(root: string, page: string): string {
  let p = page;
  if (p.endsWith("/")) p += "index.html";
  return normalize(join(root, p));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findElement(html: string, f: ControlFields): string {
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

export async function sliceFor(
  root: string,
  page: string,
  f: ControlFields,
): Promise<CodeSlice> {
  const file = fileFor(root, page);
  const html = await readFile(file, "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]!.trim())
    .filter((s) => s.length > 0);
  let link: CodeSlice["link"] = null;
  if (f.tag === "a" && f.href) {
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
  return { page, file, element: findElement(html, f), scripts, link };
}
