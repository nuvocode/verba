import { type LanguagePack } from "./schema.ts";
import { BUNDLED_PACKS } from "./bundled.ts";
import { COMMUNITY_PACKS } from "./community.ts";
import { checkCompatibility, type PackOrigin, type RegisteredPack } from "./registry.ts";
import { promptDocs } from "./docs.ts";

export type { LanguagePack } from "./schema.ts";
export { validatePack, PACK_FORMAT_VERSION } from "./schema.ts";
export { checkCompatibility, originLabel, type PackOrigin, type RegisteredPack } from "./registry.ts";
export { packDocs, type LangDoc } from "./docs.ts";

// ponytail: imported packs live in localStorage (paste-JSON in Settings), so
// "loadable" works with zero new deps. Add @tauri-apps/plugin-fs + a file
// picker when packs should load straight off disk.
const KEY = "verba.packs";

function imported(): LanguagePack[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Every known pack with its provenance. Later origins override earlier ones by
 * id, so a user's imported pack shadows a bundled one of the same id.
 */
export function registry(): RegisteredPack[] {
  const byId = new Map<string, RegisteredPack>();
  const add = (packs: LanguagePack[], origin: PackOrigin) => {
    for (const pack of packs) byId.set(pack.id, { pack, origin, verified: origin !== "imported" });
  };
  add(BUNDLED_PACKS, "official");
  add(COMMUNITY_PACKS, "community");
  add(imported(), "imported");
  // The order learners see, everywhere. Anything not listed (an imported pack) trails it.
  const ORDER = ["en", "es", "fr", "de", "it", "pt", "ja", "tr"];
  const rank = (id: string) => (ORDER.indexOf(id) + 1 || ORDER.length + 1) - 1;
  return [...byId.values()].sort((a, b) => rank(a.pack.id) - rank(b.pack.id));
}

/** Bundled + community + imported packs, deduped by id. */
export function listPacks(): LanguagePack[] {
  return registry().map((r) => r.pack);
}

/**
 * The pack as the prompts see it: the literal, plus any of its markdown docs
 * marked `prompt: true` appended to promptHint. Docs are the only place a
 * language's guidance can grow past three bullet points, and this is the single
 * seam where they reach the model — every prompt builder already goes through
 * getPack() → packGuidance(pack) → promptHint.
 */
export function getPack(id: string): LanguagePack | undefined {
  const entry = registry().find((r) => r.pack.id === id);
  if (!entry) return undefined;
  // An imported pack is the user's own: it shadows the in-tree pack, so it must
  // shadow the in-tree docs too rather than silently inherit their instructions.
  const docs = entry.origin === "imported" ? [] : promptDocs(id);
  if (!docs.length) return entry.pack;
  return { ...entry.pack, promptHint: [entry.pack.promptHint, ...docs.map((d) => d.body)].join("\n\n") };
}

export function packOrigin(id: string): PackOrigin | undefined {
  return registry().find((r) => r.pack.id === id)?.origin;
}

/** Parse + validate a pasted/loaded pack JSON and persist it. Throws on invalid. */
export function importPack(jsonText: string): LanguagePack {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`Not valid JSON: ${e?.message ?? e}`);
  }
  const report = checkCompatibility(raw);
  // One error per line so the import UI can list them clearly (not a silent failure).
  if (!report.compatible) throw new Error("• " + report.validation.errors.join("\n• "));
  const pack = report.validation.pack!;
  const next = imported().filter((p) => p.id !== pack.id);
  next.push(pack);
  localStorage.setItem(KEY, JSON.stringify(next));
  return pack;
}

export function removeImportedPack(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(imported().filter((p) => p.id !== id)));
}
