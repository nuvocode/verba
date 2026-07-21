import { fetch } from "@tauri-apps/plugin-http";
import type { ChatMessage, ChatOpts, Provider } from "./types";
import { readLines } from "./stream";
import { postTuned } from "./http";

/** Is a local Ollama answering? Used by onboarding to tell the learner where the AI runs. */
export async function ollamaUp(host = "http://localhost:11434"): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/tags`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ollama local server. Offline-capable. Default endpoint localhost:11434. */
export function ollama(model: string, host = "http://localhost:11434", skipThinking = true): Provider {
  return {
    async chat(messages: ChatMessage[], opts: ChatOpts = {}) {
      const streaming = !!opts.onDelta;
      // `think: false` is accepted by every model, including those with no
      // thinking to switch off; `think: true` is the one a plain model rejects.
      const res = await postTuned(
        `${host}/api/chat`,
        { "Content-Type": "application/json" },
        (tuned) => ({
          model,
          messages,
          stream: streaming,
          format: opts.json ? "json" : undefined,
          options: {
            temperature: opts.temperature ?? 0.7,
            num_predict: tuned ? opts.maxTokens : undefined,
          },
          think: tuned ? false : undefined,
        }),
        { cacheKey: `ollama:${model}`, tuned: skipThinking },
      );
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
      if (!streaming) {
        const data = await res.json();
        return data.message?.content ?? "";
      }
      // Newline-delimited JSON, one object per token-ish chunk. A thinking model
      // puts its reasoning in `message.thinking` and only the answer in
      // `message.content`, so reading content alone drops the thoughts for free.
      let out = "";
      let failed = "";
      await readLines(res, (line) => {
        let d: any;
        try {
          d = JSON.parse(line);
        } catch {
          return; // not a frame we understand — the next one probably is
        }
        if (d.error) failed = String(d.error);
        const chunk = d.message?.content ?? "";
        if (chunk) {
          out += chunk;
          opts.onDelta!(chunk);
        }
      });
      // Ollama reports a mid-stream failure in the body, after a 200 header.
      if (failed) throw new Error(`Ollama: ${failed}`);
      return out;
    },
  };
}
