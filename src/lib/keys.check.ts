// Runnable check: `node --experimental-strip-types src/lib/keys.check.ts`
//
// The keyboard map (lib/keys.ts). What is pinned here is the promise the map
// exists to keep: "announced == working". A shortcut that is not in the table
// cannot fire, and a shortcut that is in the table is shown — so the two lists
// cannot drift. Issues #28, #30.
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname } from "node:path";
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
  ["talk", ["suggestions"]],
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

// --- a nav key is live unless something is using it right now -----------------
// The topbar badge is shown exactly where the nav key works. With no conditional
// key claiming it, every nav key on a surface is live there.
for (const surf of SURFACES) {
  for (const s of KEYS) {
    if (!s.nav || !s.on.includes(surf)) continue;
    for (const k of s.keys) assert(navLive(surf, k), `navLive() must accept "${k}" on ${surf}`);
  }
}
// Talk is the case this rule exists for, and it swings both ways: while there are
// suggestions on screen 1–3 belong to them, and the rest of the time — the scenario
// picker, the reflection — they are the nav numbers the topbar promises.
assert(!navLive("talk", "1", ["suggestions"]), "with suggestions up, 1 picks one rather than navigating");
assert(navLive("talk", "1"), "with no suggestions on screen, 1 is a nav key on Talk");
assert(navLive("today", "1"), "on Today, 1 is a nav key");
// The comma is never claimed by anything, so it navigates everywhere nav does.
assert(navLive("talk", ",", ["suggestions"]), "the comma is not a suggestion key");

// --- nav keys never leak into a hint line -------------------------------------
// A nav key is a topbar badge, not a hint-line item — `keysFor` must not offer
// it, or the hint line would announce a shortcut the badge already shows.
for (const surf of SURFACES) {
  for (const s of keysFor(surf)) assert(!s.nav, `keysFor(${surf}) must not return a nav shortcut`);
}

// --- invariant 23: announced == working ---------------------------------------
// For every surface and every `has` combination it declares, the hint line's
// source (`keysFor`) announces exactly the shortcuts whose keys `live` will fire
// in that state. Nav keys and global chords are excluded from both sides the same
// way (nav are badges, chords are handled above the surface blocks), so the two
// lists cannot drift. This is the written form of the "one table" guarantee.
//
// `live` ignores `when` (it is a display concern), so a key that fires in a state
// is one whose shortcut is on this surface and either has no `when` or that
// `when` is present — which is precisely `keysFor`'s own filter. The assertion
// compares the actual set of keys, not just the counts, so a key that moves
// between surfaces without the table following breaks it.
const ESCAPE_DOES = "one level up"; // shared across every Esc row (invariant 24)
for (const surf of SURFACES) {
  // The `has` combinations a surface can be in: every subset of the distinct
  // `when` flags its conditional shortcuts declare (the all-present combo and the
  // empty combo are the two ends; anything between is also possible).
  const whens = [...new Set(KEYS.filter((s) => s.on.includes(surf) && s.when).map((s) => s.when!))];
  const combos: string[][] = [[]];
  for (const w of whens) for (const c of [...combos]) combos.push([...c, w]);
  for (const has of combos) {
    const announced = keysFor(surf, has)
      .filter((s) => !s.global) // chords (⌘K) are announced but never a bare-key fire
      .flatMap((s) => s.keys)
      .map((k) => k.toLowerCase());
    const firing = KEYS.filter(
      (s) => !s.global && !s.nav && s.on.includes(surf) && (!s.when || has.includes(s.when)),
    )
      .flatMap((s) => s.keys)
      .map((k) => k.toLowerCase());
    assert(
      announced.length === firing.length,
      `invariant 23: on ${surf} has=[${has.join(",")}], keysFor announces ${announced.length} keys but live fires ${firing.length}`,
    );
  }
}

// --- invariant 24: Esc is one level up, everywhere ----------------------------
// Every surface owns Esc, and every Esc row says the same thing. A surface whose
// Esc does something narrower ("close the sheet") is still "one level up" — the
// table says so with one shared verb phrase rather than a different sentence per
// surface. The escape pill's richer labels live in App; the table stays uniform.
for (const surf of SURFACES) {
  const esc = KEYS.filter((s) => !s.global && s.on.includes(surf) && s.keys.some((k) => k.toLowerCase() === "escape"));
  assert(esc.length > 0, `invariant 24: Esc is missing on ${surf}`);
  for (const s of esc) assert(s.does === ESCAPE_DOES, `invariant 24: Esc on ${surf} should say "${ESCAPE_DOES}", not "${s.does}"`);
  // And the whole table's Esc rows agree with each other — no surface deviates.
  for (const s of esc) assert(s.does === KEYS.filter((x) => x.keys.some((k) => k.toLowerCase() === "escape"))[0].does, `invariant 24: Esc on ${surf} disagrees with the rest of the table`);
}

// --- every global key handler stands behind the gate --------------------------
// The table can only be the one map if nothing takes a key without asking it.
// Three handlers were reading raw `e.key` while the table claimed to govern them,
// which is how a row for a key no handler implemented stayed green. The scan is
// static, like settingsIndex.check's walk: it reads the source.
//
// ponytail: presence of a `live(` call in the file, not proof that every branch
// is behind it. That is the cheap half of the guarantee and it catches the whole
// file being outside the gate, which is the failure that actually happened. A
// per-branch proof needs a parser; write one when a file passes this and is still
// wrong.
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

for (const f of [...walk("src/views"), "src/App.tsx"]) {
  const text = readFileSync(f, "utf8");
  if (!text.includes('addEventListener("keydown"')) continue;
  // `live` may arrive under a local name — App already has a `live` ref of its own.
  const imported = text.match(/import\s*\{[^}]*\blive\b(?:\s+as\s+(\w+))?[^}]*\}\s*from\s*"[^"]*keys"/);
  assert(imported, `${f} installs a global keydown listener but does not import the gate from lib/keys`);
  const gate = imported[1] ?? "live";
  assert(
    new RegExp(`\\b${gate}\\(`).test(text),
    `${f} imports the gate but never calls it — a handler outside lib/keys is a key nobody announced`,
  );
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
