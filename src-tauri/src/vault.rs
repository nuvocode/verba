// Reading and writing the learner's data *outside* the app's own directory —
// a backup file they chose, or a folder they sync (iCloud Drive, Google Drive,
// Syncthing, a USB stick).
//
// ponytail: this is Rust rather than tauri-plugin-fs on purpose. The whole point
// is an arbitrary path the learner names at runtime, and the fs plugin's answer
// to that is either a permissive scope in capabilities/ — which hands *every*
// path to the webview forever — or a runtime scope call that has to be threaded
// through anyway. Four commands here keep the webview's reach to exactly the
// files this feature is about.
//
// Nothing in here knows what a backup contains. It moves strings.

use std::fs;
use std::path::{Path, PathBuf};

/// The two files a synced folder holds. `data` is the whole backup envelope
/// (see src/lib/backup.ts); `meta` is the small header — who wrote it, when,
/// which app version — that a sync decision can be made from without parsing
/// and reading megabytes of passages.
pub const DATA_FILE: &str = "verba-data.json";
pub const META_FILE: &str = "verba-meta.json";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Msg(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for Error {
    fn serialize<S: serde::ser::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Write a file so that a reader never sees a half-written one.
///
/// This matters more here than anywhere else in the app: the destination is a
/// folder a sync daemon is *watching*, and a daemon that uploads the file while
/// we are still writing it would publish a truncated backup to every other
/// machine. Write a sibling temp file, flush it, then rename — rename within a
/// directory is atomic on every filesystem we ship to, so the daemon sees the
/// old file or the new one and never something in between.
fn write_atomic(path: &Path, contents: &str) -> Result<(), Error> {
    let dir = path
        .parent()
        .ok_or_else(|| Error::Msg(format!("{} has no parent directory", path.display())))?;
    fs::create_dir_all(dir)?;

    // Named for the target so two concurrent writes to different files in the
    // same folder cannot collide on the temp name.
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("verba")
    ));
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// `None` for "no such file", an error for a file that exists and cannot be
/// read. The caller needs to tell those apart: the first is an empty folder
/// waiting for its first sync, the second is a real problem worth showing.
fn read_opt(path: &Path) -> Result<Option<String>, Error> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// The header alone.
///
/// Split from the data on purpose: every sync decision is made from `updatedAt`
/// and nothing else, and this is the call the app makes on launch, before each
/// push, and whenever a window comes back. Reading it must not mean pulling a
/// year of passages across the IPC bridge — the header is a few hundred bytes,
/// the data can be tens of megabytes.
#[tauri::command]
pub fn vault_meta(dir: String) -> Result<Option<String>, Error> {
    read_opt(&PathBuf::from(dir).join(META_FILE))
}

/// The backup itself. Only read when something is actually being restored.
#[tauri::command]
pub fn vault_data(dir: String) -> Result<Option<String>, Error> {
    read_opt(&PathBuf::from(dir).join(DATA_FILE))
}

/// Publish a backup to the folder.
///
/// Data first, header second, and never the other way round: the header is what
/// another machine reads to decide "this folder is newer than me, pull it". If
/// it landed first and the write died — the disk filled, the laptop slept, the
/// sync daemon choked — that machine would be told to pull a backup that is
/// still the previous one, and would silently roll itself back. Written in this
/// order, a failure between the two leaves a folder whose header is *older*
/// than its data, which costs one redundant push and loses nothing.
#[tauri::command]
pub fn vault_save(dir: String, meta: String, data: String) -> Result<(), Error> {
    let dir = PathBuf::from(dir);
    write_atomic(&dir.join(DATA_FILE), &data)?;
    write_atomic(&dir.join(META_FILE), &meta)?;
    Ok(())
}

/// Park a copy that would otherwise be overwritten, and return where it went.
///
/// Used when two machines both wrote since they last agreed. Whichever side
/// loses, its data still exists as a file the learner can import by hand — this
/// feature is not allowed to be the reason a year of history disappears.
#[tauri::command]
pub fn vault_conflict(dir: String, data: String, label: String) -> Result<String, Error> {
    let safe: String = label
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let path = PathBuf::from(dir).join(format!("verba-conflict-{safe}.json"));
    write_atomic(&path, &data)?;
    Ok(path.display().to_string())
}

/// Prove the folder can actually be written to, at the moment the learner picks
/// it rather than at the first sync an hour later. A read-only volume, a
/// not-yet-downloaded iCloud directory and a typo'd path all fail here, where
/// the error still has a folder picker next to it to explain itself.
#[tauri::command]
pub fn vault_check(dir: String) -> Result<(), Error> {
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        return Err(Error::Msg(format!("{} is not a folder", dir.display())));
    }
    let probe = dir.join(".verba-write-test");
    fs::write(&probe, b"ok")?;
    fs::remove_file(&probe)?;
    Ok(())
}

/// One file, one path — the manual "Export my data" half, where the learner
/// named the exact file in a save dialog.
#[tauri::command]
pub fn file_write(path: String, contents: String) -> Result<(), Error> {
    write_atomic(Path::new(&path), &contents)
}

#[tauri::command]
pub fn file_read(path: String) -> Result<String, Error> {
    Ok(fs::read_to_string(path)?)
}
