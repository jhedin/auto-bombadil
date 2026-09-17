/**
 * Stable identity for a clickable control, shared by the Bombadil
 * specification (runs inside Bombadil's JS runtime) and the Node tooling
 * (reads Bombadil's trace). Keep this file dependency-free.
 */
export type ControlFields = {
  tag: string;
  id: string | null;
  href: string | null;
  text: string | null;
  testId?: string | null;
  name?: string | null;
};

export function pathnameOf(url: string): string {
  const m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)/i.exec(url);
  const path = m ? m[1]! : url;
  return path.endsWith("/") ? path + "index.html" : path;
}

export function controlKey(page: string, f: ControlFields): string {
  const text = (f.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return [
    page,
    f.tag,
    f.testId ?? "",
    f.id ?? "",
    f.name ?? "",
    f.href ?? "",
    text,
  ].join("|");
}
