// Runnable self-check for the chapter timeline (src/lib/timeline.ts): the pure
// arithmetic playback needs — cumulative spans, line lookup, clamped seeking and
// back-10s — held to their boundary cases.
// Run: node --experimental-strip-types src/lib/timeline.check.ts
import assert from "node:assert";
import { back10, lineAt, seek, spans } from "./timeline.ts";

// --- spans: line durations → cumulative { line, from, to } ---
assert.deepEqual(spans([3, 4, 3]), [
  { line: 0, from: 0, to: 3 },
  { line: 1, from: 3, to: 7 },
  { line: 2, from: 7, to: 10 },
], "spans accumulates the durations into from/to ranges");

// --- lineAt ---
{
  const s = spans([3, 4, 3]);
  assert.equal(lineAt(s, 0), 0, "the first instant is the first line");
  assert.equal(lineAt(s, 2.9), 0, "just before the first boundary is still line 0");
  assert.equal(lineAt(s, 3), 1, "a boundary belongs to the later line");
  assert.equal(lineAt(s, 7), 2, "the second boundary belongs to the last line");
  assert.equal(lineAt(s, 100), 2, "past the end lands on the last line, not beyond");
  assert.equal(lineAt(s, -5), -1, "before the start is -1");
}
assert.equal(lineAt(spans([]), 0), -1, "an empty chapter has no line to land on");

// --- seek ---
{
  const s = spans([3, 4, 3]);
  assert.deepEqual(seek(s, 4.5), { line: 1, offset: 1.5 }, "a mid-line seek resumes in-line");
  assert.deepEqual(seek(s, 0), { line: 0, offset: 0 }, "the start is line 0 offset 0");
  assert.deepEqual(seek(s, 3), { line: 1, offset: 0 }, "a boundary seek starts the later line");
  assert.deepEqual(seek(s, 100), { line: 2, offset: 3 }, "past the end clamps to the last line's end, not past it");
  assert.deepEqual(seek(s, -2), { line: 0, offset: 0 }, "a negative seek is floored at the start");
  assert.deepEqual(seek(s, 10), { line: 2, offset: 3 }, "exactly the final boundary is the last line's end");
}
assert.deepEqual(seek(spans([]), 0), { line: -1, offset: 0 }, "an empty chapter seeks to nothing");

// --- back10 ---
{
  const s = spans([3, 4, 3]);
  assert.deepEqual(back10(s, 4), { line: 0, offset: 0 }, "back 10 from 4s floors at 0");
  assert.deepEqual(back10(s, 12), { line: 0, offset: 2 }, "back 10 from 12s → 2s → line 0 offset 2");
  assert.deepEqual(back10(s, 9), { line: 0, offset: 0 }, "9 − 10 = −1, floored to 0");
  assert.deepEqual(back10(s, 20), { line: 2, offset: 3 }, "back 10 from 20s → 10s → the last line's end");
  assert.deepEqual(back10(s, 6), { line: 0, offset: 0 }, "6 − 10 = −4 → 0");
  assert.deepEqual(back10(s, 14), { line: 1, offset: 1 }, "back 10 from 14s → 4s → line 1 offset 1");
}
assert.deepEqual(back10(spans([]), 0), { line: -1, offset: 0 }, "back 10 on an empty chapter survives");

console.log("timeline.check: ok");
