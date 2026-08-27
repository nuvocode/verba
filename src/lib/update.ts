import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * The webview's half of in-app updates. Everything real happens in Rust
 * (src-tauri/src/update.rs) — this file only names the commands and remembers
 * what the launch check found, so the Settings badge and the Data panel can both
 * read it without either owning it.
 */

export interface Available {
  version: string;
  notes: string;
}

export type Progress =
  | { step: "downloading"; received: number; total: number | null }
  | { step: "installing" };

/** False on a .deb or .rpm, where the package manager owns the app (#24). */
export const canUpdate = () => invoke<boolean>("can_update");

/** Ask the channel's manifest what it has. Parks the update in Rust if it finds one. */
export async function check(beta: boolean): Promise<Available | null> {
  found = await invoke<Available | null>("fetch_update", { beta });
  return found;
}

/**
 * Downloads and installs the parked update, then restarts. This promise never
 * resolves on success — the process is replaced mid-await — so the last thing
 * the caller hears is a `step: "installing"` progress event.
 */
export async function install(onProgress: (p: Progress) => void): Promise<void> {
  const channel = new Channel<Progress>();
  channel.onmessage = onProgress;
  await invoke("install_update", { onEvent: channel });
}

let found: Available | null = null;
let launchChecked = false;

/** What the last check found, if anything. */
export const pending = (): Available | null => found;

/**
 * One quiet check per launch, and only when the learner has not asked the app to
 * stay off the network. It is deliberately silent about everything: no dialog to
 * dismiss, and a failure — no network, GitHub down, a manifest half-written — is
 * swallowed, because none of that is worth interrupting a session over. What it
 * finds shows up as a badge the next time Settings is opened.
 */
export async function checkOnLaunch(offline: boolean, beta: boolean): Promise<void> {
  if (launchChecked || offline) return;
  launchChecked = true;
  try {
    await check(beta);
  } catch {
    // Deliberately silent — see above.
  }
}
