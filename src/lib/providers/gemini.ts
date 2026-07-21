import type { ChatMessage, ChatOpts, Provider } from "./types";
import { readLines, sseData } from "./stream";
import { postTuned } from "./http";

// Google Gemini via the Generative Language REST API. Different envelope from
// OpenAI: a `contents` array of {role, parts}, system prompt hoisted into
// `systemInstruction`, and "assistant" is spelled "model".
export function gemini(model: string, apiKey: string, skipThinking = true): Provider {
  return {
    async chat(messages: ChatMessage[], opts: ChatOpts = {}) {
      if (!apiKey) throw new Error("Gemini API key is not set (Settings).");
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

      const streaming = !!opts.onDelta;
      // Streaming is a different method on this API, and only speaks SSE when asked.
      const method = streaming ? "streamGenerateContent?alt=sse" : "generateContent";
      const res = await postTuned(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`,
        { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        (tuned) => ({
          contents,
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          generationConfig: {
            temperature: opts.temperature ?? 0.7,
            responseMimeType: opts.json ? "application/json" : undefined,
            maxOutputTokens: tuned ? opts.maxTokens : undefined,
            // A zero budget is how the Flash tier is told not to think. The Pro
            // tier refuses to go below its minimum and answers 400, which is
            // exactly the case postThinkable retries without this.
            thinkingConfig: tuned ? { thinkingBudget: 0 } : undefined,
          },
        }),
        { cacheKey: `gemini:${model}`, tuned: skipThinking },
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      if (!streaming) {
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
      }
      let out = "";
      await readLines(res, (line) => {
        const parts = sseData(line)?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return;
        // A 2.5-series model interleaves its thoughts as parts flagged `thought`.
        // They are not the answer, and showing them to a learner would be noise.
        const chunk = parts
          .filter((p: any) => !p.thought)
          .map((p: any) => p.text ?? "")
          .join("");
        if (chunk) {
          out += chunk;
          opts.onDelta!(chunk);
        }
      });
      return out;
    },
  };
}
