import { useEffect, useState } from "react";
import { AT } from "../lib/rules";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { collect, parseBackup, restore, suggestedFilename, summarize, type Backup, type Summary } from "../lib/backup";
import { canUpdate, check, install, pending as pendingUpdate, type Available, type Progress } from "../lib/update";
import {
  attach,
  detach,
  markDirty,
  pickFolder,
  pull,
  push,
  resolve,
  state,
  sync,
  vaultDir,
  type Meta,
} from "../lib/vault";

/**
 * Settings → Data: the panel where the learner's history stops being trapped
 * inside one machine.
 *
 * Two features, one file, because they are the same file format seen twice: an
 * export is a snapshot taken by hand, and a sync folder is a snapshot that keeps
 * itself current. Anything written by one can be read by the other.
 *
 * Every operation here can replace a year of work, so none of them happen on a
 * single click — a restore states what it is about to install and what it is
 * about to remove, and a folder that already holds data asks which side wins
 * rather than picking one.
 */

const when = (t: number) => (t ? new Date(t).toLocaleString() : "never");

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** "12 conversations · 340 words · 8 passages" — the line a decision is actually made from. */
function counts(s: Summary): string {
  const parts: [number, string][] = [
    [s.conversations, "conversation"],
    [s.words, "word"],
    [s.passages, "passage"],
    [s.listening, "listening session"],
    [s.days, "day"],
    [s.memories, "note"],
  ];
  const said = parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`);
  return said.length ? said.join(" · ") : "nothing yet";
}

export default function DataPanel({
  appVersion,
  offline,
  beta,
  onBeta,
}: {
  appVersion: string;
  offline: boolean;
  beta: boolean;
  onBeta: (on: boolean) => void;
}) {
  const [dir, setDir] = useState(vaultDir());
  const [sync_, setSync_] = useState(state());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // ---- updates ----

  /** False on a .deb or .rpm: the package manager owns the app there. */
  const [selfUpdating, setSelfUpdating] = useState(true);
  const [found, setFound] = useState<Available | null>(pendingUpdate());
  const [checking, setChecking] = useState(false);
  /** Only true after a check the learner asked for — "up to date" is an answer
   *  to a question, and saying it unprompted claims more than the app knows. */
  const [asked, setAsked] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [updateErr, setUpdateErr] = useState("");

  useEffect(() => {
    canUpdate()
      .then(setSelfUpdating)
      .catch(() => setSelfUpdating(true)); // a dev server has no Tauri to ask
  }, []);

  const checkNow = async () => {
    setChecking(true);
    setUpdateErr("");
    try {
      setFound(await check(beta));
      setAsked(true);
    } catch (e: any) {
      setUpdateErr(String(e?.message ?? e));
    } finally {
      setChecking(false);
    }
  };

  const installNow = async () => {
    setUpdateErr("");
    try {
      // Resolves only on failure — on success the process is replaced.
      await install(setProgress);
    } catch (e: any) {
      setUpdateErr(String(e?.message ?? e));
      setProgress(null);
    }
  };

  /** A backup file the learner opened, waiting on "yes, replace everything". */
  const [pending, setPending] = useState<{ backup: Backup; from: string } | null>(null);
  /** A folder that already holds data, waiting on which side wins. */
  const [both, setBoth] = useState<{ dir: string; meta: Meta; theirs: Summary; mine: Summary } | null>(null);

  // The folder can change underneath this panel — App syncs on launch, and a
  // background push lands while Settings is open. Re-read rather than cache.
  useEffect(() => {
    const t = setInterval(() => setSync_(state()), 2000);
    return () => clearInterval(t);
  }, []);

  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what);
    setErr("");
    setMsg("");
    try {
      const said = await fn();
      if (said) setMsg(said);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy("");
      setDir(vaultDir());
      setSync_(state());
    }
  };

  // ---- export / import a file ----

  const exportFile = () =>
    run("Exporting…", async () => {
      const path = await save({
        defaultPath: suggestedFilename(),
        filters: [{ name: "Verba backup", extensions: ["json"] }],
      });
      if (!path) return;
      const backup = await collect(appVersion);
      await invoke("file_write", { path, contents: JSON.stringify(backup) });
      return `Exported ${counts(summarize(backup))} to ${path}`;
    });

  const pickFile = () =>
    run("Reading…", async () => {
      const path = await open({ filters: [{ name: "Verba backup", extensions: ["json"] }], multiple: false });
      if (typeof path !== "string") return;
      const backup = parseBackup(await invoke<string>("file_read", { path }));
      setPending({ backup, from: path });
    });

  const doImport = () =>
    run("Restoring…", async () => {
      if (!pending) return;
      await restore(pending.backup);
      setPending(null);
      // A hand-fed import is a local change like any other: if this machine syncs
      // to a folder, the folder should learn about it rather than silently
      // disagreeing until the next conversation happens to mark things dirty.
      markDirty();
      reload();
    });

  // ---- the sync folder ----

  const choose = () =>
    run("Opening…", async () => {
      const picked = await pickFolder();
      if (!picked) return;

      const { meta, summary } = await attach(picked);
      const mine = summarize(await collect(appVersion));

      // An empty folder, or one this machine has nothing to lose to, needs no
      // question: publish and be done.
      if (!meta || !summary) {
        await push(appVersion);
        return `Syncing to ${picked}. Your data is now in that folder.`;
      }
      setBoth({ dir: picked, meta, theirs: summarize(summary), mine });
    });

  /** The learner's answer when both sides already had data. */
  const settle = (keep: "mine" | "theirs") =>
    run(keep === "mine" ? "Publishing…" : "Restoring…", async () => {
      if (!both) return;
      setBoth(null);
      if (keep === "mine") {
        await push(appVersion);
        return "The folder now holds this machine's data.";
      }
      await pull();
      reload();
    });

  const syncNow = () =>
    run("Syncing…", async () => {
      const r = await sync(appVersion);
      if (r.plan === "pull") return reload();
      if (r.plan === "conflict") return; // sync raised it; the app shell is already putting the dialog up
      return r.plan === "push" ? "Folder updated." : "Already up to date.";
    });

  const stop = () =>
    run("", async () => {
      detach();
      setDir("");
      return "Stopped syncing. The folder keeps its copy — nothing was deleted.";
    });

  return (
    <>
      {msg && (
        <div className="err" style={{ borderColor: "var(--good)", color: "var(--good)" }}>
          {msg}
        </div>
      )}
      {err && <div className="err">{err}</div>}

      <div className="sec">Your data</div>
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "14px 4px 4px" }}>
        Everything Verba knows — conversations, saved words and their review schedule, passages, daily plans, what the
        coach has written down, and your settings — is on this machine and nowhere else. These are the two ways to move
        it.
      </div>
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "0 4px 16px" }}>
        A backup file includes your API keys, so treat it like one. Downloaded speech models are not included; they are
        hundreds of megabytes and a restored machine re-downloads the ones it needs.
      </div>

      <div className="field" style={{ borderBottom: "1px solid var(--line2)", paddingBottom: 20, marginBottom: 28 }}>
        <button className="btn sm ghost" onClick={exportFile} disabled={!!busy}>
          Export to a file
        </button>
        <button className="btn sm ghost" onClick={pickFile} disabled={!!busy}>
          Import from a file
        </button>
        {busy && <span className="model">{busy}</span>}
      </div>

      <div className="sec">Sync folder</div>
      {!dir ? (
        <>
          <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "14px 4px 12px" }}>
            Point Verba at a folder your own sync service already watches — iCloud Drive, Google Drive, Dropbox,
            Syncthing, or a drive you carry. Verba keeps a copy of everything there and refreshes it as you work. Another
            machine pointed at the same folder picks up your history, your deck and your setup, with nothing to
            reconfigure.
          </div>
          <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "0 4px 16px" }}>
            The database itself stays on this machine. A live SQLite file inside a sync folder is a well-known way to
            corrupt one — what goes in the folder is a snapshot, written whole.
          </div>
          <div className="field">
            <button className="btn sm" onClick={choose} disabled={!!busy}>
              Choose a folder…
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: "14px 4px 4px" }}>
            <div className="model" style={{ fontSize: 12, wordBreak: "break-all" }}>
              {dir}
            </div>
            <div className="desc" style={{ marginTop: 8 }}>
              Last synced {when(sync_.syncedAt)} · {sync_.dirty ? "changes waiting to be written" : "up to date"}
            </div>
          </div>
          <div className="field">
            <button className="btn sm ghost" onClick={syncNow} disabled={!!busy}>
              Sync now
            </button>
            <button className="btn sm ghost" onClick={stop} disabled={!!busy}>
              Stop syncing
            </button>
            {busy && <span className="model">{busy}</span>}
          </div>
        </>
      )}

      <div className="sec" style={{ marginTop: 36 }}>
        Version
      </div>
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "14px 4px 4px" }}>
        You are running <strong>Verba {appVersion}</strong>.
      </div>

      {!selfUpdating ? (
        // Only the AppImage can replace itself. Saying so beats offering a
        // button that cannot work.
        <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "8px 4px 16px" }}>
          This copy was installed from a package — a <code>.deb</code> or <code>.rpm</code> — so updates come from your
          package manager, not from Verba. The AppImage build updates itself.
        </div>
      ) : (
        <>
          <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "8px 4px 16px" }}>
            {offline
              ? "Offline mode is on, so Verba never contacts GitHub — not even to ask whether a new version exists. Turn it off under Settings → Offline to check for updates."
              : "Verba checks once when it starts, and whenever you ask. Updates are downloaded from GitHub and verified against a signature before anything is replaced."}
          </div>

          {updateErr && <div className="err">{updateErr}</div>}

          {found && (
            <div style={{ padding: "0 4px 12px", maxWidth: 480 }}>
              <div className="name">Verba {found.version} is available.</div>
              {found.notes && (
                <div className="desc" style={{ lineHeight: 1.6, marginTop: 6, whiteSpace: "pre-wrap" }}>
                  {found.notes}
                </div>
              )}
            </div>
          )}

          {asked && !found && (
            <div className="desc" style={{ padding: "0 4px 12px" }}>
              You are on the latest version.
            </div>
          )}

          <div className="field">
            <button className="btn sm ghost" onClick={checkNow} disabled={offline || checking || !!progress}>
              {checking ? "Checking…" : "Check for updates"}
            </button>
            {found && (
              <button className="btn sm" onClick={installNow} disabled={!!progress}>
                Install {found.version}
              </button>
            )}
            {/* The one setting that closed this, and the way back to it (#42). */}
            {offline && (
              <span className="model">
                · Off while Verba stays on this machine —{" "}
                <a href={AT.privacy} style={{ color: "inherit" }}>
                  Offline lock
                </a>
              </span>
            )}
            {progress && (
              <span className="model">
                {progress.step === "installing"
                  ? "Installing… Verba will restart."
                  : `Downloading… ${mb(progress.received)}${progress.total ? ` of ${mb(progress.total)}` : ""}`}
              </span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 20,
              padding: "16px 4px",
              borderTop: "1px solid var(--line2)",
              marginTop: 16,
            }}
          >
            <div>
              <div className="name">Include beta versions</div>
              <div className="desc" style={{ maxWidth: 440, lineHeight: 1.5 }}>
                Prereleases, before they are ready for everyone. You will still be offered the stable version whenever it
                is the newer of the two.
              </div>
            </div>
            <button className={`toggle ${beta ? "on" : ""}`} onClick={() => onBeta(!beta)} aria-pressed={beta}>
              <span />
            </button>
          </div>
        </>
      )}

      {pending && (
        <div className="scrim" onClick={() => setPending(null)}>
          <div className="palette confirm" onClick={(e) => e.stopPropagation()}>
            <h2>Replace everything with this backup?</h2>
            <p>
              The file holds <strong>{counts(summarize(pending.backup))}</strong>, saved{" "}
              {when(pending.backup.exportedAt)} on {pending.backup.device}.
            </p>
            <p>
              Everything currently on this machine — conversations, words, progress and settings — is removed and
              replaced by it. This cannot be undone, so export first if you are not sure.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn sm ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button className="btn sm" autoFocus onClick={doImport}>
                Replace my data
              </button>
            </div>
          </div>
        </div>
      )}

      {both && (
        <div className="scrim">
          <div className="palette confirm" onClick={(e) => e.stopPropagation()}>
            <h2>That folder already has Verba data.</h2>
            <p>
              It was last written {when(both.meta.updatedAt)} by {both.meta.device}, and holds{" "}
              <strong>{counts(both.theirs)}</strong>. This machine has <strong>{counts(both.mine)}</strong>.
            </p>
            <p>One of them becomes the shared history from here on. The other is not kept.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                className="btn sm ghost"
                onClick={() =>
                  run("", async () => {
                    setBoth(null);
                    detach();
                    setDir("");
                  })
                }
              >
                Cancel
              </button>
              <button className="btn sm ghost" onClick={() => settle("mine")}>
                Keep this machine's
              </button>
              <button className="btn sm" autoFocus onClick={() => settle("theirs")}>
                Use the folder's
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Settings, packs and every screen's state were just replaced underneath a
 * running app. Re-deriving all of that by hand is a long list of hooks to
 * remember, and forgetting one shows up as a screen quoting data that no longer
 * exists — so the app restarts itself instead.
 */
function reload(): void {
  window.location.reload();
}

/** The conflict dialog App puts up when a launch finds both sides changed. */
export function ConflictDialog({
  remote,
  appVersion,
  onDone,
}: {
  remote: Meta;
  appVersion: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const pick = (choice: "mine" | "theirs") => {
    setBusy(choice);
    setErr("");
    resolve(choice, appVersion)
      .then(() => (choice === "theirs" ? reload() : onDone()))
      .catch((e) => {
        setErr(String(e?.message ?? e));
        setBusy("");
      });
  };

  return (
    <div className="scrim">
      <div className="palette confirm" onClick={(e) => e.stopPropagation()}>
        <h2>Two machines have been working.</h2>
        <p>
          Your sync folder was changed on <strong>{remote.device}</strong> at {when(remote.updatedAt)}, and this machine
          has changes it never got to write. They can't be merged — conversations and cards are numbered per machine, and
          stitching two histories together would put the wrong words in the wrong sessions.
        </p>
        <p>
          Whichever you don't pick is written to the folder as a <code>verba-conflict-…json</code> file, so nothing is
          thrown away and you can import it later.
        </p>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn sm ghost" disabled={!!busy} onClick={() => pick("mine")}>
            {busy === "mine" ? "Publishing…" : "Keep this machine's"}
          </button>
          <button className="btn sm" disabled={!!busy} autoFocus onClick={() => pick("theirs")}>
            {busy === "theirs" ? "Restoring…" : `Use ${remote.device}'s`}
          </button>
        </div>
      </div>
    </div>
  );
}
