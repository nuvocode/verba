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
  /**
   * Called with each piece of text as the model produces it. Passing it puts the
   * provider in streaming mode; `chat()` still resolves to the whole answer, so
   * the deltas are an extra, not a replacement — concatenating every delta gives
   * back exactly the resolved string.
   *
   * Only worth passing where a learner is watching the text land. A turn is
   * mostly correction and suggestion JSON the learner never sees, so waiting for
   * the last byte means waiting roughly four times longer than the reply needs.
   */
  onDelta?: (chunk: string) => void;
}

export interface Provider {
  /** Send messages, get the model's raw text back (a JSON string when opts.json). */
  chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string>;
}
