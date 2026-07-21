/**
 * Shared plumbing for the streaming branch of every adapter.
 *
 * All four providers stream line-oriented text — Ollama as newline-delimited
 * JSON, the other three as SSE — so the only thing that differs between them is
 * where the text sits inside each line's payload.
 */

/**
 * Feed a streaming response to `onLine`, one complete line at a time.
 *
 * The reader hands back arbitrary byte chunks, so a line can be split across
 * two of them and a multi-byte character across three; the buffer and the
 * streaming decoder exist to make both invisible to the caller.
 */
export async function readLines(res: Response, onLine: (line: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Response carried no body to stream.");
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    }
    // A last line with no trailing newline is still a line.
    const tail = buf.trim();
    if (tail) onLine(tail);
  } finally {
    // Releasing matters more here than in a browser: the body is a Tauri IPC
    // resource on the Rust side, and an abandoned one is a leak until exit.
    reader.releaseLock();
    await res.body?.cancel().catch(() => {});
  }
}

/**
 * The JSON payload of an SSE `data:` line, or null for anything else — comments,
 * `event:` lines, the terminal `[DONE]`, and half-written frames.
 */
export function sseData(line: string): any | null {
  if (!line.startsWith("data:")) return null;
  const body = line.slice(5).trim();
  if (!body || body === "[DONE]") return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
