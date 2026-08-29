import type { PlacementQ } from "../placement.ts";
import { placement as es } from "./langs/es/placement.ts";

// The curated placement pools, one import line per language — the same shape as
// bundled.ts and community.ts, for the same reason: a language is a folder, and
// registering it is one line, not a scattered edit.
//
// A language with no entry here is not broken; its test is written by the model
// instead (lib/placement.ts). Adding a pool is how a language stops depending on
// whatever the local model produced this minute.
const POOLS: Record<string, PlacementQ[]> = { es };

/** The curated test for a pack, or null when that language has none yet. */
export function poolFor(packId: string): PlacementQ[] | null {
  const pool = POOLS[packId.trim()];
  return pool?.length ? pool : null;
}

/** Which languages have a curated pool — the check reads this. */
export const pooled = (): string[] => Object.keys(POOLS);
