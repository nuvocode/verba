import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { sync, type SyncResult } from "./lib/vault";

/**
 * The sync folder is reconciled *before* React exists, and that ordering is the
 * whole reason this file has any logic in it.
 *
 * A pull replaces settings, packs and every table. Do it after mounting and the
 * app has already read the old settings into state, already asked the day
 * planner to write today's plan, already opened screens against rows that are
 * about to be deleted — and the only way out is a reload the learner sees as a
 * flicker on every launch. Do it here and there is nothing to invalidate: the
 * first thing React reads is the restored data.
 */

/** The version in tauri.conf.json, asked of Tauri rather than duplicated in the bundle. */
async function appVersion(): Promise<string> {
  try {
    return await (await import("@tauri-apps/api/app")).getVersion();
  } catch {
    return "unknown"; // a plain browser dev server has no Tauri to ask
  }
}

/**
 * A folder that is unreachable — an external drive left at home, an iCloud
 * directory that hasn't downloaded yet — must never be the reason Verba won't
 * open. The failure is carried into the app and shown there.
 */
async function boot(version: string): Promise<SyncResult & { error?: string }> {
  try {
    return await sync(version);
  } catch (e: any) {
    return { plan: "idle", error: String(e?.message ?? e) };
  }
}

void appVersion().then(async (version) => {
  const result = await boot(version);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App appVersion={version} boot={result} />
    </React.StrictMode>,
  );
});
