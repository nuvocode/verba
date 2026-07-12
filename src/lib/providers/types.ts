export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatOpts {
  /** Ask the provider to return a strict JSON object. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface Provider {
  /** Send messages, get the model's raw text back (a JSON string when opts.json). */
  chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string>;
}
