// Run: node --experimental-strip-types src/lib/surfaces.check.ts
//
// The surface-state registry (lib/surfaces.ts). Pins the promises:
//  1. Every `{file, marker}` claim is a real file that carries the marker AND
//     actually renders the matching state component near that marker — a marker
//     on its own proves nothing, so the component has to be there too.
//  2. Every `pending` names a plan that actually exists in docs/plans/ — the
//     registry is a to-do list that cannot rot.
//  3. The plan in flight leaves exactly the pendings it is allowed to.
//     For PLAN-016 those are Read `unusable` (PLAN-022), Listen `unusable`
//     (PLAN-026) and Talk `unusable` (PLAN-020, the reflection parse).
//
// A non-generating surface (memory: a collection, not an output) carries an empty
// `states` object and is held to none of the above.
import assert from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SURFACES, type StateName } from "./surfaces.ts";

const ROOT = new URL("../../", import.meta.url);
const STATE_NAMES: StateName[] = ["loading", "empty", "error", "unusable"];

// The state component each state name must render, in the file its registry entry
// points at. If the marker lives in a file that never uses the component, the state
// is claimed but not built — which is exactly the lie this gate exists to catch.
const STATE_COMPONENT: Record<StateName, string> = {
  loading: "Generating",
  empty: "Nothing",
  error: "Failed",
  unusable: "Unusable",
};

// The only pendings a generating surface may carry at THIS plan's commit.
// Keyed "surfaceId:state" so the check can name an offender precisely.
const ALLOWED_GENERATING_PENDINGS: Record<string, string> = {
  "read:unusable": "PLAN-022",
  "listen:unusable": "PLAN-026",
};

// --- every row is well-formed -------------------------------------------------
for (const row of SURFACES) {
  assert(
    ["today", "talk", "read", "listen", "memory", "coach"].includes(row.id),
    `unknown surface id ${row.id}`,
  );
  if (!row.generates) {
    // A non-generating surface owes no states — an empty object is the honest form.
    assert.deepEqual(Object.keys(row.states), [], `non-generating surface ${row.id} must leave states empty`);
  } else {
    // The four names are the spec's four states, no more, no fewer.
    assert.deepEqual(
      Object.keys(row.states),
      STATE_NAMES,
      `generating surface ${row.id} must carry exactly the four state names`,
    );
  }
}

// --- every wired state is real: marker present AND component nearby --------------
// A `{file, marker}` entry promises that the file renders that state under that
// marker. A missing marker OR a file that never renders the matching state component
// is a registry that lied to itself. The component must appear near the marker (a
// window either side) so a marker pasted at the top of a file cannot claim a state
// its component renders halfway down.
const unverified: string[] = [];
for (const row of SURFACES) {
  if (!row.generates) continue;
  for (const state of STATE_NAMES) {
    const entry = row.states[state];
    if (!entry || "pending" in entry) continue;
    const abs = fileURLToPath(new URL(entry.file, ROOT));
    if (!existsSync(abs)) {
      unverified.push(`${row.id}/${state}: missing file ${entry.file}`);
      continue;
    }
    const src = readFileSync(abs, "utf8");
    if (!src.includes(entry.marker)) {
      unverified.push(`${row.id}/${state}: ${entry.file} is missing marker "${entry.marker}"`);
      continue;
    }
    // The component must sit near the marker — look a window either side of it. The
    // window is generous (comment blocks and props sit between marker and usage).
    const at = src.indexOf(entry.marker);
    const windowStart = Math.max(0, at - 600);
    const windowEnd = Math.min(src.length, at + 1600);
    const near = src.slice(windowStart, windowEnd);
    const component = STATE_COMPONENT[state];
    if (!new RegExp(`<${component}`).test(near)) {
      unverified.push(
        `${row.id}/${state}: ${entry.file} marks "${entry.marker}" but renders no <${component}> near it`,
      );
    }
  }
}
assert(unverified.length === 0, "surfaces.check: unverified targets:\n" + unverified.join("\n"));

// --- every pending names a plan that exists in docs/plans/ --------------------
// A pending is a to-do, but a to-do naming a plan that was never written is a
// promise that cannot rot — it must name a real docs/plans/*.md file. Files carry
// a slug ("PLAN-022-read-passage-contract.md"), so a pending "PLAN-022" must match
// a file whose id prefix is PLAN-022.
const planFiles = readdirSync(fileURLToPath(new URL("docs/plans/", ROOT))).filter((f) => f.endsWith(".md"));
const hasPlan = (id: string) => planFiles.some((f) => f === `${id}.md` || f.startsWith(`${id}-`));
for (const row of SURFACES) {
  if (!row.generates) continue;
  for (const state of STATE_NAMES) {
    const entry = row.states[state];
    if (entry && "pending" in entry) {
      assert(
        hasPlan(entry.pending),
        `surface ${row.id}/${state} names ${entry.pending}, which is not in docs/plans/`,
      );
    }
  }
}

// --- the pending allowance ----------------------------------------------------
// A generating surface owes four wired states. The only states it may leave for a
// later plan at this commit are the ones PLAN-016 names — everything else must be a
// real `{file, marker}` today. Every approved pending must also be present, so a
// surface that *could* be wired cannot hide behind a wall of "later".
{
  const foundPendings = new Set<string>();
  for (const row of SURFACES) {
    if (!row.generates) continue;
    for (const state of STATE_NAMES) {
      const entry = row.states[state];
      if (entry && "pending" in entry) foundPendings.add(`${row.id}:${state}`);
    }
  }
  const unexpected = [...foundPendings].filter((k) => !(k in ALLOWED_GENERATING_PENDINGS));
  assert(
    unexpected.length === 0,
    `surfaces.check: a generating surface leaves a state for a plan PLAN-016 did not approve:\n` +
      unexpected.map((k) => `  ${k}`).join("\n"),
  );
  const known = Object.keys(ALLOWED_GENERATING_PENDINGS);
  const missingKnown = known.filter((k) => !foundPendings.has(k));
  assert(
    missingKnown.length === 0,
    `surfaces.check: PLAN-016's approved pendings are not all listed:\n` +
      missingKnown.map((k) => `  ${k}`).join("\n"),
  );
}

// --- the self-test: the check cannot fool itself -----------------------------
// The pending-names-a-real-plan rule must fire on a probe naming a ghost plan —
// so a check that stops checking cannot stay green.
{
  const listen = SURFACES.find((s) => s.id === "listen")!;
  const probe: typeof SURFACES[number] = {
    ...listen,
    states: { ...listen.states, unusable: { pending: "PLAN-999" } },
  };
  const probes = SURFACES.map((s) => (s.id === "listen" ? probe : s));
  const bad = probes.filter((row) => {
    if (!row.generates) return false;
    return STATE_NAMES.some((st) => {
      const e = row.states[st];
      return e && "pending" in e && !hasPlan(e.pending);
    });
  });
  assert(bad.length === 1 && bad[0].id === "listen", "a probe pending naming a ghost plan must be flagged");
}

// --- invariant 27: every generating surface keeps all four states -------------------------
// The registry is the assertion: a generating surface must reach §3.2's four states —
// all wired, or a state left for a later plan only when that plan exists (above). This
// marker is what the invariant ledger points at.
const generatingCount = SURFACES.filter((s) => s.generates).length;
assert(
  generatingCount >= 3,
  "invariant 27: at least three surfaces must generate content, or the four-state promise is vacuous",
);
for (const row of SURFACES) {
  if (!row.generates) continue;
  for (const state of STATE_NAMES) {
    const entry = row.states[state];
    assert(
      entry && ("file" in entry || "pending" in entry),
      `invariant 27: surface ${row.id}/${state} is neither wired nor pending`,
    );
  }
}

// --- invariant 25: the same fact does not appear twice on screen -------------------------
// A note is the same fact as its sentence; rendering it in both the margin rail and the
// focus bar would break this invariant. The rule: the margin rail is the home of every
// note; the focus bar keeps only what the margin lacks (the counter, the translation).
// Assert it as a source scan: the focus bar must not re-render a note in the same file
// where the margin rail does.
{
  const passagePath = fileURLToPath(new URL("src/views/read/Passage.tsx", ROOT));
  const src = readFileSync(passagePath, "utf8");
  const marginNoteRender = (src.match(/\.notes\b/g) ?? []).length;
  const focusbarNoteRender = (src.match(/focused\.note\b/g) ?? []).length;
  // invariant 25
  assert(
    marginNoteRender >= 1 && focusbarNoteRender === 0,
    "invariant 25: Passage.tsx must render its note only in the margin rail — the focus bar must not repeat it",
  );
}

console.log(`surfaces: ${generatingCount} generating surfaces, states registered`);
// Acceptance (PLAN-016): the registry prints itself with its known pendings, both
// naming real plans — the two PLAN-016 leaves for Read and Listen's unusable state.
const pendings = Object.entries(ALLOWED_GENERATING_PENDINGS)
  .map(([k, p]) => `${k} (${p})`)
  .join(", ");
console.log(`surfaces: pendings — ${pendings}`);
console.log("surfaces.check ✓");
