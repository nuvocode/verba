// Runnable check: `node --experimental-strip-types src/lib/states.check.ts`
//
// The state table: the registry of every row in
// docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §7 — the situations a learner
// can land in, and the exit each one owes them. A row is either claimed by a
// marker comment in a *.check.ts (assertedIn) or not yet built (pending, with
// the issue that builds it).
//
// The point of a register is that a claim is *countable*. Without it, a state
// nobody implemented is indistinguishable from one nobody wrote down — and the
// spec's promise is precisely that there is no such state: "Hiçbir durum
// kullanıcıyı çıkışsız bırakmaz."
//
// The two remaining bullets of #43 — designed empty states, and destructive
// actions that count what is lost — belong to the screens that carry them
// (#36, #40, #41) and are asserted there, not here. Privacy's share of that is
// done: the wipe's confirmation counts what it removes, and backup.check holds
// the wipe to emptying every table it counted.
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

type Row =
  | { id: number; state: string; answer: string; assertedIn: { file: string; marker: string }[] }
  | { id: number; state: string; answer: string; pending: string }; // "#<issue> — <what is missing>"

const TABLE: Row[] = [
  {
    id: 1,
    state: "Çevrimdışı kilidi açık, bulut model seçili",
    answer: "Değişiklik engellenir, yerel alternatif önerilir",
    assertedIn: [{ file: "src/lib/rules.check.ts", marker: "state 1" }],
  },
  {
    id: 2,
    state: "Model yanıt vermiyor",
    answer: "Ana ekranda uyarı + sına düğmesi + model değiştir yolu",
    assertedIn: [{ file: "src/lib/models.check.ts", marker: "state 2" }],
  },
  {
    id: 3,
    state: "Seçili ses indirilmemiş",
    answer: "Otomatik olarak paketli sese düşülür, bu söylenir",
    assertedIn: [{ file: "src/lib/speech.check.ts", marker: "state 3" }],
  },
  {
    id: 4,
    state: "Mikrofon izni yok",
    answer: "Konuşma bölümü nedeni yazar, izne giden yolu gösterir",
    assertedIn: [{ file: "src/lib/speech.check.ts", marker: "state 4" }],
  },
  {
    id: 5,
    state: "Hedef dil = ana dil denemesi",
    answer: "Uygulanmaz, hangisinin değişeceği sorulur",
    assertedIn: [{ file: "src/lib/rules.check.ts", marker: "state 5" }],
  },
  {
    id: 6,
    state: "Eşitleme klasörü erişilemiyor",
    answer: "Son başarılı yazma zamanı + neden + yeniden seç",
    assertedIn: [{ file: "src/lib/backup.check.ts", marker: "state 6" }],
  },
  {
    id: 7,
    state: "İçe aktarılan dosya geçersiz",
    answer: "Ne beklendiği yazılır, mevcut veri korunur",
    assertedIn: [{ file: "src/lib/backup.check.ts", marker: "state 7" }],
  },
  {
    id: 8,
    state: "Plan günlük süre hedefine ulaşamıyor",
    answer: "Ana ekranda nedeni yazılır",
    assertedIn: [{ file: "src/lib/learn.check.ts", marker: "state 8" }],
  },
  {
    id: 9,
    state: "Dil paketi eksik/bozuk",
    answer: "Hangi özelliğin çalışmayacağı yazılır, uygulama açık kalır",
    assertedIn: [{ file: "src/lib/lang.check.ts", marker: "state 9" }],
  },
];

/** Problems with a row's assertedIn targets — empty when every one holds. */
function verifyAssertedIn(targets: { file: string; marker: string }[]): string[] {
  const problems: string[] = [];
  for (const { file, marker } of targets) {
    const abs = fileURLToPath(new URL(file, ROOT));
    if (!existsSync(abs)) {
      problems.push(`missing file ${file}`);
      // `(?!\d)` so "state 1" is not satisfied by a file whose only marker is
      // "state 10" — a plain .includes() would call that row proven.
    } else if (!new RegExp(`${marker}(?!\\d)`).test(readFileSync(abs, "utf8"))) {
      problems.push(`${file} is missing marker "${marker}"`);
    }
  }
  return problems;
}

const unverified: string[] = [];
for (const row of TABLE) if ("assertedIn" in row) unverified.push(...verifyAssertedIn(row.assertedIn));
assert(unverified.length === 0, "states.check: unverified assertedIn targets:\n" + unverified.join("\n"));

// The verifier must not fool itself: a bad target has to be caught, or a broken
// existsSync/marker test would leave every row green forever.
assert(
  verifyAssertedIn([{ file: "src/lib/__does_not_exist__.check.ts", marker: "state 1" }]).length > 0,
  "the assertedIn verifier must catch a bad target",
);

// Every pending row names the issue that closes it. A pending row without one is
// a state that has quietly left the plan.
for (const row of TABLE)
  if ("pending" in row) assert.match(row.pending, /^#\d+ — \S/, `state ${row.id} must name the issue that builds it`);

// The table is complete: §7's 9 rows, in order, exactly once each. Deleting a row
// must fail the run rather than quietly shrinking the promise.
assert.deepEqual(
  TABLE.map((r) => r.id),
  Array.from({ length: 9 }, (_, i) => i + 1),
  "the table must carry spec §7's 9 states, in order, exactly once each",
);

// Every row says what the state is and what the learner gets — an exit-less row
// is the one thing §7 forbids.
for (const row of TABLE) {
  assert(row.state.trim().length > 0, `state ${row.id} must name the situation`);
  assert(row.answer.trim().length > 0, `state ${row.id} must name the way out`);
}

const asserted = TABLE.filter((r) => "assertedIn" in r).length;
const pending = TABLE.filter((r): r is Extract<Row, { pending: string }> => "pending" in r);
const refs = [...new Set(pending.map((r) => r.pending.match(/^#\d+/)?.[0] ?? ""))].join(", ");
console.log(`states: ${asserted} of ${TABLE.length} answered, ${pending.length} pending (${refs})`);
console.log("states.check ✓");
