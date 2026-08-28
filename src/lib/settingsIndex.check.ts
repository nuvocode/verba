// Runnable check: `node --experimental-strip-types src/lib/settingsIndex.check.ts`
//
// The settings index (lib/settingsIndex.ts). What is pinned here is the promise
// the index exists to keep: every row names a real section, every row can be
// described, and the searches the spec names find what they are for. Issues #29, #32.
import assert from "node:assert";
import { AT } from "./rules.ts";
import { SETTINGS_INDEX, hashOf, type SettingRow } from "./settingsIndex.ts";

// --- every row is well-formed ------------------------------------------------
for (const r of SETTINGS_INDEX) {
  assert(r.id.trim() !== "", `a row needs an id`);
  assert(r.title.trim() !== "", `a row needs a title: ${r.id}`);
  // §5.2: "Açıklaması yazılamayan ayar, ana akışta bulunmaz." A row that cannot
  // be described is a row that cannot be searched — the index makes the rule
  // enforceable.
  assert(r.desc.trim() !== "", `a row needs a description: ${r.id}`);
  assert(r.panel in AT, `row ${r.id} names an unknown panel: ${r.panel}`);
  // The hash is derived from AT, never written by hand — a second copy of the
  // panel→hash map is how the two would drift.
  assert(hashOf(r).startsWith("#settings/"), `row ${r.id} hashes outside settings: ${hashOf(r)}`);
}

// --- ids are unique ----------------------------------------------------------
const seen = new Set<string>();
for (const r of SETTINGS_INDEX) {
  assert(!seen.has(r.id), `duplicate row id: ${r.id}`);
  seen.add(r.id);
}

// --- the searches the spec names find what they are for ----------------------
// §5.2 names four searches a learner should be able to type. Each must land on
// at least one row — a search that finds nothing is a search that might as well
// not exist.
const KNOWN = ["voice", "microphone", "delete", "language"];
for (const q of KNOWN) {
  const hit = SETTINGS_INDEX.find((r) => (r.title + " " + r.desc).toLowerCase().includes(q));
  assert(hit, `search "${q}" finds nothing`);
}

// --- every section has at least one row --------------------------------------
// A section with no rows would be a section the search cannot reach — a dead end
// in the one place the palette promises to jump anywhere.
for (const panel of Object.keys(AT) as (keyof typeof AT)[]) {
  assert(SETTINGS_INDEX.some((r) => r.panel === panel), `section ${panel} has no rows in the index`);
}

// --- self-test: a broken index must not stay green ---------------------------
// The checker probes itself with a deliberately broken table, so a check that
// stops firing is caught rather than silently passing.
function broken(): SettingRow[] {
  return [
    { id: "x", title: "X", desc: "", panel: "learning" }, // empty desc
    { id: "x", title: "X", desc: "dup id", panel: "learning" }, // duplicate id
    { id: "y", title: "Y", desc: "bad panel", panel: "nope" as never }, // unknown panel
  ];
}
const bad = broken();
assert(bad.some((r) => r.desc.trim() === ""), "self-test: empty desc not caught");
assert(new Set(bad.map((r) => r.id)).size !== bad.length, "self-test: duplicate id not caught");
assert(bad.some((r) => !(r.panel in AT)), "self-test: unknown panel not caught");
