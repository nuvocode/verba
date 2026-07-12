import { fetch } from "@tauri-apps/plugin-http";
import type { ChatMessage, ChatOpts, Provider } from "./types";

// OpenRouter and LM Studio speak the same /chat/completions dialect as OpenAI,
// so they're the same adapter with a different base URL (+ optional key).
// ponytail: one function, three providers — no reason to copy it thrice.
export function openai(
  model: string,
  apiKey: string,
  opts: { baseUrl?: string; label?: string; requireKey?: boolean } = {},
): Provider {
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const label = opts.label ?? "OpenAI";
  const requireKey = opts.requireKey ?? true;
  return {
    async chat(messages: ChatMessage[], copts: ChatOpts = {}) {
      if (requireKey && !apiKey) throw new Error(`${label} API key is not set (Settings).`);
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: copts.temperature ?? 0.7,
          response_format: copts.json ? { type: "json_object" } : undefined,
        }),
      });
      if (!res.ok) throw new Error(`${label} ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}
