import { type LanguagePack } from "./schema.ts";
import { pack as id } from "./langs/id/pack.ts";
import { pack as it } from "./langs/it/pack.ts";
import { pack as pt } from "./langs/pt/pack.ts";

// Community-contributed packs that have passed review (see CONTRIBUTING.md) and
// been merged into the repo. They ship with the app but are tagged origin
// "community" by the registry so the UI can still surface who authored them.
// Adding one is a pull request that drops a langs/<id>/ folder and a line here.
export const COMMUNITY_PACKS: LanguagePack[] = [id, it, pt];
