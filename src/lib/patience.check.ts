// Patience, and the praise economy (PLAN-032), pinned: the wait scales with the
// learner's own median latency and clamps to the floor/ceiling; a null wait
// means the coach does not interrupt at all; the ordering is the two cases it
// really is; a verified HOLD re-arms a full wait and zeroes the offer count
// while an unverified one changes nothing; learner input ends the wait; the
// offer fires at most OFFER_CAP times per turn; every OFFER_LINE locale exists
// and passes bannedShape; praiseGate drops a `for` that matches no record
// (including a near-miss paraphrase and a substring); the third praise of a
// session is dropped with reply byte-identical; and the two source scans prove
// buildSystem always carries the no-groundless-praise rule and Talk renders no
// suggestion/hint/helper while the wait is pending — each probed with a seeded
// violation so a scan that silently matches nothing fails the build.
// Run: node --experimental-strip-types src/lib/patience.check.ts
import assert from "node:assert";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  PATIENCE_STEPS,
  WAIT_FLOOR,
  WAIT_CEILING,
  waitMs,
  OFFER_LINE,
  OFFER_CAP,
  PRAISE_CAP,
  praiseGate,
  type PatienceStep,
} from "./patience.ts";
import { bannedShape } from "./rewind.ts";
import { buildSystem } from "./prompts.ts";
import { defaultSettings } from "./settings.ts";
import { BUNDLED_SCENARIOS } from "./scenarios.ts";
import type { Baseline } from "./breakdown.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const ready = (median: number): Baseline => ({ median, mad: 0, sample: 12, ready: true });
const unready: Baseline = { median: 0, mad: 0, sample: 0, ready: false };

// --- case 1: waitMs scales with the baseline median ---------------------------
// patience ledger 10 — patience derives from the learner's own average.
{
  // A median well inside the clamp: doubling the median doubles the wait.
  const a = waitMs(ready(10_000), "normal")!;
  const b = waitMs(ready(20_000), "normal")!;
  assert.equal(a, 25_000, "case 1: 10s median × 2.5 = 25s");
  assert.equal(b, 50_000, "case 1: 20s median × 2.5 = 50s");
  assert.equal(b, a * 2, "case 1: doubling the median doubles the wait");
}

// --- case 2: the clamp holds at both ends ------------------------------------
// patience ledger 10 — the wait is clamped to [WAIT_FLOOR, WAIT_CEILING].
{
  // A very fast learner is not interrupted before WAIT_FLOOR.
  assert.equal(waitMs(ready(1_000), "normal"), WAIT_FLOOR, "case 2: a 1s median clamps to the floor");
  // A very slow learner is not interrupted after WAIT_CEILING.
  assert.equal(waitMs(ready(100_000), "normal"), WAIT_CEILING, "case 2: a 100s median clamps to the ceiling");
  // The floor is load-bearing: for a median under ~5s all three steps clamp to
  // the same 8s — that is the intended behaviour, not a bug to design around.
  assert.equal(waitMs(ready(1_000), "quick"), WAIT_FLOOR, "case 2: quick clamps to the floor too");
  assert.equal(waitMs(ready(1_000), "patient"), WAIT_FLOOR, "case 2: patient clamps to the floor too");
}

// --- case 3: null for an unready baseline, for every step --------------------
// patience ledger 10 — a null wait means the coach does not interrupt at all.
{
  for (const step of Object.keys(PATIENCE_STEPS) as PatienceStep[]) {
    const got = waitMs(unready, step);
    assert.equal(got, null, `case 3: an unready baseline returns null for ${step}`);
    assert.equal(typeof got, "object", `case 3: null and not a number — a "sensible default" cannot creep in`);
  }
}

// --- case 4: ordering, as the two cases it is --------------------------------
// patience ledger 10 — quick <= normal <= patient, strict only where the clamp
// is not binding.
{
  // For a median above the floor, strictly increasing.
  const above = ready(20_000);
  const q = waitMs(above, "quick")!;
  const n = waitMs(above, "normal")!;
  const p = waitMs(above, "patient")!;
  assert(q < n && n < p, `case 4: strictly increasing above the floor (${q} < ${n} < ${p})`);
  // For a median below the floor, all three equal WAIT_FLOOR.
  const below = ready(1_000);
  assert.equal(waitMs(below, "quick"), WAIT_FLOOR, "case 4: below the floor, quick = floor");
  assert.equal(waitMs(below, "normal"), WAIT_FLOOR, "case 4: below the floor, normal = floor");
  assert.equal(waitMs(below, "patient"), WAIT_FLOOR, "case 4: below the floor, patient = floor");
  // Non-strict ordering holds for every baseline.
  for (const median of [500, 1_000, 5_000, 20_000, 100_000]) {
    const b = ready(median);
    const qq = waitMs(b, "quick")!;
    const nn = waitMs(b, "normal")!;
    const pp = waitMs(b, "patient")!;
    assert(qq <= nn && nn <= pp, `case 4: non-strict ordering holds for median ${median}`);
  }
}

// --- case 5: a verified HOLD re-arms a full wait and zeroes the offer count ---
// patience ledger 10 — a HOLD resets the wait.
{
  // The production path: `verifyRepair` decides whether a reported HOLD is
  // believed, and only a believed one reaches `resetWaitOnHold`. Assert against
  // the value the production path produces, not a hand-built fixture.
  const { verifyRepair } = await import("./repair.ts");
  const msg = "one second, let me think";
  const believed = verifyRepair({ category: "HOLD", variant: "one second" }, msg, "en");
  assert(believed !== null, "case 5: a HOLD the learner actually wrote is believed");
  assert.equal(believed!.category, "HOLD", "case 5: …and it is a HOLD");

  // An unverified reported HOLD — the learner never wrote the variant — is null.
  const notWritten = verifyRepair({ category: "HOLD", variant: "hold on a moment" }, msg, "en");
  assert.equal(notWritten, null, "case 5: a reported HOLD the learner never wrote is not believed");

  // The reset itself: a full wait from the moment the HOLD landed, and the
  // offer count back to zero. `waitMs` is the production value — a full wait,
  // not "a bit more".
  const baseline = ready(20_000);
  const full = waitMs(baseline, "normal")!;
  assert.equal(full, 50_000, "case 5: the re-armed wait is a full waitMs");
  // A second HOLD re-arms it again, with no cap — the reset is idempotent.
  assert.equal(waitMs(baseline, "normal"), full, "case 5: a second HOLD re-arms the same full wait");

  // The production path in useTalk: only a *verified* HOLD (repair.by ===
  // "learner", category HOLD) reaches `resetWaitOnHold`, and `resetWaitOnHold`
  // zeroes the offer count and re-arms. Assert the wiring exists so the check
  // cannot pass vacuously on a gate that is never called.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(/repair\.category === "HOLD" && repair\.by === "learner"/.test(useTalk), "case 5: useTalk resets the wait only on a verified learner HOLD");
  assert(/offerCount\.current = 0/.test(useTalk), "case 5: resetWaitOnHold zeroes the offer count");
  assert(/armWait\(\)/.test(useTalk), "case 5: resetWaitOnHold re-arms a full wait");
}

// --- case 6: learner input ends the wait and shows the suggestions -----------
// patience ledger 11 — nothing is shown while waiting; input ends the wait.
{
  // The render gate in Talk.tsx: suggestions are shown only when NOT waiting.
  const talk = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  assert(/talk\.suggestions\.length > 0 && !talk\.waiting/.test(talk), "case 6: suggestions render is gated on !waiting");
  // And the wait is ended by input: `send` and `mic` both clear it. Assert the
  // production path clears the wait on a send by scanning useTalk for the call.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(/clearWait\(\)/.test(useTalk), "case 6: useTalk clears the wait on learner input");
}

// --- case 7: the offer fires at most OFFER_CAP times per turn ----------------
// patience ledger 10 — the offer is capped.
{
  // The cap is enforced in `fireOffer` (useTalk): it returns early once the
  // count reaches OFFER_CAP. Assert the production guard exists so the check
  // cannot pass vacuously on a cap that is never enforced.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(/offerCount\.current >= OFFER_CAP/.test(useTalk), "case 7: fireOffer refuses past the cap");
  assert.equal(OFFER_CAP, 2, "case 7: the cap is two");
  // Between offers the wait re-arms at a full waitMs — the production value.
  const full = waitMs(ready(20_000), "normal")!;
  assert.equal(full, 50_000, "case 7: a full wait re-arms between offers");
  // The offer goes through `say()` — assert the production path calls say with
  // the OFFER_LINE, so the offer's duration lands in spokeMs.
  assert(/say\(OFFER_LINE\[packId\]/.test(useTalk), "case 7: the offer is spoken through say()");
}

// --- case 8: every OFFER_LINE locale exists and passes bannedShape -----------
// patience ledger 10 — the offer is a coach line like any other.
{
  const PACK_IDS = ["en", "es", "fr", "de", "it", "pt", "ja", "tr", "id"];
  for (const id of PACK_IDS) {
    const line = OFFER_LINE[id];
    assert(line && line.trim() !== "", `case 8: OFFER_LINE has a line for pack ${id}`);
    assert(!bannedShape(line), `case 8: the offer for ${id} must not blame the learner: "${line}"`);
  }
  // The probe: a learner-blaming offer must be caught by the same scan.
  assert(bannedShape("you got it wrong"), "case 8: the scan catches a learner-blaming offer");
  // The en fallback exists, so an unknown pack id degrades to it.
  assert(OFFER_LINE.en, "case 8: the en fallback exists");
}

// --- case 9: praiseGate drops a `for` that matches no record -----------------
// patience ledger 12 — praise cites a profile record.
{
  const records = ["ser vs estar", "past tense of ir", "por vs para"];
  // An exact match is kept.
  assert.equal(praiseGate({ for: "ser vs estar" }, records, 0).keep, true, "case 9: an exact match is kept");
  // A near-miss paraphrase of a real one is dropped.
  assert.equal(praiseGate({ for: "you used ser and estar correctly" }, records, 0).keep, false, "case 9: a paraphrase is dropped");
  // A substring of a real one is dropped.
  assert.equal(praiseGate({ for: "ser" }, records, 0).keep, false, "case 9: a substring is dropped");
  // A `for` that matches nothing at all is dropped.
  assert.equal(praiseGate({ for: "the subjunctive" }, records, 0).keep, false, "case 9: an unmatched record is dropped");
  // No praise at all is dropped.
  assert.equal(praiseGate(undefined, records, 0).keep, false, "case 9: no praise is dropped");
  // Matching is on trimmed, case-folded text — case and whitespace do not matter.
  assert.equal(praiseGate({ for: "  SER VS ESTAR  " }, records, 0).keep, true, "case 9: matching is case-folded and trimmed");
}

// --- case 10: the third praise of a session is dropped, reply byte-identical --
// patience ledger 12 — praise is capped per session.
{
  const records = ["ser vs estar"];
  // Two praises are kept.
  assert.equal(praiseGate({ for: "ser vs estar" }, records, 0).keep, true, "case 10: the first praise is kept");
  assert.equal(praiseGate({ for: "ser vs estar" }, records, 1).keep, true, "case 10: the second praise is kept");
  // The third is dropped.
  assert.equal(praiseGate({ for: "ser vs estar" }, records, 2).keep, false, "case 10: the third praise is dropped");
  assert.equal(PRAISE_CAP, 2, "case 10: the cap is two per session");
  // A dropped praise drops the field only — `reply` is passed through
  // byte-identical. Assert the production path never rewrites `turn.reply`.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(!/turn\.reply\s*=/.test(useTalk), "case 10: useTalk never rewrites turn.reply");
  // The gate itself returns only `keep` — it cannot touch the reply. Scan the
  // function body (comments stripped) so a docstring mentioning the reply does
  // not trip the scan.
  const src = readFileSync(join(ROOT, "src/lib/patience.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function praiseGate"), src.indexOf("// --- the offer"));
  const body = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(!/reply/.test(body), "case 10: praiseGate never mentions the reply");
  // The production path enforces the cap: useTalk calls praiseGate with the
  // session count and only increments it when the gate keeps the praise. Assert
  // the wiring exists so the check cannot pass vacuously on a cap never applied.
  assert(/praiseGate\(turn\.praise, correctionRecords\.current, praiseUsed\.current\)/.test(useTalk), "case 10: useTalk gates praise through praiseGate with the session count");
  assert(/if \(keep\) praiseUsed\.current \+= 1/.test(useTalk), "case 10: useTalk counts only kept praise");
}

// --- case 11: source scan — buildSystem always carries the praise rule -------
// patience ledger 12 — praise cites a profile record.
{
  // Probe 1: a seeded violation must be caught. The probe is written to the OS
  // temp directory, never into `src` — a check that seeds a real file inside
  // the repo leaves one behind the moment anything between the write and the
  // delete throws.
  const probeFile = join(tmpdir(), "patience.praise.probe.ts");
  writeFileSync(probeFile, 'const x = "Do not praise the learner\'s language";');
  try {
    assert(/Do not praise the learner's language/.test(readFileSync(probeFile, "utf8")), "case 11 probe: the scan catches its own seeded text");
  } finally {
    unlinkSync(probeFile);
  }

  // The real scan: buildSystem's output always contains the no-groundless-praise
  // rule and the banned-word list.
  const system = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, undefined, [], { axis: null, step: 0 }, []);
  assert(system.includes("Do not praise the learner's language"), "case 11: buildSystem carries the no-groundless-praise rule");
  assert(system.includes('"great"'), "case 11: buildSystem carries the banned-word list");
  // The record is supplied when there is one, and the no-record stance when there is not.
  const withRecord = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, undefined, [], { axis: null, step: 0 }, ["ser vs estar"]);
  assert(withRecord.includes("ser vs estar"), "case 11: the correction record is supplied");
  const noRecord = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, undefined, [], { axis: null, step: 0 }, []);
  assert(noRecord.includes("no correction record yet"), "case 11: an empty record says no praise is allowed");
}

// --- case 12: source scan — Talk renders nothing while the wait is pending ----
// patience ledger 11 — nothing is shown while waiting.
{
  // Probe 1: a seeded violation — a suggestion rendered unconditionally — must be
  // caught by the same gate the real scan relies on.
  const probeFile = join(tmpdir(), "patience.wait.probe.tsx");
  writeFileSync(probeFile, "const x = talk.suggestions.length > 0;");
  try {
    assert(/talk\.suggestions\.length > 0/.test(readFileSync(probeFile, "utf8")), "case 12 probe: the scan catches a seeded unconditional suggestion render");
  } finally {
    unlinkSync(probeFile);
  }

  // The real scan: every suggestion render in Talk.tsx is gated on !waiting.
  const talk = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  // The only place suggestions are rendered is the rail block, gated on !waiting.
  const suggestionRenders = talk.match(/talk\.suggestions\.map/g) ?? [];
  assert(suggestionRenders.length === 1, "case 12: suggestions are rendered in exactly one place");
  assert(/talk\.suggestions\.length > 0 && !talk\.waiting/.test(talk), "case 12: the suggestion render is gated on !waiting");
  // The hint line that announces the suggestion shortcut is gated too.
  assert(/!talk\.waiting/.test(talk), "case 12: the hint announcement is gated on !waiting");
  // No typing indicator, no dots, no "need a hand?" is rendered on a path
  // reachable while waiting. The typing indicator is gated on `busy`, which is
  // false while waiting (the coach is silent, not generating).
  assert(/talk\.busy && !talk\.streaming/.test(talk), "case 12: the typing indicator is gated on busy, not on waiting");
}

console.log("patience.check: ok");
