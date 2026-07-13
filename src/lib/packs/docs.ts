import { parseDoc, type LangDoc } from "./doc.ts";

export type { LangDoc } from "./doc.ts";

// Loads every langs/<id>/*.md at build time, so a contributor adds a document by
// dropping a markdown file in their language's folder — no registration, no index.
//
// ponytail: the .check.ts scripts import this (via index.ts) under plain node,
// where import.meta.glob doesn't exist and throws. Caught → no docs, packs still
// work. Docs are a build-time asset; nothing at runtime should depend on them.
let files: Record<string, string> = {};
try {
  files = import.meta.glob("./langs/*/*.md", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >;
} catch {
  files = {};
}

// README is the language's index page and leads; the rest sort by filename, so
// prefix with 01-, 02- … if a language's docs need a reading order.
const DOCS: LangDoc[] = Object.entries(files)
  .map(([path, raw]) => parseDoc(path, raw))
  .sort((a, b) => (a.slug === "README" ? -1 : b.slug === "README" ? 1 : a.slug.localeCompare(b.slug)));

/** Every markdown document shipped with a language, index first. */
export function packDocs(id: string): LangDoc[] {
  return DOCS.filter((d) => d.lang === id);
}

/**
 * The docs a language marked `prompt: true` — extra tutor instructions the pack's
 * three-line promptHint had no room for. Merged into the pack by packs/index.ts.
 * Keep them short: this text rides along on every model call.
 */
export function promptDocs(id: string): LangDoc[] {
  return packDocs(id).filter((d) => d.prompt);
}
