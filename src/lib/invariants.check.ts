// Run: node --experimental-strip-types src/lib/invariants.check.ts
//
// The invariant ledger: the registry of every verifiable claim from
// docs/plans/3-verba-activity-layer-spec.md §5. A row is either claimed by a
// marker comment in another *.check.ts (assertedIn), owned by this ledger
// itself (owned), or not yet verifiable (pending — an open issue "#N" or a
// post-M1 scope item "M1+ (…)").
//
// The ledger audits its own bookkeeping: every assertedIn target must exist and
// carry its marker, or the run fails. It also probes itself, so a broken check
// cannot silently stay green.
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultSettings } from "./settings.ts";
import { buildDailyPlan } from "./learn.ts";
import type { DailyPlan, PlannedActivity } from "./model.ts";

// Repo root derived from this file's own location (src/lib/invariants.check.ts).
const ROOT = new URL("../../", import.meta.url);

type Row =
  | { id: number; claim: string; assertedIn: { file: string; marker: string }[] }
  | { id: number; claim: string; owned: true } // the ledger asserts it itself
  | { id: number; claim: string; pending: string }; // "#<issue> — ..." or "M1+ (<area>)"

const LEDGER: Row[] = [
  {
    id: 1,
    claim: "Kullanıcıya görünen hiçbir dil adı statik metinde yer almaz.",
    assertedIn: [{ file: "src/lib/lang.check.ts", marker: "invariant 1" }],
  },
  {
    id: 2,
    claim: "Bir ekranda gösterilen tüm seviye değerleri ya aynıdır ya da farkları açıklanmıştır.",
    assertedIn: [{ file: "src/lib/model.check.ts", marker: "invariant 2" }],
  },
  {
    id: 3,
    claim: "`level` tek bir kaynaktan okunur.",
    assertedIn: [
      { file: "src/lib/model.check.ts", marker: "invariant 3" },
      { file: "src/lib/settings.check.ts", marker: "invariant 3" },
    ],
  },
  {
    id: 4,
    claim: "`plan.estimatedMinutes` === aktivite sürelerinin toplamı.",
    assertedIn: [
      { file: "src/lib/model.check.ts", marker: "invariant 4" },
      { file: "src/lib/learn.check.ts", marker: "invariant 4" },
    ],
  },
  {
    id: 5,
    claim: "Her `PlannedActivity.rationale` boş değildir.",
    assertedIn: [
      { file: "src/lib/model.check.ts", marker: "invariant 5" },
      { file: "src/lib/learn.check.ts", marker: "invariant 5" },
    ],
  },
  {
    id: 6,
    claim: "Coach'ta gösterilen her zayıflığın `addressedBy` alanı doludur ve işaret ettiği aktivite ertesi günün planında vardır.",
    assertedIn: [{ file: "src/lib/weakness.check.ts", marker: "invariant 6" }],
  },
  {
    id: 7,
    claim: "`dependsOn` tanımlı bir aktivite, bağımlılığının çıktısını fiilen kullanır.",
    owned: true,
  },
  {
    id: 8,
    claim: "Hiçbir delta, metriğin kendi değerine eşit değildir.",
    assertedIn: [{ file: "src/lib/coachmetrics.check.ts", marker: "invariant 8" }],
  },
  {
    id: 9,
    claim: "Consistency görselindeki kutu sayısı === 7; işaretli kutu sayısı === bildirilen gün sayısı.",
    assertedIn: [{ file: "src/lib/coachmetrics.check.ts", marker: "invariant 9" }],
  },
  {
    id: 10,
    claim: "Başlık metni ile metrik değerleri çelişmez.",
    assertedIn: [{ file: "src/lib/coachmetrics.check.ts", marker: "invariant 10" }],
  },
  {
    id: 11,
    claim: 'Her "win" maddesi bir sinyal eşiğine dayanır.',
    assertedIn: [{ file: "src/lib/coachmetrics.check.ts", marker: "invariant 11" }],
  },
  {
    id: 12,
    claim: "Ekrandaki her sayının bir birimi ve bir tanımı vardır.",
    assertedIn: [{ file: "src/lib/coachmetrics.check.ts", marker: "invariant 12" }],
  },
  {
    id: 13,
    claim: "Due öğe sayısı < toplam öğe sayısı (deck 1 günden eskiyse).",
    assertedIn: [{ file: "src/lib/srs.check.ts", marker: "invariant 13" }],
  },
  {
    id: 14,
    claim: "Bir tekrar sonrası ilgili öğenin `dueAt` ve `interval` değerleri değişmiştir.",
    assertedIn: [{ file: "src/lib/srs.check.ts", marker: "invariant 14" }],
  },
  {
    id: 15,
    claim: "`strength` çubuklarının uzunlukları deck içinde çeşitlilik gösterir.",
    assertedIn: [{ file: "src/lib/deck.check.ts", marker: "invariant 15" }],
  },
  {
    id: 16,
    claim: "Öğrencinin seviyesinin iki bant altındaki öğeler otomatik eklenmez.",
    assertedIn: [{ file: "src/lib/vocab.check.ts", marker: "invariant 16" }],
  },
  {
    id: 17,
    claim: "Hiçbir Coach Note, pasajda geçmeyen bir ifadeye atıfta bulunmaz.",
    assertedIn: [{ file: "src/lib/notes.check.ts", marker: "invariant 17" }],
  },
  {
    id: 18,
    claim: "Not sayısı ≤ cümle sayısı / 2.",
    assertedIn: [{ file: "src/lib/notes.check.ts", marker: "invariant 18" }],
  },
  {
    id: 19,
    claim: "Read notları Talk'un düzeltme şemasını kullanmaz.",
    assertedIn: [{ file: "src/lib/notes.check.ts", marker: "invariant 19" }],
  },
  {
    id: 20,
    claim: "Kalite kapılarından geçmemiş içerik gösterilmez.",
    assertedIn: [{ file: "src/lib/passage.check.ts", marker: "invariant 20" }],
  },
  {
    id: 21,
    claim: 'Bir pasaj "yeniden kullanım" iddiasıyla üretildiyse hedef kelimelerin ≥ %50\'sini içerir.',
    assertedIn: [{ file: "src/lib/passage.check.ts", marker: "invariant 21" }],
  },
  {
    id: 22,
    claim: "Ham model çıktısı (JSON, stack trace) hiçbir kullanıcı yüzeyinde görünmez.",
    assertedIn: [{ file: "src/lib/prompts.check.ts", marker: "invariant 22" }],
  },
  {
    id: 23,
    claim: "Ekranda ilan edilen kısayol sayısı === çalışan kısayol sayısı.",
    assertedIn: [{ file: "src/lib/keys.check.ts", marker: "invariant 23" }],
  },
  {
    id: 24,
    claim: '`Esc` her yüzeyde "bir seviye yukarı" anlamındadır.',
    assertedIn: [{ file: "src/lib/keys.check.ts", marker: "invariant 24" }],
  },
  {
    id: 25,
    claim: "Aynı bilgi aynı anda iki yerde gösterilmez.",
    assertedIn: [{ file: "src/lib/surfaces.check.ts", marker: "invariant 25" }],
  },
  {
    id: 26,
    claim: "Ölçüm başlamadan hiçbir ölçüm değeri gösterilmez.",
    assertedIn: [{ file: "src/lib/confidence.check.ts", marker: "invariant 26" }],
  },
  {
    id: 27,
    claim: "Her yüzey dört durumu (yükleniyor / boş / hata / bozuk içerik) uygular.",
    assertedIn: [{ file: "src/lib/surfaces.check.ts", marker: "invariant 27" }],
  },
];

// --- REPAIR_LEDGER: spec 4 §12's claims, audited by the same machinery ---------
//
// M6 introduces a second spec (docs/plans/4-verba-repair-katmani-spec.md §12) with
// its own list of claims. One ledger file, two specs. Rows are `assertedIn` a
// *.check.ts marker, or `pending` until the plan that builds them lands.
type RepairRow =
  | { id: number; claim: string; assertedIn: { file: string; marker: string }[] }
  | { id: number; claim: string; pending: string }; // "#<issue> — <what builds it>"

const REPAIR_LEDGER: RepairRow[] = [
  {
    id: 1,
    claim: "Six repair categories defined, states tracked",
    assertedIn: [{ file: "src/lib/repair.check.ts", marker: "repair ledger 1" }],
  },
  {
    id: 2,
    claim: "Inventory fills only by observation; a claim changes nothing",
    assertedIn: [{ file: "src/lib/repair.check.ts", marker: "repair ledger 2" }],
  },
  {
    id: 3,
    claim: "A per-learner response baseline exists and signals normalise against it",
    assertedIn: [{ file: "src/lib/breakdown.check.ts", marker: "breakdown ledger 3" }],
  },
  {
    id: 4,
    claim: "Model latency is separated from learner latency",
    assertedIn: [{ file: "src/lib/breakdown.check.ts", marker: "breakdown ledger 4" }],
  },
  {
    id: 5,
    claim: "Bluff needs ≥2 signals; one signal only records",
    assertedIn: [{ file: "src/lib/breakdown.check.ts", marker: "breakdown ledger 5" }],
  },
  {
    id: 6,
    claim: "Rewinds per session are capped",
    assertedIn: [{ file: "src/lib/breakdown.check.ts", marker: "breakdown ledger 6" }],
  },
  {
    id: 7,
    claim: "The first repetition is always the same sentence, slowed",
    assertedIn: [{ file: "src/lib/rewind.check.ts", marker: "rewind ledger 7" }],
  },
  {
    id: 8,
    claim: "Rewind language blames the coach; no text points at the learner",
    assertedIn: [{ file: "src/lib/rewind.check.ts", marker: "rewind ledger 8" }],
  },
  {
    id: 9,
    claim: "A learner-initiated repair request is actually obeyed",
    assertedIn: [{ file: "src/lib/rewind.check.ts", marker: "rewind ledger 9" }],
  },
  {
    id: 10,
    claim: "Patience derives from the learner's own average and is settable",
    assertedIn: [{ file: "src/lib/patience.check.ts", marker: "patience ledger 10" }],
  },
  {
    id: 11,
    claim: "Nothing is shown while waiting",
    assertedIn: [{ file: "src/lib/patience.check.ts", marker: "patience ledger 11" }],
  },
  {
    id: 12,
    claim: "Praise cites a profile record, and is capped per session",
    assertedIn: [{ file: "src/lib/patience.check.ts", marker: "patience ledger 12" }],
  },
  {
    id: 13,
    claim: "At most one personal detail per opening, never re-asked",
    assertedIn: [{ file: "src/lib/prompts.check.ts", marker: "memory ledger 13" }],
  },
  {
    id: 14,
    claim: "Coach personality is consistent; style applies on every surface",
    assertedIn: [{ file: "src/lib/prompts.check.ts", marker: "memory ledger 14" }],
  },
  {
    id: 15,
    claim: "At most one difficulty axis is active",
    assertedIn: [{ file: "src/lib/difficulty.check.ts", marker: "difficulty ledger 15" }],
  },
  {
    id: 16,
    claim: "Difficulty rises without breakdowns, drops instantly on drowning",
    assertedIn: [{ file: "src/lib/difficulty.check.ts", marker: "difficulty ledger 16" }],
  },
  {
    id: 17,
    claim: '"Do not push me today" is obeyed unconditionally',
    assertedIn: [{ file: "src/lib/difficulty.check.ts", marker: "difficulty ledger 17" }],
  },
  {
    id: 18,
    claim: "Rehearsal works; role-play and feedback are separated",
    assertedIn: [{ file: "src/lib/rehearsal.check.ts", marker: "rehearsal ledger 18" }],
  },
  {
    id: 19,
    claim: "Brought content stays local and reaches Memory",
    pending: "#67 — PLAN-035",
  },
  {
    id: 20,
    claim: "Listening variables are graded; an unsupported grade is not shown",
    pending: "#68 — PLAN-036",
  },
  {
    id: 21,
    claim: "Coach shows the inventory in the learner's own phrases",
    pending: "#69 — PLAN-037",
  },
  {
    id: 22,
    claim: "Bluff rate is never shown as a raw number",
    pending: "#69 — PLAN-037",
  },
  {
    id: 23,
    claim: "Thin data shows an empty state, never an invented metric",
    pending: "#69 — PLAN-037",
  },
  {
    id: 24,
    claim: "The layer works over text when there is no audio input",
    pending: "#69 — PLAN-037",
  },
];

// Repair assertedIn targets are audited like the main ledger's: a repair claim
// must point at a real file that really carries its marker.
const repairUnverified: string[] = [];
for (const row of REPAIR_LEDGER)
  if ("assertedIn" in row) repairUnverified.push(...verifyAssertedIn(row.assertedIn));
assert(
  repairUnverified.length === 0,
  "invariants.check: unverified REPAIR_LEDGER targets:\n" + repairUnverified.join("\n"),
);

// Every pending repair row names the issue and plan that builds it. A pending row
// without one is a claim that has quietly left the spec.
for (const row of REPAIR_LEDGER)
  if ("pending" in row)
    assert.match(row.pending, /^#\d+ — PLAN-\d+$/, `repair ledger ${row.id} must name the issue and plan that build it`);

// The repair ledger is complete: 24 rows, ids 1..24, no gaps, no duplicates.
assert.deepEqual(
  REPAIR_LEDGER.map((r) => r.id),
  Array.from({ length: 24 }, (_, i) => i + 1),
  "the repair ledger must carry spec 4 §12's 24 claims, in order, exactly once each",
);

// --- assertedIn verification --------------------------------------------------

function verifyAssertedIn(entries: { file: string; marker: string }[]): string[] {
  const problems: string[] = [];
  for (const { file, marker } of entries) {
    const abs = fileURLToPath(new URL(file, ROOT));
    if (!existsSync(abs)) {
      problems.push(`missing file ${file}`);
      // `(?!\\d)` so the marker "invariant 1" does not match a file whose only
      // marker is "invariant 17" — plain .includes() would call that row proven.
    } else if (!new RegExp(`${marker}(?!\\d)`).test(readFileSync(abs, "utf8"))) {
      problems.push(`${file} is missing marker "${marker}"`);
    }
  }
  return problems;
}

// Every row that claims an assertion elsewhere must point at a real file that
// really carries its marker — the ledger refuses to go green on a stale claim.
const unverified: string[] = [];
for (const row of LEDGER)
  if ("assertedIn" in row) unverified.push(...verifyAssertedIn(row.assertedIn));
assert(
  unverified.length === 0,
  "invariants.check: unverified assertedIn targets:\n" + unverified.join("\n"),
);

// --- invariant 7: owned by the ledger, asserted directly ----------------------

function checkDependsOn(plan: DailyPlan): string[] {
  const problems: string[] = [];
  plan.activities.forEach((a, i) => {
    if (a.dependsOn === undefined) return;
    const depIndex = plan.activities.findIndex((b) => b.id === a.dependsOn);
    if (depIndex === -1) {
      problems.push(`activity "${a.id}" depends on "${a.dependsOn}", which is not in the plan`);
    } else if (depIndex >= i) {
      problems.push(
        `activity "${a.id}" depends on "${a.dependsOn}" (index ${depIndex}), which is not earlier in the plan (its own index is ${i})`,
      );
    }
  });
  return problems;
}

// The real plan of the day. `read` now writes `dependsOn: "talk"` (PLAN-012), so
// this assertion runs over a real edge — the ledger's own check is no longer
// vacuous. The helper (not a "nobody uses dependsOn" freeze) is the assertion.
assert(
  checkDependsOn(buildDailyPlan(defaultSettings, { date: "2026-08-26", dayIndex: 41, dueVocab: 0 })).length === 0,
  "the daily plan's dependsOn graph must be consistent",
);

// Probe 1: a dependsOn pointing at an id that does not exist must be flagged.
const probeMissing: DailyPlan = {
  date: "2026-08-26",
  dayIndex: 41,
  theme: "probe",
  targetedWeaknesses: [],
  activities: [
    {
      id: "talk",
      kind: "talk",
      title: "Conversation",
      rationale: "probe",
      estimatedMinutes: 5,
      status: "pending",
      dependsOn: "ghost", // no such activity
      producedSignalIds: [],
    },
  ],
  estimatedMinutes: 5,
};
assert(checkDependsOn(probeMissing).length > 0, "a dependsOn to a missing id must be flagged");

// Probe 2: a dependsOn pointing at an id that appears after the activity must be flagged.
const probeLater: DailyPlan = {
  date: "2026-08-26",
  dayIndex: 41,
  theme: "probe",
  targetedWeaknesses: [],
  activities: [
    {
      id: "talk",
      kind: "talk",
      title: "Conversation",
      rationale: "probe",
      estimatedMinutes: 5,
      status: "pending",
      dependsOn: "read", // read runs after talk — the dependency must come earlier
      producedSignalIds: [],
    },
    {
      id: "read",
      kind: "read",
      title: "Reading",
      rationale: "probe",
      estimatedMinutes: 5,
      status: "pending",
      producedSignalIds: [],
    },
  ],
  estimatedMinutes: 10,
};
assert(checkDependsOn(probeLater).length > 0, "a dependsOn to a later id must be flagged");

// The assertedIn verifier must not fool itself: a bad target has to be caught,
// or a broken existsSync/marker check would silently stay green forever.
assert(
  verifyAssertedIn([{ file: "src/lib/__does_not_exist__.check.ts", marker: "invariant 1" }]).length > 0,
  "the assertedIn verifier must catch a bad target",
);

// --- the ledger is complete: 27 rows, ids 1..27, no gaps, no duplicates -------
// The point of the register is that every claim in the spec is *countable*.
// Without this, deleting a row leaves the run green and the claim just vanishes.
assert.deepEqual(
  LEDGER.map((r) => r.id),
  Array.from({ length: 27 }, (_, i) => i + 1),
  "the ledger must carry spec \u00a75's 27 claims, in order, exactly once each",
);

// --- the bill: computed, never hardcoded --------------------------------------

const asserted = LEDGER.filter((r) => "assertedIn" in r || "owned" in r).length;
const pendingRows = LEDGER.filter((r): r is Extract<Row, { pending: string }> => "pending" in r);
const pendingIssues = pendingRows.filter((r) => r.pending.startsWith("#"));
const future = pendingRows.filter((r) => r.pending.startsWith("M1+")).length;
const issueRefs = pendingIssues.map((r) => r.pending.match(/^#\d+/)?.[0] ?? "").join(", ");
const pending = issueRefs ? `${pendingIssues.length} pending (${issueRefs})` : `${pendingIssues.length} pending`;

console.log(`invariants: ${asserted} asserted, ${pending}, ${future} out of scope (M1+)`);

// The repair ledger's bill — computed, never hardcoded. Only PLAN-027's rows (1-2)
// are asserted today; every later M6 plan moves its rows from pending to asserted.
const repairAsserted = REPAIR_LEDGER.filter((r) => "assertedIn" in r).length;
const repairPending = REPAIR_LEDGER.filter((r): r is Extract<RepairRow, { pending: string }> => "pending" in r).length;
console.log(`repair ledger: ${repairAsserted} asserted, ${repairPending} pending`);
console.log("invariants.check OK");
