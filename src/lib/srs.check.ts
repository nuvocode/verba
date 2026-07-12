// Runnable check: `node --experimental-strip-types src/lib/srs.check.ts`
import assert from "node:assert";
import { schedule, newCard, DAY_MS } from "./srs.ts";

const now = 1_000_000_000_000;

// "good" on a new card -> 1 day, reps 1
let c = schedule(newCard, 1, now);
assert.equal(c.reps, 1);
assert.equal(c.interval, 1);
assert.equal(c.due, now + DAY_MS);

// second "good" -> 3 days
c = schedule(c, 1, now);
assert.equal(c.interval, 3);
assert.equal(c.due, now + 3 * DAY_MS);

// third "good" -> interval grows by ease (~2.48 -> round(3*2.48)=7)
c = schedule(c, 1, now);
assert.ok(c.interval >= 6 && c.interval <= 8, `interval ${c.interval}`);

// "again" resets and reschedules in 10 minutes
const f = schedule(c, 0, now);
assert.equal(f.reps, 0);
assert.equal(f.interval, 0);
assert.equal(f.due, now + 10 * 60 * 1000);
assert.ok(f.ease >= 1.3);

console.log("srs.check OK");
