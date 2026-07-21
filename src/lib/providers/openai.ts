import type { ChatMessage, ChatOpts, Provider } from "./types";
import { readLines, sseData } from "./stream";
import { postTuned } from "./http";

// OpenRouter and LM Studio speak the same /chat/completions dialect as OpenAI,
// so they're the same adapter with a different base URL (+ optional key).
// ponytail: one function, three providers — no reason to copy it thrice.
export function openai(
  model: string,
  apiKey: string,
  opts: {
    baseUrl?: string;
    label?: string;
    requireKey?: boolean;
    skipThinking?: boolean;
  } = {},
): Provider {
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const label = opts.label ?? "OpenAI";
  const requireKey = opts.requireKey ?? true;
  const skipThinking = opts.skipThinking ?? true;
  const isOpenRouter = label === "OpenRouter";
  return {
    async chat(messages: ChatMessage[], copts: ChatOpts = {}) {
      if (requireKey && !apiKey) throw new Error(`${label} API key is not set (Settings).`);
      const streaming = !!copts.onDelta;
      const res = await postTuned(
        `${baseUrl}/chat/completions`,
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        (tuned) => ({
          model,
          messages,
          temperature: copts.temperature ?? 0.7,
          response_format: copts.json ? { type: "json_object" } : undefined,
          stream: streaming || undefined,
          // One spelling each, never both: an unknown sibling parameter is a 400
          // on its own, which would cost the request the knob that did apply.
          // OpenRouter normalises `reasoning` across the models it fronts;
          // OpenAI and the local servers read `reasoning_effort`.
          max_tokens: tuned ? copts.maxTokens : undefined,
          ...(tuned ? (isOpenRouter ? { reasoning: { enabled: false } } : { reasoning_effort: "minimal" }) : {}),
        }),
        { cacheKey: `${label}:${model}`, tuned: skipThinking },
      );
      if (!res.ok) throw new Error(`${label} ${res.status}: ${await res.text()}`);
      if (!streaming) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? "";
      }
      // SSE. `delta.reasoning_content` (DeepSeek, OpenRouter) is deliberately
      // ignored alongside `delta.content` — thoughts are not the answer.
      let out = "";
      await readLines(res, (line) => {
        const chunk = sseData(line)?.choices?.[0]?.delta?.content;
        if (chunk) {
          out += chunk;
          copts.onDelta!(chunk);
        }
      });
      return out;
    },
  };
}
