// Runnable check: `node --experimental-strip-types src/lib/keys.check.ts`
//
// The keyboard map (lib/keys.ts). What is pinned here is the promise the map
// exists to keep: "announced == working". A shortcut that is not in the table
// cannot fire, and a shortcut that is in the table is shown — so the two lists
// cannot drift. Issues #28, #30.
import assert from "node:assert";
import { KEYS, keysFor, live, navLive, type Shortcut, type Surface } from "./keys.ts";

const SURFACES: Surface[] = [
  "today", "talk", "read", "prompter", "listening",
  "memory", "review", "coach", "settings", "onboarding",
];

// --- every row is well-formed ------------------------------------------------
for (const s of KEYS) {
  assert(s.keys.length > 0, `a shortcut must answer to at least one key: ${s.does}`);
  assert(s.does.trim() !== "", `a shortcut needs a verb phrase`);
  assert(s.on.length > 0, `a shortcut must be live somewhere: ${s.does}`);
  for (const surf of s.on) assert(SURFACES.includes(surf), `unknown surface ${surf} on ${s.does}`);
  // A label is either a literal or a function that resolves to one — never empty.
  const label = typeof s.label === "function" ? s.label([]) : s.label;
  assert(label.trim() !== "", `a shortcut needs a label: ${s.does}`);
}

// --- a key means one thing on a surface --------------------------------------
// The same key on the same surface must not do two different things — that is
// the Space bug (#30) made structural. A key may appear twice only when the two
// rows are the same action under different `when` flags (the prompter's
// start/pause, listening's play/stop) — mutually exclusive display states.
//
// Extracted as a function so the self-test below can probe the *real* checker
// rather than a copy of it — a check that stops firing must not stay green.
function clash(table: Shortcut[], surface: Surface): string | null {
  const seen = new Map<string, { does: string; when?: string }[]>();
  for (const s of table) {
    if (!s.on.includes(surface)) continue;
    for (const k of s.keys) {
      const key = k.toLowerCase();
      const prev = seen.get(key) ?? [];
      // Same `does` is the same action — allowed. Different `does` is only
      // allowed when the two rows are different `when` states (never both shown).
      const hit = prev.find((p) => p.does !== s.does && p.when === s.when);
      if (hit) return `"${key}" does "${hit.does}" and "${s.does}" on ${surface} — one key, one meaning`;
      prev.push({ does: s.does, when: s.when });
      seen.set(key, prev);
    }
  }
  return null;
}

for (const surf of SURFACES) {
  const c = clash(KEYS, surf);
  assert(!c, c ?? "");
}

// --- every surface that renders a hint line has a shortcut -------------------
// A surface with nothing to say would render an empty hint box — a silent gap.
// Only the surfaces that actually mount a Hints component are held to this;
// Coach has no hint line, so it is not. Conditional shortcuts are tested with
// the flag that shows them.
const HINT_SURFACES: [Surface, string[]][] = [
  ["today", []],
  ["talk", []],
  ["read", ["bilingual"]],
  ["prompter", ["idle"]],
  ["listening", ["idle"]],
  ["memory", []],
  ["review", []],
  ["settings", []],
  ["onboarding", ["picks"]],
];
for (const [surf, has] of HINT_SURFACES) {
  assert(keysFor(surf, has).length > 0, `surface ${surf} has no shortcuts — its hint line would be empty`);
}

// --- the gate and the table agree --------------------------------------------
// A key the table says is live on a surface must be accepted by `live`, and a
// key the table does not list must be refused. Global chords (⌘K) are handled
// above the surface blocks, so `live` deliberately refuses their bare key.
for (const surf of SURFACES) {
  for (const s of KEYS) {
    if (s.global || !s.on.includes(surf)) continue;
    for (const k of s.keys) assert(live(surf, k), `live() must accept "${k}" on ${surf}`);
  }
  // A key nobody owns is refused.
  assert(!live(surf, "F9"), `F9 is not a shortcut anywhere — live() must refuse it on ${surf}`);
  // A global chord's bare key is not a live shortcut — ⌘K is, bare `k` is not.
  assert(!live(surf, "k"), `bare "k" is not a shortcut — live() must refuse it on ${surf}`);
}

// --- nav keys are a subset of live keys ---------------------------------------
// A topbar badge is only shown where the nav key actually works. On Talk, 1–3
// are suggestions, so they are not nav keys there.
for (const surf of SURFACES) {
  for (const s of KEYS) {
    if (!s.nav || !s.on.includes(surf)) continue;
    for (const k of s.keys) assert(navLive(surf, k), `navLive() must accept "${k}" on ${surf}`);
  }
}
assert(!navLive("talk", "1"), "on Talk, 1 is a suggestion, not a nav key");
assert(navLive("today", "1"), "on Today, 1 is a nav key");

// --- nav keys never leak into a hint line -------------------------------------
// A nav key is a topbar badge, not a hint-line item — `keysFor` must not offer
// it, or the hint line would announce a shortcut the badge already shows.
for (const surf of SURFACES) {
  for (const s of keysFor(surf)) assert(!s.nav, `keysFor(${surf}) must not return a nav shortcut`);
}

// --- the self-test: a deliberately broken table is caught ---------------------
// The same pattern the ledger checks use: probe the checker itself, so a check
// that stops firing cannot silently stay green. It runs the *real* `clash`, not
// a copy — if the real checker stops firing, this probe fails.
{
  const broken: Shortcut[] = [
    { keys: ["x"], label: "x", does: "one thing", on: ["today"] },
    { keys: ["x"], label: "x", does: "another thing", on: ["today"] },
  ];
  assert(clash(broken, "today") !== null, "a table with two meanings for one key must be caught");
  // And a clean table passes the same checker.
  assert(clash(KEYS, "today") === null, "the real table must be clean on today");
}
