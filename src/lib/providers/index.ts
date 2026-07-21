import type { Provider } from "./types";
import type { Settings } from "../settings";
import { ollama } from "./ollama";
import { openai } from "./openai";
import { anthropic } from "./anthropic";
import { gemini } from "./gemini";

export type { Provider, ChatMessage } from "./types";

export function getProvider(s: Settings): Provider {
  // Only ever asked of a model that reasons by default, and only to switch it
  // off — no adapter asks a model to start thinking, because the ones that
  // can't reject the request outright.
  const skipThinking = !s.thinking;
  switch (s.provider) {
    case "openai":
      return openai(s.openaiModel, s.openaiKey, { skipThinking });
    case "anthropic":
      return anthropic(s.anthropicModel, s.anthropicKey);
    case "gemini":
      return gemini(s.geminiModel, s.geminiKey, skipThinking);
    case "openrouter":
      return openai(s.openrouterModel, s.openrouterKey, {
        baseUrl: "https://openrouter.ai/api/v1",
        label: "OpenRouter",
        skipThinking,
      });
    case "lmstudio":
      // Local OpenAI-compatible server — no key required.
      return openai(s.lmstudioModel, "", {
        baseUrl: s.lmstudioHost,
        label: "LM Studio",
        requireKey: false,
        skipThinking,
      });
    case "ollama":
    default:
      return ollama(s.ollamaModel, s.ollamaHost, skipThinking);
  }
}
