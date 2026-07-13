import { fetch } from "@tauri-apps/plugin-http";

/** Local servers we can interrogate for a model list. Cloud providers are typed by hand in Settings. */
export type LocalProvider = "ollama" | "lmstudio";

/**
 * What a local server is actually serving. `null` means it never answered — that is a
 * different thing from an empty list (running, but no models pulled), and onboarding
 * says a different sentence for each.
 */
export async function listModels(provider: LocalProvider, host: string): Promise<string[] | null> {
  const base = host.replace(/\/$/, "");
  try {
    const res = await fetch(provider === "ollama" ? `${base}/api/tags` : `${base}/models`, { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json();
    const names: unknown[] =
      provider === "ollama"
        ? (data.models ?? []).map((m: any) => m?.name)
        : (data.data ?? []).map((m: any) => m?.id);
    return names.filter((n): n is string => typeof n === "string" && !!n).sort();
  } catch {
    return null;
  }
}

/**
 * Is an OpenAI-compatible server answering at all? Used for the speech servers,
 * where — unlike a chat provider — we never pick from the model list, so a plain
 * yes/no is the whole question. A wrong URL must fail fast, not hang the settings
 * page, hence the timeout.
 */
export async function reachable(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  if (!baseUrl.trim()) return false;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
