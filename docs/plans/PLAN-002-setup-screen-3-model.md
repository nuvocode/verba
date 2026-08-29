---
id: PLAN-002
title: Setup screen 3 — model setup, the fragile step
branch: plan/002-setup-screen-3-model
base: plan/001-setup-screens-0-2
status: ready
executor: unassigned
created: 2026-08-29
issue: https://github.com/nuvocode/verba/issues/46
milestone: M3 · Onboarding
---

# PLAN-002: Setup screen 3 — model setup

## Context

Setup's model step currently assumes a working install: it shows a server field,
a model field, and a list only when something answers. The spec
(`docs/plans/1-verba-onboarding-spec.md` §5 screen 3) says the opposite — the
default assumption is that **nothing is installed**, and that is the expected
starting state, not an error. The step becomes one screen with three states:
nothing found (3a), a provider but no models (3b), both (3c). It ends with a
real request to the model, and only a successful one lets the learner continue.

Most of the machinery already exists in `src/lib/models.ts` — `listModels`,
`machineRam`, `localChoices`, `isRemoteModel`, `testConnection`. This plan adds
the missing pure pieces and rewrites the screen to use them. Do not reimplement
what is already there.

Depends on PLAN-001: the model step is index **3** and the level step is index
**4**. Branch off PLAN-001's branch after it is merged.

## Repo conventions

- **No new dependencies.** `package.json` is not edited.
- `src/lib/*.ts` import each other with the `.ts` extension; `src/views/*.tsx`
  import without it.
- `src/lib/models.ts` reaches `@tauri-apps/plugin-http` and `./providers/index.ts`
  through **lazy `await import()` helpers at the top of the file** (`http()`,
  `provider()`). This is load-bearing: `models.check.ts` runs the pure half under
  plain node, and a static import of either would stop the file from loading at
  all. Any new function that talks to the network uses the same helpers.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Comments explain why, in English, in full sentences.
- External links are plain `<a href={…} target="_blank" rel="noreferrer">` — the
  pattern in `src/views/settings/Advanced.tsx:232`. Do not add
  `@tauri-apps/plugin-opener` calls.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/models.ts` | EDIT | append after `testConnection`; `INSTALLS` next to `PROVIDERS` |
| `src/lib/models.check.ts` | EDIT | append at the end, before the final `console.log` |
| `src/lib/placement.ts` | EDIT | append after `placementPrompt` |
| `src/views/Onboarding.tsx` | EDIT | `stepAi` — rename and rewrite |
| `src/lib/placement.check.ts` | EDIT | append before the final `console.log` |

## Specification

### src/lib/models.ts

**1. `INSTALLS` — what to say when nothing is installed.** Place it directly
after `PROVIDERS`.

```ts
/** What screen 3a offers when no provider is running. Sizes and times are written
 *  as ranges rather than figures: the installer's exact size changes with every
 *  release, and a number that is wrong is worse than a range that is right. */
export interface Install {
  id: LocalProvider;
  name: string;
  what: string;      // one sentence: what this thing is
  url: string;       // where to download it
  size: string;      // how big the download is
  time: string;      // how long it takes
  steps: string[];   // what to do after installing, in order
}

export const INSTALLS: Install[] = [
  {
    id: "ollama",
    name: "Ollama",
    what: "A small app that runs language models on your own machine. Free, and it starts itself.",
    url: "https://ollama.com/download",
    size: "A few hundred megabytes for the app. The model you then download is the bigger part — usually 2 to 5 GB.",
    time: "A couple of minutes to install, longer for the model — that part depends on your connection.",
    steps: [
      "Download Ollama and open it. It puts an icon in your menu bar and keeps running.",
      "Download a model — Ollama's own window can do it, or paste the command below into a terminal.",
      "Come back here. Verba is watching, and this screen moves on by itself.",
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    what: "A desktop app for downloading and running models, with a window for browsing them.",
    url: "https://lmstudio.ai",
    size: "Around half a gigabyte for the app, plus the model you choose — usually 2 to 5 GB.",
    time: "A few minutes to install, longer for the model.",
    steps: [
      "Download LM Studio and open it.",
      "Search for a model in its Discover tab and download it.",
      "Open the Developer tab and start the local server.",
      "Come back here. Verba is watching, and this screen moves on by itself.",
    ],
  },
];
```

**2. `SUGGESTED_MODEL` and the pull command.**

```ts
/** The model setup tells a bare machine to download.
 *  ponytail: it is `defaultSettings.ollamaModel` rather than a second list, so the
 *  suggestion and the app's own default can never disagree. Change one, both move. */
export const suggestedModel = (): string => defaultSettings.ollamaModel;

/** The command that downloads it. Shown to be copied, never run by the app. */
export const pullCommand = (model = suggestedModel()): string => `ollama pull ${model}`;
```

Import `defaultSettings` from `./settings.ts` — `models.ts` already imports types
from there and `settings.ts` does not import `models.ts`, so there is no cycle.

**3. `pullModel` — downloading without a terminal.** Ollama only.

```ts
export interface PullProgress {
  /** Ollama's own word for what it is doing ("pulling manifest", "downloading…"). */
  status: string;
  done: number;  // bytes so far, 0 when it does not say
  total: number; // bytes in all, 0 when it does not say
}

/**
 * Ask Ollama to download a model, reporting progress as it arrives.
 *
 * The whole reason this exists: §5 3b promises a learner with no terminal a way
 * through, and a copyable command is not one. LM Studio has no equivalent API, so
 * that provider gets the command alone.
 */
export async function pullModel(
  host: string,
  model: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void>;
```

Implementation:
- `POST ${host.replace(/\/$/, "")}/api/pull`, header `content-type: application/json`,
  body `JSON.stringify({ model, stream: true })`, pass `signal` through, via the
  lazy `http()` helper.
- `if (!res.ok) throw new Error(\`Ollama refused the download (${res.status}).\`)`.
- If `res.body` is null or has no `getReader`, `await res.text()` and return — the
  download still happened, there was just nothing to report.
- Otherwise read the stream with a `TextDecoder`, keep a `buffer` string, split on
  `"\n"`, keep the trailing partial line in the buffer, and for every complete
  non-empty line `JSON.parse` it inside a try/catch (skip unparseable lines). If
  the object has `error`, `throw new Error(String(obj.error))`. Otherwise call
  `onProgress({ status: String(obj.status ?? ""), done: Number(obj.completed) || 0, total: Number(obj.total) || 0 })`.

**4. `prettyModel` — a readable name.**

```ts
/** "gemma4:e2b-mlx" → "Gemma 4 · e2b-mlx". The raw id is never lost — the picker
 *  keeps it in a title attribute — but it is not what a learner should have to read. */
export function prettyModel(id: string): string;
```
Rules: split on the first `:` into family and tag. In the family, replace `-` and
`_` with spaces, insert a space between a letter and a following digit
(`/([a-z])(\d)/gi`), then capitalise the first letter of each word. Return
`family` when there is no tag, otherwise `` `${family} · ${tag}` ``. An empty or
whitespace id returns the input unchanged.

**5. `troubleFrom` — a cause and a next action.** §6's error table, as a function.

```ts
export interface Trouble {
  why: string;  // what went wrong, in the learner's words
  next: string; // what to do about it — never absent
}

/** Turn a failed probe into a cause and a next action. `null` when the probe passed. */
export function troubleFrom(probe: Probe, providerName: string, host: string, model: string): Trouble | null;
```
Return `null` when `probe.ok`. Otherwise match `probe.error ?? ""` case-insensitively,
first hit wins:
| matches | why | next |
|---|---|---|
| `timeout`, `abort` | `The model did not answer in time.` | `It may still be loading. Try again, or choose a smaller model.` |
| `refused`, `network`, `failed to fetch`, `connect` | `${providerName} stopped answering at ${host}.` | `Check that it is still running, then try again.` |
| `404`, `not found`, `no such model` | `${providerName} is running, but it is not serving ${model}.` | `Choose another model from the list, or download this one first.` |
| anything else | the raw error text | `Try again, or choose another model.` |

**6. `slowNote` — honesty about a passing but painful probe.**

```ts
/** A probe that passed but took long enough to change the experience. "" when it didn't. */
export function slowNote(ms: number): string;
```
`""` under 10000 ms; otherwise
`` `That took ${Math.round(ms / 1000)} seconds. It will feel like this in every conversation — a smaller model is worth trying.` ``

### src/lib/placement.ts

Add the background generation the spec asks for at the end of screen 3. Module
level, not component state: it has to survive the learner walking from screen 3
to screen 4.

```ts
let pending: Promise<PlacementQ[] | null> | null = null;

/** Start writing the placement test in the background. Called the moment the model
 *  answers on screen 3 (§5, screen 3): by the time the learner asks for the test on
 *  screen 4 it is already written, and asking twice costs nothing. */
export function primePlacement(s: Settings, pack?: LanguagePack): void;

/** The test being written, or null when nothing was ever started. */
export function placementPending(): Promise<PlacementQ[] | null> | null;

/** Throw the pending test away — the model or the language changed under it. */
export function clearPlacement(): void;
```

- `primePlacement` returns immediately if `pending` is already set. Otherwise it
  assigns `pending` a promise that calls the provider exactly as `startTest` in
  `Onboarding.tsx` does today (`chat([{ role: "user", content: placementPrompt(s, pack) }], { json: true })`),
  passes the reply through `parsePlacement`, and **resolves to `null` on any
  failure** — a primed test that throws must never surface as an unhandled
  rejection while the learner is on another screen.
- Reach the provider through a lazy helper, copying the pattern at the top of
  `models.ts`: `const provider = async () => (await import("./providers/index.ts")).getProvider;`.
  `placement.check.ts` runs this file under plain node and a static import breaks it.
- `clearPlacement` sets `pending = null`.

### src/views/Onboarding.tsx

Rename `stepAi` to `stepModel` and rewrite it. It stays at index 3 in the
`body` array.

**State to add:**
```ts
const [served, setServed] = useState<Record<LocalProvider, Installed[] | null>>({ ollama: null, lmstudio: null });
const [asked, setAsked] = useState(false);          // has the first probe answered at all
const [ram, setRam] = useState(0);                  // machineRam(), 0 = unknown
const [verify, setVerify] = useState<"idle" | "busy" | "ok">("idle");
const [probe, setProbe] = useState<Probe | null>(null);
const [pulling, setPulling] = useState<PullProgress | null>(null);
const [pullErr, setPullErr] = useState("");
```
Delete the old `found` / `probing` state and the effect that maintained them,
along with every reference to them (the `stepPlan` warning line reads
`served[prov] === null` instead — see below).

**The poll.** One effect, live only while `step === 3`:
```ts
useEffect(() => {
  if (step !== 3) return;
  let alive = true;
  const tick = async () => {
    const [o, l] = await Promise.all([listModels("ollama", hosts.ollama), listModels("lmstudio", hosts.lmstudio)]);
    if (!alive) return;
    setServed({ ollama: o, lmstudio: l });
    setAsked(true);
  };
  void tick();
  const id = setInterval(() => void tick(), 1000);   // §5 3a: once a second, and no refresh button
  return () => { alive = false; clearInterval(id); };
}, [step, hosts.ollama, hosts.lmstudio]);
```
A second effect, once on mount: `void machineRam().then(setRam)`.

**The derived state** (compute in `stepModel`, not in an effect):
```ts
const up = (["ollama", "lmstudio"] as LocalProvider[]).filter((p) => served[p] !== null);
const stocked = up.filter((p) => (served[p] ?? []).length > 0);
const state = !asked ? "looking" : stocked.length ? "ready" : up.length ? "empty" : "none";
```
When `state === "ready"` and the current `prov` is not in `stocked`, select
`stocked[0]` — inside an effect guarded by a `useRef(false)` that is set the
moment the learner clicks a provider themselves, so a manual choice is never
overridden.

**3a — `state` is `"none"` or `"looking"`.**
- `<h1>Verba needs a model on this machine.</h1>`
- `.sub`: `Verba talks to a language model running on your own computer. You set it up once, then forget about it. This screen is watching, and moves on by itself the moment it finds one.`
- One card per `INSTALLS` entry, `.pick` styled, `.tag` = `i + 1`, `picks[i]`
  focuses that card's install (see below). Inside each: `.big` name, `.small`
  `what`, then `size`, `time`, and the `steps` as an `<ol>`.
- Ollama's card carries the copyable command: a `<code>` showing `pullCommand()`
  and a `Copy` button calling `navigator.clipboard.writeText(pullCommand())`,
  swapping its own label to `Copied` for two seconds.
- Each card ends with `<a href={install.url} target="_blank" rel="noreferrer">Download {name} →</a>`.
- `picks[i]` sets a local `const [openInstall, setOpenInstall] = useState(0)` so
  the number keys do something real: the selected card is expanded (steps and
  command visible), the other collapsed to its first two lines.
- `onEnter` is `undefined` — there is nothing to continue to yet. Under the cards:
  `Still looking for Ollama or LM Studio…` while `state === "looking"`, and
  `Nothing is running yet. This updates on its own.` when `"none"`.
- **No skip.** §6: the model step cannot be skipped, and 3a is what is shown
  instead.

**3b — `state === "empty"`.** `const p = up[0]`.
- `<h1>{name} is running — there is no model yet.</h1>`
- `.sub` names the version-less truth we actually have:
  `Verba can see it at ${hosts[p]}, and it is serving nothing. One download and you are finished.`
- The recommendation, one model: `prettyModel(suggestedModel())`, with
  `The model Verba starts everyone on. It fits comfortably on most machines.`
  When `ram > 0 && ram < 8 * 1024 ** 3`, add
  `Your machine has ${gb(ram)} of memory, so expect it to be slow.`
- The copyable `pullCommand()` block, exactly as in 3a.
- **Ollama only:** a `Download it for me` `.btn` calling `pullModel(hosts.ollama,
  suggestedModel(), setPulling)`; while `pulling` is non-null show
  `${pulling.status}` and, when `pulling.total > 0`, a `.meter` filled to
  `done / total` plus `${gb(done)} of ${gb(total)}`. On rejection set `pullErr`
  and keep the command visible — the manual path is always still there. Hold the
  `AbortController` in a ref and abort it in the effect cleanup.
- The poll is still running, so when the model lands the screen becomes 3c on its
  own. Say so: `When it finishes, this screen moves on by itself.`
- `onEnter` is `undefined`.

**3c — `state === "ready"`.**
- Connection line, plain: `Connected to ${name} · ${n} ${n === 1 ? "model" : "models"}`.
- Two lists, never one. `const rows = localChoices(served[prov] ?? [], ram);`
  then split on `isRemoteModel(row.id)`:
  - **On this machine** — heading, and under it
    `These run on your computer. Nothing you say leaves it.`
  - **On someone else's** — heading, and under it
    `These run on ${name}'s servers. What you say in a conversation is sent there.`
    Render the section only when it is non-empty.
- Each row is a `.pick` button: `.big` `prettyModel(row.id)`, `title={row.id}`,
  `.small` `row.hint`, the `Recommended` badge when `row.recommended`, and
  `row.warning` in a `.warn` span when present. `picks[i]` over the **flattened,
  local-first** order so the number keys and the visual order agree.
- Preselect: an effect that, when `state` first becomes `"ready"` and the current
  `models[prov]` is not among the served ids, selects the `recommended` row, or
  the first local row when nothing is recommended. Guard it with the same
  "learner has touched it" ref.
- The privacy sentence is conditional (§5): when the selected model is remote,
  render `The model you have chosen runs on ${name}'s servers, so the promise that
  nothing leaves this machine does not hold for it.` in a `.warn` block. Never
  render an unconditional "nothing leaves your machine" line anywhere on this screen.
- **Advanced.** The server field moves inside a native `<details>`:
  ```tsx
  <details className="native">
    <summary>Advanced</summary>
    …the provider picker and the host input, as they are today…
  </details>
  ```
  Both providers stay switchable in there. The bare `Model` text input is deleted —
  the list is the picker now.
- **Continue is a verification, not a jump.** The button reads `Continue →` and:
  ```ts
  const check = async () => {
    setVerify("busy");
    const p = await testConnection(draft());
    setProbe(p);
    if (!p.ok) return setVerify("idle");
    setVerify("ok");
    primePlacement(draft(), getPack(packId));   // §5: the test starts writing itself here
    setStep(4);
  };
  ```
  `onEnter = state === "ready" && verify !== "busy" ? () => void check() : undefined`.
  While `"busy"`: `Asking the model to say hello…`. On success, before the step
  changes, the learner sees `Model responds — ${(p.ms / 1000).toFixed(1)}s`; keep
  it simple by rendering that line and calling `setStep(4)` after a 700 ms
  `setTimeout` cleared on unmount. When `slowNote(p.ms)` is non-empty, show it
  under that line and **do not** auto-advance — require a second click on a
  `Continue anyway →` button.
- On failure render `troubleFrom(probe, name, hosts[prov], models[prov])`:
  `why` in a `.err` block, `next` under it, plus a `Try again` button. The learner
  cannot reach step 4 without a passing probe — there is no other route out of
  this screen except Esc.

**Elsewhere in the file:**
- `stepPlan`'s AI row reads `served[prov] === null` where it used to read
  `found === null && !probing`.
- Remove the now-unused `AI` const and use `INSTALLS` / `PROVIDERS` for the
  provider name. If `AI` is still referenced by `stepPlan`, replace that lookup
  with `INSTALLS.find((p) => p.id === prov)!.name`.
- Import `getPack` if it is not already imported; it is used by `primePlacement`.

### src/lib/models.check.ts

Append, before the closing `console.log`:
- `prettyModel("gemma4:e2b-mlx") === "Gemma 4 · e2b-mlx"`,
  `prettyModel("llama") === "Llama"`, `prettyModel("") === ""`.
- `pullCommand("x") === "ollama pull x"` and `pullCommand()` contains `suggestedModel()`.
- `INSTALLS.length === 2`, every entry has a non-empty `url`, `size`, `time` and
  at least two `steps` — 3a is the screen that must never be blank.
- `troubleFrom({ ok: true, ms: 10 }, "Ollama", "h", "m") === null`.
- For each of the four match cases, `troubleFrom` returns a `Trouble` whose `why`
  and `next` are both non-empty — the §6 promise that no error leaves the learner
  without an exit.
- `slowNote(900) === ""` and `slowNote(30000)` is non-empty.

### src/lib/placement.check.ts

Append: `placementPending()` is `null` before anything is primed;
`clearPlacement()` after a `primePlacement` on a settings object pointing at an
unreachable host leaves `placementPending()` `null` again. Do not assert on the
network — `primePlacement` must be safe to call in a check without one.

## Do not touch

- `src/views/Settings.tsx` and `src/views/settings/Advanced.tsx` — Settings keeps
  its own model picker and this plan does not unify them.
- `src/views/Today.tsx` — PLAN-004 owns it.
- `localChoices`, `isRemoteModel`, `modelTrouble`, `testConnection`, `machineRam`,
  `listModels` — use them, do not rewrite them, do not change their signatures.
- `PLACEMENT_LADDER`, `parsePlacement`, `scorePlacement`, `placementPrompt` — the
  level screen is PLAN-003's job.
- `package.json` — no new dependencies. In particular do not add an HTTP client;
  the lazy `http()` helper is the only one.
- Screens 0, 1, 2 and the level screen. Only `stepAi`/`stepModel` and the state it
  owns are rewritten here.

## Acceptance

```bash
npm run check                                                # tsc clean, every check file passes
node --experimental-strip-types src/lib/models.check.ts      # models.check ✓
node --experimental-strip-types src/lib/placement.check.ts   # placement.check ✓
grep -c "nothing leaves it\|nothing leaves your machine" src/views/Onboarding.tsx   # 0
grep -n "setInterval" src/views/Onboarding.tsx               # the 1000 ms poll, exactly one
grep -n "primePlacement" src/views/Onboarding.tsx            # called after a passing probe
```

The `grep -c` line must print `0`: the blanket privacy claim is gone, replaced by
the per-list sentences.

## Manifest

When implementation is complete, write `docs/plans/PLAN-002.done.md` containing:

```markdown
## Changed
- path — one line on what changed

## Deviations
- Anything done differently from this plan, and why. Write "none" if there were none.

## Not done
- Anything in the plan left unimplemented, and what blocked it.

## Acceptance results
- Each command above, with its actual output.
```
