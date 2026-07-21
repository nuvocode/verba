import { fetch } from "@tauri-apps/plugin-http";

/**
 * Models that turned out not to accept the tuning knobs, keyed by
 * provider:model. Remembered for the life of the process so one rejected
 * request is the whole cost of finding out.
 */
const plainOnly = new Set<string>();

/**
 * POST a JSON body whose optional tuning knobs — skip the reasoning pass, cap
 * the reply length — the model may or may not accept.
 *
 * Every provider spells them differently and none accepts them across its whole
 * model range: Gemini's Pro tier will not turn thinking off, OpenAI takes
 * `reasoning_effort` only on models that reason and refuses `max_tokens` on
 * exactly those. All of them answer an unwanted knob with a 400 rather than
 * ignoring it. Rather than keep a table of model names in sync with four
 * vendors, ask once and believe the answer: a 400 on the first attempt is
 * retried with the knobs off, and that model is not asked again.
 *
 * The knobs go together because they fail together — a request rejected for one
 * tells us nothing about the other, and one retry is cheaper than two. Losing
 * them costs speed, never correctness: a model that ignores the cap writes a
 * longer answer, and one that thinks anyway gives a slower but better one.
 *
 * `build` is called with whether to include them, so each adapter keeps its own
 * spelling.
 */
export async function postTuned(
  url: string,
  headers: Record<string, string>,
  build: (tuned: boolean) => unknown,
  opts: { cacheKey: string; tuned: boolean },
): Promise<Response> {
  const ask = opts.tuned && !plainOnly.has(opts.cacheKey);
  const send = (tuned: boolean) => fetch(url, { method: "POST", headers, body: JSON.stringify(build(tuned)) });

  const res = await send(ask);
  if (res.ok || !ask || res.status !== 400) return res;

  // A 400 on the one request that differs from the plain one: assume a knob is
  // what it objected to. If something else was wrong, the retry says so in the
  // provider's own words, which is the error the caller wanted anyway.
  plainOnly.add(opts.cacheKey);
  return send(false);
}
