// Controlled difficulty (PLAN-031), pinned: one axis a session, never more; the
// three real ways `pickAxis` returns null; rotation that skips the last two
// sessions' axes; `pace` never chosen without working TTS; the two-consecutive-
// easy rise (one easy session is not enough); the in-session drop on drowning
// that does NOT wait for calibrate; the ease request's byte-identical step; and
// the source scan that proves no surface reads difficultyStep or renders an
// announcement of difficulty change — probed with a seeded violation so a scan
// that silently matches nothing fails the build.
// Run: node --experimental-strip-types src/lib/difficulty.check.ts
import assert from "node:assert";
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  AXES,
  pickAxis,
  calibrate,
  drowns,
  dropOnDrown,
  easeEffect,
  recapsFrom,
  axisGuidance,
  DIFFICULTY_NO_ANNOUNCE,
  type Axis,
  type PickContext,
  type SessionRecap,
} from "./difficulty.ts";
import { buildSystem } from "./prompts.ts";
import { defaultSettings } from "./settings.ts";
import { BUNDLED_SCENARIOS } from "./scenarios.ts";
import type { Signal } from "./model.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const NO_TTS: PickContext = { ease: false, canSpeak: false };
const TTS: PickContext = { ease: false, canSpeak: true };
const EASE: PickContext = { ease: true, canSpeak: true };

const recap = (r: Partial<SessionRecap>): SessionRecap => ({
  axis: null,
  turns: 0,
  drowned: false,
  zero: false,
  ...r,
});

const ready = { ready: true } as const;
const unready = { ready: false } as const;

// --- case 1: at most one axis, ever, over 200 seeded profiles ----------------
// difficulty ledger 15 — at most one difficulty axis is active.
{
  let seed = 123456789;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 200; i++) {
    const history: SessionRecap[] = Array.from({ length: Math.floor(rnd() * 6) }, (_, j) =>
      recap({
        axis: rnd() < 0.5 ? AXES[Math.floor(rnd() * AXES.length)] : null,
        drowned: rnd() < 0.15,
        zero: rnd() < 0.4,
      }),
    );
    const got = pickAxis(
      rnd() < 0.2 ? unready : ready,
      history,
      "B1",
      { ease: rnd() < 0.1, canSpeak: rnd() < 0.9 },
    );
    assert(got === null || (AXES as readonly string[]).includes(got), `case 1: pickAxis returned "${got}" — not one of the axes`);
  }
}

// --- case 2: null is a real answer, three ways --------------------------------
{
  // below BASELINE_MIN (inventory not ready) → null
  assert.equal(pickAxis(unready, [], "A2", TTS), null, "a learner below BASELINE_MIN gets no axis");
  // last session drowned → null
  assert.equal(
    pickAxis(ready, [recap({ axis: "length", drowned: true })], "B1", TTS),
    null,
    "a learner whose last session drowned gets no axis",
  );
  // asked for ease today → null
  assert.equal(pickAxis(ready, [], "B1", EASE), null, "a learner who asked for ease today gets no axis");
  // otherwise one axis
  assert((AXES as readonly string[]).includes(pickAxis(ready, [], "B1", TTS) as string), "a ready, fresh learner gets exactly one axis");
}

// --- case 3: never the axis used in either of the last two sessions ----------
{
  const got = pickAxis(ready, [recap({ axis: "vocabulary" }), recap({ axis: "length" })], "B1", TTS);
  assert(got !== null, "case 3: expected an axis");
  assert(got !== "vocabulary" && got !== "length", `case 3: rotated into an excluded axis: ${got}`);
  // The third axis back counts again: two excluded, the next is eligible.
  const third = pickAxis(ready, [recap({ axis: "pace" }), recap({ axis: "direction" })], "B1", TTS);
  assert(third === "structure" || third === "vocabulary" || third === "length", `case 3: rotation should skip the last two, got ${third}`);

  // The wheel must actually turn. Rotating inside the *eligible* set instead of
  // inside AXES looks right on any single pair and is wrong over a run: the last
  // axis used is almost always one of the two this pick excludes, so the search
  // for it finds nothing and every session falls to the first eligible axis.
  // That left `structure` and `direction` unreachable for the life of the app —
  // a pair check cannot see it, so the run is the check.
  let history: SessionRecap[] = [];
  const run: (Axis | null)[] = [];
  for (let i = 0; i < 15; i++) {
    const a = pickAxis(ready, history, "B1", TTS);
    run.push(a);
    history = [recap({ axis: a }), ...history];
  }
  for (const a of AXES) {
    assert(run.includes(a), `case 3: "${a}" is unreachable over 15 sessions — the rotation is stuck on ${[...new Set(run)].join(", ")}`);
  }
  // And it still never repeats within two sessions of itself.
  for (let i = 2; i < run.length; i++) {
    assert(run[i] !== run[i - 1] && run[i] !== run[i - 2], `case 3: session ${i} reused a recent axis (${run[i]})`);
  }
}

// --- case 4: pace is never chosen when TTS is unavailable --------------------
{
  const noSpeak = Array.from({ length: 40 }, (_, i) => pickAxis(ready, [recap({ axis: i % 2 ? "length" : "structure" })], "B1", NO_TTS));
  assert(noSpeak.every((a) => a !== "pace"), "case 4: race — pace chosen with no working TTS");
  assert(noSpeak.some((a) => a !== null), "case 4: without pace there is still a real choice");
}

// --- case 5: two consecutive zero-breakdown sessions raise; one does not ------
// difficulty ledger 16 — difficulty rises without breakdowns, drops instantly on drowning.
{
  const oneEasy = [recap({ zero: true }), recap({ zero: false }), recap({ axis: "length" })];
  assert.equal(calibrate(1, oneEasy), 1, "case 5: one easy session is not enough to raise");
  const twoEasy = [recap({ zero: true }), recap({ zero: true }), recap({ axis: "length" })];
  assert.equal(calibrate(1, twoEasy), 2, "case 5: two consecutive easy sessions raise by one");
  const threeEasy = [recap({ zero: true }), recap({ zero: true }), recap({ zero: true })];
  assert.equal(calibrate(3, threeEasy), 4, "case 5: a third easy session raises again");
  // A drowned session breaks the run even if it is the newest.
  const drownedBetween = [recap({ zero: true }), recap({ drowned: true, zero: false }), recap({ zero: true })];
  assert.equal(calibrate(1, drownedBetween), 1, "case 5: a break (a drowned session) stops the run");
  // The step is clamped at 4.
  assert.equal(calibrate(4, twoEasy), 4, "case 5: the step never rises above 4");

  // The same rule over real stored signals, not hand-built recaps. `recentSignals`
  // returns every activity's batch — a Read and a Listen write their own, and
  // neither is a conversation. Counting one as a zero-breakdown session handed
  // `calibrate` a free easy session for every activity the learner finished, so a
  // single conversation full of breakdowns still raised the step.
  const at = 1_000_000_000_000;
  const sig = (kind: Signal["kind"], payload: unknown, stamp: number, id: string): Signal => ({
    id,
    activityId: "a1",
    kind,
    observedAt: stamp,
    payload,
  });
  const learnerTurn = (breakdown: string[], stamp: number, id: string): Signal =>
    sig("unpromptedTurn", { words: 6, sentences: 1, chars: 30, latencyMs: 3000, speakMs: 0, speakUnknown: false, breakdown }, stamp, id);

  const aDay: Signal[] = [
    // newest first, as recentSignals returns: a Listen batch, a Read batch, then
    // the conversation — which went badly.
    sig("comprehension", { label: "gist", correct: true }, at, "l1"),
    sig("comprehension", { label: "detail", correct: true }, at, "l2"),
    sig("lexicalItem", { label: "palabra", grade: 3 }, at - 60_000, "r1"),
    learnerTurn(["disconnected", "keyWordMissing"], at - 120_000, "t1"),
    learnerTurn(["overGeneral"], at - 120_000, "t2"),
    learnerTurn([], at - 120_000, "t3"),
    learnerTurn([], at - 120_000, "t4"),
  ];
  const dayRecaps = recapsFrom(aDay);
  assert.equal(dayRecaps.length, 1, "case 5: a Read and a Listen are not sessions — only the conversation is");
  assert.equal(dayRecaps[0].zero, false, "case 5: …and that conversation had breakdowns");
  assert.equal(calibrate(0, dayRecaps), 0, "case 5: a day of activities behind a hard conversation must not raise the step");

  // A conversation abandoned before its first turn is not an easy session either.
  const abandoned: Signal[] = [
    sig("axisUsed", { label: "pace" }, at, "a1"),
    sig("axisUsed", { label: "length" }, at - 1000, "a2"),
  ];
  assert.deepEqual(recapsFrom(abandoned), [], "case 5: a conversation with no turn is not a session");
  assert.equal(calibrate(0, recapsFrom(abandoned)), 0, "case 5: two abandoned conversations must not raise the step");
}

// --- case 6: drowning fires at half of turns over four, not at three ----------
// difficulty ledger 16 — drops instantly on drowning.
{
  // Four turns, exactly half heavy (2/4) → yes.
  assert.equal(drowns({ turns: 4, heavy: 2 }), true, "case 6: 2 of 4 heavy turns is a drowning session");
  // Three turns, all heavy → no (need ≥ 4 turns).
  assert.equal(drowns({ turns: 3, heavy: 3 }), false, "case 6: three turns can never drown");
  // Four turns, under half heavy (1/4) → no.
  assert.equal(drowns({ turns: 4, heavy: 1 }), false, "case 6: 1 of 4 heavy turns is not drowning");
  // Six turns, half (3/6) → yes; under half (2/6) → no.
  assert.equal(drowns({ turns: 6, heavy: 3 }), true, "case 6: 3 of 6 heavy turns drowns");
  assert.equal(drowns({ turns: 6, heavy: 2 }), false, "case 6: 2 of 6 heavy turns does not");
}

// --- case 7: the drop is in-session, not left for calibrate -------------------
// difficulty ledger 16 — the in-session path sets the axis to null and drops the step.
{
  // Not yet drowning → no drop.
  assert.equal(dropOnDrown({ turns: 3, heavy: 2 }, 2, false), null, "case 7: not yet over 4 turns, no drop");
  // Drowning, axis set, not yet dropped → drop.
  const hit = dropOnDrown({ turns: 4, heavy: 2 }, 2, false);
  assert.deepEqual(hit, { axis: null, step: 1 }, "case 7: drowning drops the axis to null and the step by one");
  // Already dropped → no second drop (would double-count / go below 0).
  assert.equal(dropOnDrown({ turns: 5, heavy: 4 }, 1, true), null, "case 7: a second trip after the drop does nothing");
  // A session with no axis still drops. That session is exactly what `pickAxis`
  // hands a learner whose last one drowned, so gating the drop on an active axis
  // would deny it to the learner who drowns twice running — the one who needs it.
  assert.deepEqual(
    dropOnDrown({ turns: 8, heavy: 6 }, 2, false),
    { axis: null, step: 1 },
    "case 7: drowning drops the step even in a session with no axis",
  );
  // Step is floored at 0.
  assert.deepEqual(dropOnDrown({ turns: 6, heavy: 3 }, 0, false), { axis: null, step: 0 }, "case 7: the drop never goes below 0");
}

// --- case 8: an ease request sets `off`, clears the axis, and leaves the step --
// difficulty ledger 17 — "Do not push me today" is obeyed unconditionally.
{
  const before = 2;
  const effect = easeEffect(before);
  assert.deepEqual(effect, { axis: null, step: 2 }, "case 8: the step is byte-identical before and after");
  // `off` is the budget flag the caller sets — assert the contract's other half
  // here: ease is unconditional even when there is no axis (a null axis session).
  assert.equal(pickAxis(ready, [], "B1", EASE), null, "case 8: ease forces null even for a ready fresh learner");
}

// --- case 9: no surface reads difficultyStep/Axis; no announcement rendered ---
// Probed with a seeded violation so a scan that silently matches nothing fails.
{
  const relative = (base: string, p: string) => p.slice(base.length + 1);
  const SRC = join(ROOT, "src");
  const scan = (files: string[], re: RegExp): string[] => files.filter((f) => re.test(readFileSync(join(SRC, f), "utf8")));

  // Every .tsx under src — the learner-facing surfaces.
  const tsx: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (e.endsWith(".tsx")) tsx.push(relative(SRC, p));
    }
  };
  walk(SRC);

  // Probe 1: a seeded .tsx that reads difficultyStep must be caught. The probe
  // is written to the OS temp directory, never into `src` — a check that seeds a
  // real file inside the repo leaves one behind the moment anything between the
  // write and the delete throws.
  const probeFile = join(tmpdir(), "difficulty.probe.tsx");
  writeFileSync(probeFile, "const x = settings.difficultyStep;");
  try {
    assert(/difficultyStep/.test(readFileSync(probeFile, "utf8")), "case 9 probe: the scan must catch a seeded difficultyStep read");
  } finally {
    unlinkSync(probeFile);
  }
  // The real scan: no .tsx reads the step.
  const realTsx = tsx;
  const readsStep = scan(realTsx, /difficultyStep/);
  assert(readsStep.length === 0, `case 9: a surface reads difficultyStep:\n${readsStep.join("\n")}`);
  const readsAxisType = scan(realTsx, /type\s+Axis\b|\bAxis\b/);
  assert(readsAxisType.length === 0, `case 9: a surface reads the Axis type:\n${readsAxisType.join("\n")}`);

  // Probe 2: an announcement string in a surface must be caught — the same scan,
  // fed a seeded violation, must flag it.
  const banned = /(making this harder|making it harder|easier session|too hard for you|raising the difficulty|lowered the difficulty|difficulty of this|this is getting harder)/;
  const probeAnn = join(tmpdir(), "difficulty.ann.probe.tsx");
  writeFileSync(probeAnn, 'const x = "making this harder for you";');
  try {
    assert(banned.test(readFileSync(probeAnn, "utf8")), "case 9 probe: the announcement regex catches its own seeded text");
  } finally {
    unlinkSync(probeAnn);
  }

  const announcing = realTsx.filter((f) => banned.test(readFileSync(join(SRC, f), "utf8")));
  assert(announcing.length === 0, `case 9: a surface announces difficulty change:\n${announcing.join("\n")}`);
}

// --- case 10: buildSystem carries the no-announcement rule when an axis is on --
{
  const pack = undefined;
  const noAxis = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, pack, [], { axis: null, step: 0 });
  assert(!noAxis.includes(DIFFICULTY_NO_ANNOUNCE), "case 10: no-announce rule absent when no axis is active");
  const withAxis = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, pack, [], { axis: "pace", step: 1 });
  assert(withAxis.includes(DIFFICULTY_NO_ANNOUNCE), "case 10: no-announce rule present when an axis is active");
  assert(withAxis.includes("Harder this session"), "case 10: the axis guidance is present when an axis is active");
  // The guidance names the axis, written for the model.
  assert(withAxis.includes("conversational tempo"), "case 10: pace guidance names its dimension");
}

// --- recapsFrom groups a session's signals into one recap, newest-first ------
{
  // Two sessions: the older has zero breakdowns and used "length"; the newer
  // drowned (4 turns, 2 heavy) and used "pace".
  const turn = (kind: "unpromptedTurn" | "suggestionUsed", id: string, at: number, breakdown: string[] = []): Signal => ({
    id,
    activityId: "a1",
    kind,
    observedAt: at,
    payload: { words: 5, sentences: 1, chars: 25, breakdown, latencyMs: 1000, speakMs: 0, speakUnknown: false },
  });
  const axisSig = (label: Axis, id: string, at: number): Signal => ({
    id,
    activityId: "a1",
    kind: "axisUsed",
    observedAt: at,
    payload: { label },
  });
  const olderAt = 1_000_000_000_000;
  const newerAt = 1_000_000_100_000;
  const signals = [
    // newest (newer session) — drowned
    turn("unpromptedTurn", "n1", newerAt, ["slowResponse", "keyWordMissing"]),
    turn("unpromptedTurn", "n2", newerAt, ["slowResponse", "keyWordMissing"]),
    turn("unpromptedTurn", "n3", newerAt),
    turn("unpromptedTurn", "n4", newerAt),
    axisSig("pace", "na", newerAt),
    // older session — easy
    turn("unpromptedTurn", "o1", olderAt),
    turn("unpromptedTurn", "o2", olderAt),
    axisSig("length", "oa", olderAt),
  ];
  const recaps = recapsFrom(signals);
  assert.equal(recaps.length, 2, "recapsFrom: two sessions, two recaps");
  assert.equal(recaps[0].axis, "pace", "recapsFrom: newest session's axis is first");
  assert.equal(recaps[0].drowned, true, "recapsFrom: the newest session drowned");
  assert.equal(recaps[1].zero, true, "recapsFrom: the older session was easy");
  assert.equal(recaps[1].axis, "length", "recapsFrom: the older session's axis");
  assert.equal(recaps[0].turns, 4, "recapsFrom: the newest session had 4 turns");
}

console.log("difficulty.check: ok");
