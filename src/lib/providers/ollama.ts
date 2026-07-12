import { fetch } from "@tauri-apps/plugin-http";
import type { ChatMessage, ChatOpts, Provider } from "./types";

/** Ollama local server. Offline-capable. Default endpoint localhost:11434. */
export function ollama(model: string, host = "http://localhost:11434"): Provider {
  return {
    async chat(messages: ChatMessage[], opts: ChatOpts = {}) {
      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          format: opts.json ? "json" : undefined,
          options: { temperature: opts.temperature ?? 0.7 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data.message?.content ?? "";
    },
  };
}
