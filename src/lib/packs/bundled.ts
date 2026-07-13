import { type LanguagePack } from "./schema.ts";
import { pack as en } from "./langs/en/pack.ts";
import { pack as es } from "./langs/es/pack.ts";
import { pack as fr } from "./langs/fr/pack.ts";
import { pack as de } from "./langs/de/pack.ts";
import { pack as ja } from "./langs/ja/pack.ts";

// Official packs, maintained by the core team. One folder per language under
// langs/ — its pack.ts is the literal, its *.md files are the language's docs
// (see docs.ts). Adding an official language = a new folder + a line here.
// ponytail: explicit imports, not import.meta.glob — the .check.ts scripts load
// this file under plain node, where glob doesn't exist.
export const BUNDLED_PACKS: LanguagePack[] = [en, es, fr, de, ja];
