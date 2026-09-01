# M5 · Surface contracts: Talk, Read, Listen — the plan

**Milestone:** [M5 · Surface contracts](https://github.com/nuvocode/verba/milestone/6)
**Spec:** `docs/plans/3-verba-activity-layer-spec.md` §2.2–2.4, §3.2, §3.3, invariants 17–27
**Branch:** `plan/m5-surface-contracts`, off `master`. Every plan below lands on that
one branch, in order, each on top of the previous plan's commit.

## What the milestone is for

M4 closed the loop: activity → signal → Coach → weakness → tomorrow. The loop runs,
but three of the four activities that feed it are still sketches of themselves.

- **Talk** shows a confidence number that starts at 50 before anything is measured,
  ticks goals off by turn count, and treats voice as the button next to the text box.
- **Read** generates a passage in one call, hangs an optional note on every sentence
  from the same schema Talk uses for corrections, and shows that note in two places
  at once.
- **Listen** synthesises a whole chapter into a fire-and-forget `speak()`. There is no
  timeline, so there is no seeking, no back-10s, no speed, and no way to bind a
  question to the range of audio it came from.

M5 makes each surface keep the promise its spec section makes. It is the last
milestone that can: M6 is accessibility, and an accessibility pass over a surface
whose states are undefined has nothing to hold on to.

## The twelve sections

| # | Plan | Closes | Files |
|---|---|---|---|
| 1 | [PLAN-015](PLAN-015-house-format.md) — one formatter, no raw model output — ✅ done | #61 (a) | 5 |
| 2 | [PLAN-016](PLAN-016-four-states.md) — four states, one place per fact — ✅ done | **#61** | 8 |
| 3 | [PLAN-017](PLAN-017-talk-catalogue-persona-goals.md) — catalogue, persona, live goals — ✅ done | **#55** | 6 |
| 4 | [PLAN-018](PLAN-018-talk-voice-primary.md) — voice is the main road — ✅ done | **#56** | 6 |
| 5 | [PLAN-019](PLAN-019-talk-confidence.md) — confidence is measured, not seeded — ✅ done | #57 (a) | 4 |
| 6 | [PLAN-020](PLAN-020-talk-reflection-history.md) — reflection and history — ✅ done | **#57** | 5 |
| 7 | [PLAN-021](PLAN-021-talk-subtitles.md) — subtitles you can hide — ✅ done | **#79** | 5 |
| 8 | [PLAN-022](PLAN-022-read-passage-contract.md) — the passage generation contract — ✅ done | **#58** | 5 |
| 9 | [PLAN-023](PLAN-023-read-note-contract.md) — the note contract — ✅ done | #59 (a) | 5 |
| 10 | [PLAN-024](PLAN-024-read-close-and-prompter.md) — close reading, and a prompter that listens — ✅ done | **#59** | 6 |
| 11 | [PLAN-025](PLAN-025-listen-timeline.md) — a real timeline — ✅ done | #60 (a) | 6 |
| 12 | [PLAN-026](PLAN-026-listen-transcript-and-answers.md) — transcript, ranges, useful wrong answers — ✅ done | **#60** | 5 |

Order matters, and not only for tidiness:

- 015 and 016 come first because every plan after them renders a loading state and
  a failure through the helpers they add. Building those helpers last would mean
  writing each surface's states twice.
- The Talk chain (017 → 018 → 019 → 020 → 021) walks the same two files —
  `src/lib/useTalk.ts` and `src/views/Talk.tsx` — in sequence. 021 needs 018's
  editable voice draft, because subtitles that hide the coach's text must not hide
  the learner's own.
- 023 anchors notes in a passage, so it needs 022's passage. 024 highlights those
  notes, so it needs 023's schema.
- 026 binds a question to an audio range, which does not exist until 025 has a
  timeline to take a range from.

## The invariant ledger is the scoreboard

`src/lib/invariants.check.ts` carries spec §5's 27 claims. M4 left eleven `pending:
"M1+ (…)"`. M5 owns every one of them, and finishes the ledger.

| # | Claim | Plan that flips it |
|---|---|---|
| 17 | No Coach Note refers to an expression absent from the passage | PLAN-023 |
| 18 | Note count ≤ sentence count / 2 | PLAN-023 |
| 19 | Read notes do not use Talk's correction schema | PLAN-023 |
| 20 | Content that failed the quality gates is not shown | PLAN-022 |
| 21 | A "reuse" passage contains ≥ 50% of the target words | PLAN-022 |
| 22 | Raw model output appears on no user surface | PLAN-015 |
| 23 | Announced shortcut count === working shortcut count | PLAN-016 |
| 24 | `Esc` means "one level up" on every surface | PLAN-016 |
| 25 | The same fact is not shown in two places at once | PLAN-016 |
| 26 | No measured value is shown before measurement starts | PLAN-019 |
| 27 | Every surface implements all four states | PLAN-016 |

A plan is not finished until its ledger row reads `assertedIn` and `npm run check`
is green. All twelve plans are done, and the ledger confirms it: **27 asserted, 0
pending (M1+), 0 out of scope** — spec §5's ledger is closed.

## Out of scope for M5

- **Accessibility** — M6, `docs/plans/6-verba-erisilebilirlik-spec.md`. Keyboard
  reachability is in scope here only where an invariant already demands it
  (23, 24, and #79's reveal control); screen readers, contrast and focus rings are not.
- **New dependencies.** Every plan below is stdlib, the existing Tauri plugins, or
  React. An M5 plan that wants a library is a plan that has gone wrong.
- **Table rewrites.** `src/lib/db.ts` carries a one-shot, irreversible migration
  (`migrateVocabToPerLanguage`). Nothing in M5 touches it, and no new migration in
  M5 does more than `ALTER TABLE … ADD COLUMN … DEFAULT`.
- **Replacing the TTS tiers.** PLAN-025 adds a `clip()` to the three tiers that
  already return bytes and gives the fourth (native `webSpeech`) an honest degraded
  state. It does not bundle a new engine to make native seekable.
- **Per-goal model calls per turn.** PLAN-017's live goals ride the reply the coach
  is already producing; they do not add a second call per turn.

## The one thing worth reading twice

Every plan states its **Do not touch** list. Two entries repeat in all twelve: adding
a dependency, and rewriting a table. A third repeats in nine: **do not print what the
model said.** M5's entire premise is that generated content passes through a gate
before a learner sees it — a plan that renders a raw string on failure has undone
the milestone it belongs to.
