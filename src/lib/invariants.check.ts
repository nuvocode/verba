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
    pending: "M1+ (İçerik üretimi)",
  },
  {
    id: 18,
    claim: "Not sayısı ≤ cümle sayısı / 2.",
    pending: "M1+ (İçerik üretimi)",
  },
  {
    id: 19,
    claim: "Read notları Talk'un düzeltme şemasını kullanmaz.",
    pending: "M1+ (İçerik üretimi)",
  },
  {
    id: 20,
    claim: "Kalite kapılarından geçmemiş içerik gösterilmez.",
    pending: "M1+ (İçerik üretimi)",
  },
  {
    id: 21,
    claim: 'Bir pasaj "yeniden kullanım" iddiasıyla üretildiyse hedef kelimelerin ≥ %50\'sini içerir.',
    pending: "M1+ (İçerik üretimi)",
  },
  {
    id: 22,
    claim: "Ham model çıktısı (JSON, stack trace) hiçbir kullanıcı yüzeyinde görünmez.",
    pending: "M1+ (Arayüz)",
  },
  {
    id: 23,
    claim: "Ekranda ilan edilen kısayol sayısı === çalışan kısayol sayısı.",
    pending: "M1+ (Arayüz)",
  },
  {
    id: 24,
    claim: '`Esc` her yüzeyde "bir seviye yukarı" anlamındadır.',
    pending: "M1+ (Arayüz)",
  },
  {
    id: 25,
    claim: "Aynı bilgi aynı anda iki yerde gösterilmez.",
    pending: "M1+ (Arayüz)",
  },
  {
    id: 26,
    claim: "Ölçüm başlamadan hiçbir ölçüm değeri gösterilmez.",
    pending: "M1+ (Arayüz)",
  },
  {
    id: 27,
    claim: "Her yüzey dört durumu (yükleniyor / boş / hata / bozuk içerik) uygular.",
    pending: "M1+ (Arayüz)",
  },
];

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
console.log("invariants.check OK");
