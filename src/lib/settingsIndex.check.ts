// Runnable check: `node --experimental-strip-types src/lib/settingsIndex.check.ts`
//
// The settings index (lib/settingsIndex.ts). What is pinned here is the promise
// the index exists to keep: every row names a real section, every row can be
// described, the searches the spec names find what they are for, and every row
// has a `data-setting` anchor in the views. Issues #29, #32.
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname } from "node:path";
import { AT } from "./rules.ts";
import { SETTINGS_INDEX, hashOf, type SettingRow } from "./settingsIndex.ts";

// --- the real validator, extracted so the self-test can probe it --------------
// Every rule the index must hold lives here. The self-test below runs this same
// function against a deliberately broken table, so a rule that stops firing is
// caught rather than silently passing.
function faults(rows: SettingRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.id.trim() === "") out.push(`a row needs an id`);
    if (r.title.trim() === "") out.push(`a row needs a title: ${r.id}`);
    // §5.2: "Açıklaması yazılamayan ayar, ana akışta bulunmaz." A row that
    // cannot be described is a row that cannot be searched — the index makes
    // the rule enforceable.
    if (r.desc.trim() === "") out.push(`a row needs a description: ${r.id}`);
    if (!(r.panel in AT)) out.push(`row ${r.id} names an unknown panel: ${r.panel}`);
    // The hash is derived from AT, never written by hand — a second copy of the
    // panel→hash map is how the two would drift. Only checked for a panel AT
    // actually has, so a bad panel reports its own fault rather than crashing.
    else if (!hashOf(r).startsWith("#settings/")) out.push(`row ${r.id} hashes outside settings: ${hashOf(r)}`);
  }
  // ids are unique.
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) out.push(`duplicate row id: ${r.id}`);
    seen.add(r.id);
  }
  return out;
}

const realFaults = faults(SETTINGS_INDEX);
assert(realFaults.length === 0, "the index is broken:\n" + realFaults.join("\n"));

// --- the searches the spec names find what they are for ----------------------
// §5.2 names four searches a learner should be able to type. Each must land on
// at least one row — a search that finds nothing is a search that might as well
// not exist.
const KNOWN = ["voice", "microphone", "delete", "language", "forget", "pause"];
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

// --- every row has a data-setting anchor in the views -------------------------
// The index is metadata; the views are where a row actually lives. A row with no
// `data-setting` anchor cannot be highlighted, and an anchor with no row is a
// dead id — so the two sets must be equal. The scan is static, like lang.check's
// walk: it reads the source, not the rendered DOM.
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = `${dir}/${entry}`;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && (extname(p) === ".tsx" || extname(p) === ".ts")) out.push(p);
  }
  return out;
}

const anchored = new Set<string>();
for (const f of walk("src/views")) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/data-setting="([\w-]+)"/g)) anchored.add(m[1]);
}
const indexed = new Set(SETTINGS_INDEX.map((r) => r.id));
const missing = [...indexed].filter((id) => !anchored.has(id));
const orphan = [...anchored].filter((id) => !indexed.has(id));
assert(missing.length === 0, `rows with no data-setting anchor in the views: ${missing.join(", ")}`);
assert(orphan.length === 0, `data-setting anchors with no index row: ${orphan.join(", ")}`);

// --- self-test: a broken index must not stay green ---------------------------
// The checker probes itself with a deliberately broken table, running the *real*
// `faults` — if a rule stops firing, this probe fails.
function broken(): SettingRow[] {
  return [
    { id: "x", title: "X", desc: "", panel: "learning" }, // empty desc
    { id: "x", title: "X", desc: "dup id", panel: "learning" }, // duplicate id
    { id: "y", title: "Y", desc: "bad panel", panel: "nope" as never }, // unknown panel
  ];
}
assert.equal(faults(broken()).length, 3, "the validator must catch every fault in a broken table");
assert.equal(faults(SETTINGS_INDEX).length, 0, "the real table must be clean");

