import { fetch } from "@tauri-apps/plugin-http";
import type { ChatMessage, ChatOpts, Provider } from "./types";

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
          max_tokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.7,
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "";
      return opts.json ? "{" + text : text;
    },
  };
}
