// Checking for an update lives here rather than in the updater's JavaScript API,
// for one reason: the beta toggle has to change the endpoint at runtime, and the
// JS `check()` reads a fixed list out of tauri.conf.json. Going through Rust also
// means `app.restart()` handles the relaunch — no process plugin — and the
// webview never calls the updater, so the capability file and the npm
// dependencies are both left alone.

use std::sync::Mutex;

use tauri::ipc::Channel;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Both channel manifests live on one release, pinned to a tag that never moves.
/// Written by the `manifest` job in .github/workflows/release.yml.
const MANIFESTS: &str = "https://github.com/nuvocode/verba/releases/download/updates";

/// Emitted at most once per megabyte — a download this size would otherwise send
/// thousands of events to move a progress bar a few pixels.
const EMIT_EVERY: u64 = 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Msg(String),
    #[error("{0}")]
    Updater(#[from] tauri_plugin_updater::Error),
}

impl serde::Serialize for Error {
    fn serialize<S: serde::ser::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// The update `fetch_update` found, waiting for the learner to say yes. Parked
/// here rather than re-checked on install so that what they agreed to install is
/// exactly what was described to them.
#[derive(Default)]
pub struct UpdateState(Mutex<Option<Update>>);

#[derive(serde::Serialize)]
pub struct Available {
    version: String,
    notes: String,
}

/// Whether this install is one that can replace itself.
///
/// On Linux only the AppImage can: a .deb or .rpm belongs to the package manager,
/// and the updater has nowhere to write. `APPIMAGE` is the environment variable
/// an AppImage sets for its own contents, and is the same signal Tauri's updater
/// uses to find the file it must overwrite.
#[tauri::command]
pub fn can_update() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

#[tauri::command]
pub async fn fetch_update(
    app: AppHandle,
    beta: bool,
    state: State<'_, UpdateState>,
) -> Result<Option<Available>, Error> {
    let endpoint = format!("{MANIFESTS}/{}.json", if beta { "beta" } else { "stable" });
    let url = Url::parse(&endpoint).map_err(|e| Error::Msg(format!("{endpoint}: {e}")))?;

    let found = app
        .updater_builder()
        .endpoints(vec![url])?
        .build()?
        .check()
        .await?;

    // Parked either way: a check that finds nothing must also clear an update
    // the learner declined earlier, or the next Install button installs a
    // version this panel is no longer describing.
    let Some(update) = found else {
        *state.0.lock().unwrap() = None;
        return Ok(None);
    };

    let available = Available {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
    };
    *state.0.lock().unwrap() = Some(update);
    Ok(Some(available))
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "step")]
pub enum Progress {
    Downloading { received: u64, total: Option<u64> },
    /// The last thing the webview hears. Installing replaces the app and
    /// restarts it, so `install_update` never returns and its promise never
    /// resolves — the UI has to treat this as the end.
    Installing,
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    on_event: Channel<Progress>,
) -> Result<(), Error> {
    // Taken out, not borrowed: the guard cannot be held across the download, and
    // an install that fails should not leave a stale update parked behind it.
    let update = state.0.lock().unwrap().take();
    let Some(update) = update else {
        return Err(Error::Msg("nothing to install — check for an update first".into()));
    };

    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;

    update
        .download_and_install(
            |chunk, total| {
                received += chunk as u64;
                if received - last_emit >= EMIT_EVERY {
                    last_emit = received;
                    let _ = on_event.send(Progress::Downloading { received, total });
                }
            },
            || {
                let _ = on_event.send(Progress::Installing);
            },
        )
        .await?;

    // Never returns: this process is replaced by the version just installed.
    app.restart();
}
