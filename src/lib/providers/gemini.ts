import { fetch } from "@tauri-apps/plugin-http";
import type { ChatMessage, ChatOpts, Provider } from "./types";

// Google Gemini via the Generative Language REST API. Different envelope from
// OpenAI: a `contents` array of {role, parts}, system prompt hoisted into
// `systemInstruction`, and "assistant" is spelled "model".
export function gemini(model: string, apiKey: string): Provider {
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

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents,
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            generationConfig: {
              temperature: opts.temperature ?? 0.7,
              responseMimeType: opts.json ? "application/json" : undefined,
            },
          }),
        },
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    },
  };
}
