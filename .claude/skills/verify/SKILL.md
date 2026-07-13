---
name: verify
description: Build, launch and drive Verba (Tauri + React) on macOS to observe a change at its real surface.
---

# Verifying Verba

Verba is a Tauri v2 desktop app: React/Vite frontend, Rust backend. The surface
is **pixels** — drive the window, screenshot it. There is no WebDriver on macOS
(`tauri-driver` is Linux/Windows only), so this uses AppleScript + `screencapture`.

## Launch

```bash
npm run tauri dev          # vite on :1420 + the app
```

**Port 1420 already in use?** A vite server (or a whole `tauri dev`) is already
running — often the user's. Don't kill it. Reuse it:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:1420/   # 200 = alive
cd src-tauri && cargo run                                       # your binary, their vite
```

Two app instances can run side by side. They **share** `appDataDir` and
localStorage-on-disk, but each webview keeps its own in-memory settings — so a
model deleted in one instance leaves the other pointing at a model that is gone.
That is a real user-facing state, not a bug, but don't mistake it for one.

If the frontend stops reflecting your edits, **check vite is still alive** before
suspecting your code. When `tauri dev` dies it takes vite with it, and the
already-loaded webview keeps rendering the last build it saw:

```bash
curl -s http://localhost:1420/src/lib/bundled.ts | head -c 200   # 000 = vite is dead
nohup npm run dev &                                              # restart it
# then ⌘R in the window
```

## Drive it

Get the pid and window box, then act on that process by pid (there may be two):

```bash
PID=$(pgrep -f "target/debug/tauri-app" | tail -1)
osascript -e "tell application \"System Events\" to tell (first process whose unix id is $PID) to get {position, size} of window \"Verba\""
```

The desktop is busy and other apps steal focus, so **raise and capture
atomically** in one script — a separate `screencapture` call often shoots
whatever window landed on top:

```bash
osascript <<EOF
tell application "System Events"
  tell (first process whose unix id is $PID)
    set frontmost to true
    set position of window "Verba" to {60, 60}
    set size of window "Verba" to {1100, 950}
    delay 1
  end tell
end tell
do shell script "screencapture -x -o -R 60,60,1100,950 '/tmp/shot.png'"
EOF
```

Keystrokes are far more reliable than synthetic clicks. Navigation is keyboard-first:

| Key | Goes to |
|---|---|
| `1`–`5` | Today / Talk / Read / Memory / Coach |
| `,` | **Settings** |
| `⌘K` | command palette |
| `esc` | leave the session |

Press `esc` before `,` — if a text input has focus the key is typed into it
instead. Inside Settings, the left nav ("Language", "Speech", …) is clickable by
its accessibility name; find its centre rather than guessing pixels:

```applescript
repeat with g in (groups of UI element 1 of scroll area 1 of group 1 of group 1 of window "Verba")
  repeat with b in (buttons of g)
    if name of b is "Speech" then return position of b
  end repeat
end repeat
```

Language rows are buttons named like `🇹🇷 Turkish — TürkçeOfficial …`.

## Speech changes specifically

Audio output cannot be captured here, so use the app's own signals:

- **Every** bundled-speech failure surfaces the banner *"Bundled voice
  unavailable — using your system voice…"* in Talk. **No banner after a coach
  turn ⇒ `bundled_tts` returned WAV bytes over IPC and played.** That is the
  observable for the happy path.
- Downloads are real: `~/Library/Application Support/com.nuvocode.verba/models/`.
  `index.json` records the verified sha256 — compare it against `CATALOG` in
  `src/lib/bundled.ts` to prove the download+verify path ran for real.
- Ollama must be up (`curl -s localhost:11434/api/tags`) for a Talk turn to
  produce a reply to speak.

## Don't

- Don't verify by running `*.check.ts` or `cargo test` — that's CI, not evidence.
- Don't `pkill -f tauri-app` — you may kill the user's instance. Kill your pid.
