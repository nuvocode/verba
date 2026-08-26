# In-app updates — plan

Verba ships as a download today: a new version means a trip to the releases page
and a second drag into Applications. This plan gives the app the ability to
update itself, and gives whoever wants to test early a way to opt into
prereleases.

Not written yet — this is the plan, not the record of it.

## The shape of it

Tauri's updater plugin does the work: it fetches a small JSON manifest, compares
the version, downloads the bundle for this platform, verifies a minisign
signature against a public key baked into the binary, and swaps the app in place.
Nothing here is our own cryptography.

Three decisions define the rest:

**Where the manifests live.** A single release pinned to the tag `updates`,
holding two assets: `stable.json` and `beta.json`, rewritten with `--clobber` on
every build. One host, no Pages site, no server. GitHub's
`/releases/latest/download/` path cannot serve the beta channel — it skips
prereleases by design — so the beta manifest has to sit somewhere fixed anyway,
and once one file needs a home both may as well share it.

**What beta means.** A tag of the form `v*-beta.N`, published as a GitHub
prerelease, rewrites `beta.json` only. A stable tag rewrites both. That single
rule gives the fallback for free: a beta tester who is one release behind a
newer stable gets offered the stable, because `beta.json` always holds the most
recent thing built, whichever channel produced it.

**Where the check happens.** In Rust, as two commands of our own, rather than
through the updater's JavaScript API. The channel toggle has to change the
endpoint at runtime, and the JS `check()` reads a fixed list from the config.
Going through Rust also means `app.restart()` handles the relaunch — no process
plugin — and the webview never calls the updater, so the capability file and the
npm dependencies are both left alone.

## Phase 1 — the signing key

One command, once, and never again:

```bash
npm run tauri signer generate -- -w ~/.tauri/verba.key
```

The private key and its password become the repository secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public
half goes into `tauri.conf.json`, where it is compiled into every build.

Lose this key and every installed copy of Verba is stranded — it will refuse
updates signed by any other key, and the only route back is a manual download.
Back it up somewhere that outlives the laptop.

## Phase 2 — the build

- `tauri.conf.json`: `bundle.createUpdaterArtifacts: true` so each target also
  produces an update bundle and its `.sig`, plus `plugins.updater.pubkey`. No
  `endpoints` — Rust supplies those.
- `src-tauri/Cargo.toml`: `tauri-plugin-updater = "2"`.
- `.github/workflows/release.yml`: the two signing secrets as env on the build
  job, and a new job after the matrix that reads the release's assets with
  `gh release view --json assets`, pulls down the `.sig` files, writes the
  manifest, and uploads it to the `updates` tag. Platform keys are
  `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `windows-x86_64`.

The manifest job runs after the builds rather than inside them because a
manifest that names four platforms cannot be written by a job that knows about
one. It also means a partial matrix — three platforms green, one red — publishes
nothing, which is the right failure: an update offered to a platform whose
bundle never uploaded is worse than no update at all.

## Phase 3 — the app

- `src-tauri/src/update.rs`: a `Mutex<Option<Update>>` in Tauri state, and two
  commands. `fetch_update(beta)` builds the endpoint —
  `.../releases/download/updates/{stable,beta}.json` — checks, parks the pending
  update in state and returns the version and notes. `install_update(on_event)`
  takes it back out, downloads with progress over an `ipc::Channel`, and
  restarts.
- `src/lib/settings.ts`: one field, `betaUpdates: boolean`, default `false`.
- `src/views/DataPanel.tsx`: the version — which is currently not shown anywhere
  in the app — a check button, download progress, and the beta toggle. Under
  `offline` the button is disabled and says why, the way the Speech panel
  disables cloud keys rather than hiding them.
- One quiet check per launch when `offline` is off, surfaced as a badge in
  Settings. No dialog, no interruption, nothing that has to be dismissed before
  the day's session can start.

## What this does not fix

- **Linux**: only the AppImage can replace itself. `.deb` and `.rpm` installs
  update through their package manager or not at all, and the panel should say
  so rather than offering a button that cannot work.
- **macOS**: the update itself is fine unsigned — the download is ours, so the
  quarantine flag a browser would set never appears — but the Gatekeeper warning
  on *first* install is untouched by any of this.
- **Windows**: the NSIS installer runs and closes the app to do its work, and
  being unsigned it still meets SmartScreen.
- **The version number** lives in three files — `package.json`,
  `tauri.conf.json`, `Cargo.toml`. Today that is a manual habit; once the
  updater is comparing versions, a release that bumps two of the three is a bug
  with reach. Worth a check script, separately.

Deliberately left out: delta updates, "skip this version", forced updates,
rollback. The bundle is large — sherpa's static library sees to that — so delta
updates are the first of these likely to earn their place, once there are enough
installs for the bandwidth to matter.
