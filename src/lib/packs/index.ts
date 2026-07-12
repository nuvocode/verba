import { type LanguagePack } from "./schema";
import { BUNDLED_PACKS } from "./bundled";
import { COMMUNITY_PACKS } from "./community";
import { checkCompatibility, type PackOrigin, type RegisteredPack } from "./registry";

export type { LanguagePack } from "./schema";
export { validatePack, PACK_FORMAT_VERSION } from "./schema";
export { checkCompatibility, originLabel, type PackOrigin, type RegisteredPack } from "./registry";

// ponytail: imported packs live in localStorage (paste-JSON in Settings), so
// "loadable" works with zero new deps. Add @tauri-apps/plugin-fs + a file
// picker when packs should load straight off disk.
const KEY = "speaksy.packs";

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
  return [...byId.values()];
}

/** Bundled + community + imported packs, deduped by id. */
export function listPacks(): LanguagePack[] {
  return registry().map((r) => r.pack);
}

export function getPack(id: string): LanguagePack | undefined {
  return registry().find((r) => r.pack.id === id)?.pack;
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
