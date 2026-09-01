// The chapter's timeline: pure arithmetic over per-line durations. No audio,
// no React — just cumulative spans and the couple of queries playback needs.
//
// Line boundaries are the only timing information that exists without forced
// alignment, so one span per line is the grain everywhere below. PLAN-026 will
// ask a question to name the range of audio its answer came from; that range is
// exactly the spans this file produces.
//
// All positions are seconds into the chapter. A span's `from` is the cumulative
// start of its line, `to` the cumulative end (exclusive).

export interface Span {
  line: number;
  from: number; // seconds into the chapter where this line begins
  to: number; // …and where it ends
}

/** Line durations → cumulative spans. `[]` for an empty chapter. */
export function spans(durations: number[]): Span[] {
  let t = 0;
  return durations.map((d, line) => {
    const s: Span = { line, from: t, to: t + d };
    t += d;
    return s;
  });
}

/**
 * Which line a position falls in. A position exactly on a boundary belongs to the
 * *later* line — the boundary is where line n stops and n+1 starts. -1 before the
 * start; the last line past the end (never beyond it).
 */
export function lineAt(spans: Span[], t: number): number {
  if (!spans.length) return -1;
  if (t < spans[0].from) return -1;
  let idx = 0;
  for (let i = 0; i < spans.length; i++) {
    if (t >= spans[i].from) idx = i;
    else break;
  }
  return idx;
}

/**
 * Clamp a seek into the chapter and answer where playback should resume. A value
 * before the start lands at line 0 offset 0; past the end clamps to the last
 * line's end (the final span's `to`, never beyond it).
 */
export function seek(spans: Span[], t: number): { line: number; offset: number } {
  if (!spans.length) return { line: -1, offset: 0 };
  const last = spans[spans.length - 1];
  const clamped = Math.min(Math.max(t, 0), last.to);
  const line = lineAt(spans, clamped);
  return { line, offset: clamped - spans[line].from };
}

/** t − 10, floored at 0 (a seek can't go negative), and the line/offset it lands in. */
export function back10(spans: Span[], t: number): { line: number; offset: number } {
  return seek(spans, t - 10);
}
