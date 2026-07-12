import { validatePack, PACK_FORMAT_VERSION, type LanguagePack, type ValidationResult } from "./schema.ts";

// Pack registry — the trust/provenance layer over raw packs. Every pack the app
// knows about carries an origin:
//   official  — bundled and maintained in-tree (verified)
//   community — merged community contribution, ships in-tree (verified)
//   imported  — pasted in by the user at runtime, NOT reviewed (unverified)
// The UI labels unverified packs so a learner knows a pasted pack hasn't been
// through review. "Verified" here means "went through the CONTRIBUTING.md flow",
// not any cryptographic guarantee.

export type PackOrigin = "official" | "community" | "imported";

export interface RegisteredPack {
  pack: LanguagePack;
  origin: PackOrigin;
  verified: boolean; // official + community are verified; imported is not
}

export function originLabel(o: PackOrigin): string {
  return o === "official" ? "Official" : o === "community" ? "Community" : "Unverified";
}

export interface CompatibilityReport {
  compatible: boolean;
  packVersion: unknown;
  appVersion: number;
  validation: ValidationResult;
  warnings: string[];
}

// Known fields as of format v1 — anything else is surfaced as a forward-compat
// warning rather than a hard error, so a v1 app still loads a slightly-newer pack.
const KNOWN_FIELDS = new Set([
  "formatVersion",
  "id",
  "name",
  "nativeName",
  "emoji",
  "direction",
  "writingSystem",
  "pronunciation",
  "grammar",
  "promptHint",
  "speech",
]);

/** Schema-compatibility check for an incoming pack (registry gate before merge/import). */
export function checkCompatibility(raw: unknown): CompatibilityReport {
  const validation = validatePack(raw);
  const o = (raw ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];

  const packVersion = o.formatVersion;
  if (typeof packVersion === "number" && packVersion > PACK_FORMAT_VERSION)
    warnings.push(
      `Pack targets format v${packVersion}; this app supports v${PACK_FORMAT_VERSION}. Newer fields will be ignored.`,
    );
  for (const k of Object.keys(o)) if (!KNOWN_FIELDS.has(k)) warnings.push(`Unknown field "${k}" ignored.`);

  return {
    compatible: validation.ok,
    packVersion,
    appVersion: PACK_FORMAT_VERSION,
    validation,
    warnings,
  };
}
