import { fetch } from "@tauri-apps/plugin-http";
import type { ChatMessage, ChatOpts, Provider } from "./types";
import { readLines, sseData } from "./stream";

// No thinking knob here: Anthropic's extended thinking is opt-in, so a model
// only reasons when asked to and this adapter never asks.
export function anthropic(model: string, apiKey: string): Provider {
  return {
    async chat(messages: ChatMessage[], opts: ChatOpts = {}) {
      if (!apiKey) throw new Error("Anthropic API key is not set (Settings).");
      // Anthropic takes system separately from the user/assistant turns.
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const turns = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      // JSON: prefill an opening brace so the model must continue a JSON object.
      if (opts.json) turns.push({ role: "assistant", content: "{" });

      const streaming = !!opts.onDelta;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system,
          messages: turns,
          // Anthropic requires a ceiling, so this is the one provider that
          // cannot simply leave the length open. 1024 was too low to be a
          // safety net: a 20-sentence reading passage measures ~1020 tokens of
          // JSON, so the longest thing Verba asks for was landing on the limit
          // and coming back cut in half. The cap is here to stop a runaway, not
          // to shape the answer — anything Verba actually wants fits well under.
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.7,
          stream: streaming || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
      if (!streaming) {
        const data = await res.json();
        const text = data.content?.[0]?.text ?? "";
        return opts.json ? "{" + text : text;
      }
      // The prefilled brace is not echoed back by the model, so it has to lead
      // the stream too — otherwise a caller accumulating deltas sees different
      // text from what chat() resolves to, and its JSON starts a brace short.
      let out = "";
      if (opts.json) {
        out = "{";
        opts.onDelta!("{");
      }
      await readLines(res, (line) => {
        const d = sseData(line);
        // `thinking_delta` blocks arrive on this same stream and are skipped:
        // only `text_delta` is the answer.
        const chunk = d?.type === "content_block_delta" ? d.delta?.text : undefined;
        if (chunk) {
          out += chunk;
          opts.onDelta!(chunk);
        }
      });
      return out;
    },
  };
}
