import type { Provider } from "./types";
import type { Settings } from "../settings";
import { ollama } from "./ollama";
import { openai } from "./openai";
import { anthropic } from "./anthropic";
import { gemini } from "./gemini";

export type { Provider, ChatMessage } from "./types";

export function getProvider(s: Settings): Provider {
  switch (s.provider) {
    case "openai":
      return openai(s.openaiModel, s.openaiKey);
    case "anthropic":
      return anthropic(s.anthropicModel, s.anthropicKey);
    case "gemini":
      return gemini(s.geminiModel, s.geminiKey);
    case "openrouter":
      return openai(s.openrouterModel, s.openrouterKey, {
        baseUrl: "https://openrouter.ai/api/v1",
        label: "OpenRouter",
      });
    case "lmstudio":
      // Local OpenAI-compatible server — no key required.
      return openai(s.lmstudioModel, "", { baseUrl: s.lmstudioHost, label: "LM Studio", requireKey: false });
    case "ollama":
    default:
      return ollama(s.ollamaModel, s.ollamaHost);
  }
}
