// Runnable check: `node --experimental-strip-types src/lib/srs.check.ts`
import assert from "node:assert";
import { schedule, newCard, DAY_MS, DAILY_REVIEW_CAP, strength } from "./srs.ts";

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

// invariant 14: a review moves the card. Same card, same clock, different schedule.
const before = { ease: 2.5, interval: 3, reps: 2, lapses: 0 };
const after = schedule(before, 1, now);
assert.notEqual(after.interval, before.interval, "a good review must change the interval");
assert.notEqual(after.due, now, "a good review must park the card in the future");

// lapses only ever count up, and only on a miss.
assert.equal(schedule(before, 1, now).lapses, 0, "a good review is not a lapse");
assert.equal(schedule(before, 2, now).lapses, 0, "an easy review is not a lapse");
assert.equal(schedule(before, 0, now).lapses, 1, "a miss is a lapse");
assert.equal(schedule(schedule(before, 0, now), 0, now).lapses, 2, "lapses accumulate");

// invariant 13: a deck that has been reviewed is not a deck that is all due. Ten
// cards graded on the same day come back on ten different schedules, and none of
// them today — if they were all due again, the scheduler is not writing.
const deck = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => schedule({ ease: 2.5, interval: n, reps: n, lapses: 0 }, 1, now));
assert.equal(deck.filter((c) => c.due <= now).length, 0, "invariant 13: nothing is due the moment it was reviewed");
assert(new Set(deck.map((c) => c.due)).size > 1, "invariant 13: a reviewed deck comes back spread out, not all at once");

// The day's ask is capped, and the backlog is not the ask.
assert.equal(DAILY_REVIEW_CAP, 20, "the default daily cap is 20 (§2.5)");

// strength reads both fields of the schedule, so two cards parked equally long
// but returning differently do not draw the same bar.
const solid = strength({ interval: 21, ease: 2.5 });
const shaky = strength({ interval: 21, ease: 1.3 });
assert(solid > shaky, "ease has to move the bar, or every mature card looks identical");
assert(strength({ interval: 0, ease: 2.5 }) < strength({ interval: 10, ease: 2.5 }), "interval has to move it too");
assert(strength({ interval: 999, ease: 2.5 }) <= 1 && strength({ interval: 0, ease: 1.3 }) >= 0.05, "bars stay in 0.05..1");

console.log("srs.check OK");
