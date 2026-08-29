import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SKIP_DEFAULTS, skipNote, type ProviderId, type Settings } from "../lib/settings";
import { getPack, listPacks, packOrigin, originLabel, type PackOrigin } from "../lib/packs";
import { endonym, langCode, langName, langNameIn, languages, UI_LANGUAGES } from "../lib/langs";
import { AT, sameLanguage } from "../lib/rules";
import { buildDailyPlan, daySummary } from "../lib/learn";
import { todayKey } from "../lib/useDay";
import { getSpeech, mic, micTrouble } from "../lib/speech";
import { appDataDir } from "@tauri-apps/api/path";
import {
  gb,
  INSTALLS,
  isRemoteModel,
  listModels,
  localChoices,
  machineRam,
  PROVIDERS,
  prettyModel,
  pullCommand,
  pullModel,
  slowNote,
  suggestedModel,
  testConnection,
  troubleFrom,
  type Installed,
  type LocalProvider,
  type Probe,
  type PullProgress,
} from "../lib/models";
import { CEFR_LEVELS, type CEFRLevel } from "../lib/model";
import { LEVELS, TIMES } from "../lib/choices";
import { primePlacement, placementPending, clearPlacement, scorePlacement, type PlacementQ } from "../lib/placement";
import { poolFor } from "../lib/packs/pools";
import { attach, detach, pickFolder, pull } from "../lib/vault";
import { live } from "../lib/keys";
import Hints from "./Hints";

const STEP_LABELS = ["Before we start", "Setup · 1 of 4", "Setup · 2 of 4", "Setup · 3 of 4", "Setup · 4 of 4", "Ready"];

type LevelMode = "pick" | "busy" | "test" | "result";

/** "Native language: Turkish — change", where change opens a searchable list in place. */
function NativePicker({
  value,
  onChange,
  exclude,
  prefix,
  defaultOpen,
}: {
  value: string;
  onChange: (name: string) => void;
  /** The language being learned. It is not on offer here — §3: the two can never
   *  be the same, and a list that offers the pair is a route to a refusal. */
  exclude?: string;
  prefix?: string;
  /** Open straight away. Screen 1's clash button remounts this with it set. */
  defaultOpen?: boolean;
}) {
  const all = useMemo(
    () => languages().filter((l) => l.name.toLowerCase() !== (exclude ?? "").trim().toLowerCase()),
    [exclude],
  );
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState("");

  if (!open)
    return (
      <div className="native">
        {prefix}
        <strong>{value}</strong> —{" "}
        <button
          className="link"
          onClick={() => {
            setQ("");
            setOpen(true);
          }}
        >
          change
        </button>
      </div>
    );

  const hits = all.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="native">
      <input
        className="lang-search"
        autoFocus
        placeholder="Search languages…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // the step's own keys (1–9, ↵, esc) must not fire while typing here
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && hits[0]) pick(hits[0].name);
        }}
      />
      <div className="lang-list">
        {hits.length ? (
          hits.map((l) => (
            <button key={l.code} className={`lang-opt ${l.name === value ? "on" : ""}`} onClick={() => pick(l.name)}>
              {l.name}
            </button>
          ))
        ) : (
          <div className="lang-opt off">No language matches “{q}”.</div>
        )}
      </div>
    </div>
  );
}

/** Why a pack's origin tag reads the way it does — the title on the origin chip. */
const PACK_ORIGIN_NOTE: Record<PackOrigin, string> = {
  official:
    "Official packs are written and maintained by the Verba team, with grammar and pronunciation notes. Community packs are written by volunteers and may cover less.",
  community:
    "Official packs are written and maintained by the Verba team, with grammar and pronunciation notes. Community packs are written by volunteers and may cover less.",
  imported: "A pack you pasted in yourself. Nobody has reviewed it.",
};

/** A copy-to-clipboard button that swaps its own label to "Copied" for two seconds. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn sm ghost"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The offered interface language that matches the OS locale, or English. */
function pickUi(locale: string): string {
  const base = (locale.split("-")[0] || "").toLowerCase();
  return (UI_LANGUAGES as readonly string[]).includes(base) ? base : "en";
}

export default function Onboarding({
  settings,
  onDone,
  onExit,
  onSave,
  only,
}: {
  settings: Settings;
  onDone: (patch: Partial<Settings>, dest?: "today" | "settings") => void;
  /** Present only on a replay — a first run has nowhere to escape to. */
  onExit?: () => void;
  /** Write an answer down without leaving setup. §6: every answer is persisted the
   *  moment it is given, so closing the app resumes where it left off. */
  onSave?: (patch: Partial<Settings>) => void;
  /**
   * Run one step on its own and hand the answer straight back to where the
   * learner came from. Settings → Learning uses this for "I'm not sure — take a
   * short test": §5.3 asks for *the setup test*, not a second one written to
   * live in Settings, and two placement tests would be two things to keep true.
   */
  only?: { step: number; back: "settings" };
}) {
  const packs = listPacks();
  // Resume where setup was left, not from the top — closing the app mid-setup
  // must not throw the answers away (§6). Clamped so a stored step from an older
  // build cannot index past the `body` array, and a replay (or a finished setup)
  // starts at the beginning.
  const providerModel = PROVIDERS.find((p) => p.id === settings.provider)?.model ?? "ollamaModel";
  const noModelConfigured = settings[providerModel] === "";
  const storedStep = settings.onboarded ? 0 : Math.min(Math.max(0, settings.setupStep), 5);
  // A stored step is not proof the model screen was ever passed: if setup was
  // left on it (or on Ready, which needs a model) but no model is on file for the
  // current provider, start at the model screen instead — the one step that
  // cannot be skipped (§6).
  const resumedStale = (storedStep === 4 || storedStep === 5) && noModelConfigured;
  const [step, setStep] = useState(only?.step ?? (resumedStale ? 3 : storedStep));
  // The model screen's skip shows *why* it cannot be skipped the first time it is
  // tried, instead of doing nothing at all (§6).
  const [skipTried, setSkipTried] = useState(false);

  /**
   * Walk on through setup, or — on a single-step run — answer and go back.
   * `level` is passed where the answer was chosen in the same tick: `setCefr` has
   * not landed yet, and `patch()` would send the level the learner just replaced.
   */
  const advance = (to: number, level?: CEFRLevel) => {
    if (!only) return setStep(to);
    const p = patch();
    onDone(level ? { ...p, profile: { ...p.profile!, level } } : p, only.back);
  };

  // ---- coming back rather than starting (step 0) ----
  //
  // The reason this lives in setup at all: a learner who reinstalled, or who is
  // on their second machine, should never be asked their level and their
  // interests again. Their answers are already in the folder. Offered only on a
  // genuinely fresh install — on a replay there is local data that restoring
  // would silently overwrite, and Settings → Privacy and data is where that conversation
  // belongs, with its counts and its confirm.
  const [restoring, setRestoring] = useState("");
  const [restoreErr, setRestoreErr] = useState("");

  const restoreFromFolder = async () => {
    setRestoreErr("");
    setRestoring("Opening…");
    try {
      const picked = await pickFolder();
      if (!picked) return setRestoring("");
      setRestoring("Reading the folder…");
      const { meta, summary } = await attach(picked);
      if (!meta || !summary) throw new Error("There's no Verba data in that folder yet.");
      setRestoring("Restoring…");
      await pull();
      window.location.reload(); // the whole app is now someone else's — start it fresh
    } catch (e: any) {
      // Leave no half-attached folder behind: an aborted restore must not turn
      // the next launch into a conflict dialog on an empty install.
      detach();
      // The reason alone is not the whole answer — the learner needs to know what
      // was expected too, or the next folder they try is a guess (§6).
      setRestoreErr(
        `${String(e?.message ?? e)} Verba looks for the folder you pointed your other machine at — the one holding your Verba data, not the app itself.`,
      );
      setRestoring("");
    }
  };

  // ---- AI (step 0) ----
  const [prov, setProv] = useState<LocalProvider>(settings.provider === "lmstudio" ? "lmstudio" : "ollama");
  const [hosts, setHosts] = useState({ ollama: settings.ollamaHost, lmstudio: settings.lmstudioHost });
  const [models, setModels] = useState({ ollama: settings.ollamaModel, lmstudio: settings.lmstudioModel });
  // What each local server is serving right now — null means it never answered.
  const [served, setServed] = useState<Record<LocalProvider, Installed[] | null>>({ ollama: null, lmstudio: null });
  const [asked, setAsked] = useState(false); // has the first probe answered at all
  const [ram, setRam] = useState(0); // machineRam(), 0 = unknown
  const [verify, setVerify] = useState<"idle" | "busy" | "ok">("idle");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [pulling, setPulling] = useState<PullProgress | null>(null);
  const [pullErr, setPullErr] = useState("");
  const [openInstall, setOpenInstall] = useState(0); // which install card 3a has expanded
  // The learner has clicked a provider or a model themselves — from then on a
  // manual choice is never overridden by the auto-selection.
  const touched = useRef(false);
  // Aborted when the step unmounts, so a download left running is not left hanging.
  const abortPull = useRef<AbortController | null>(null);
  // The 700 ms pause before the step changes after a passing probe.
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nothing is pre-selected on a fresh install — a default target language would be a silent
  // guess. On a replay, the learner's current pack is shown as chosen. A resumed setup
  // restores the pack the learner picked before quitting, exactly as it restores the step
  // (§6: closing the app mid-setup must not throw the answers away).
  const [packId, setPackId] = useState(
    settings.onboarded || settings.setupStep > 0 ? settings.packId : "",
  );
  const [nativeLang, setNativeLang] = useState(settings.profile.nativeLanguage);
  const [cefr, setCefr] = useState<CEFRLevel>(settings.profile.level);
  const [minutes, setMinutes] = useState(settings.dailyMinutes);
  const [ui, setUi] = useState(
    settings.uiLanguage || pickUi(typeof navigator === "undefined" ? "" : navigator.language),
  );
  // Bumped each time screen 1's clash says "change my native language" — it
  // remounts NativePicker with defaultOpen so the picker is already up.
  const [forceNative, setForceNative] = useState(0);

  // ---- level test (step 2) ----
  const [mode, setMode] = useState<LevelMode>("pick");
  const [quiz, setQuiz] = useState<PlacementQ[]>([]);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [testErr, setTestErr] = useState("");
  const [waitedAt, setWaitedAt] = useState(0);
  const [now, setNow] = useState(0);
  // Guards the busy screen's resolution: if the learner left "busy" before the
  // promise settled, do not land them in a test they no longer asked for.
  const cancelled = useRef(false);

  // The busy screen's live clock — a 1 s tick that runs only while the mode is
  // "busy", so the elapsed line never goes stale and never ticks on another step.
  useEffect(() => {
    if (mode !== "busy") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode]);

  const host = hosts[prov];
  const pack = packs.find((p) => p.id === packId);
  const lang = pack?.name ?? settings.profile.targetLanguage;

  const patch = (): Partial<Settings> => ({
    provider: prov as ProviderId,
    ollamaHost: hosts.ollama,
    ollamaModel: models.ollama,
    lmstudioHost: hosts.lmstudio,
    lmstudioModel: models.lmstudio,
    packId,
    uiLanguage: ui,
    profile: {
      ...settings.profile,
      targetLanguage: lang,
      nativeLanguage: nativeLang,
      level: cefr,
    },
    dailyMinutes: minutes,
  });

  /** The settings the placement test itself must run under — the ones just chosen, not the saved ones. */
  const draft = (): Settings => ({ ...settings, ...patch() } as Settings);

  // Persist every answer the moment it is given, so closing the app mid-setup
  // resumes where it left off (§6). A single-step run answers one question and
  // hands it back itself — there is nothing to persist.
  useEffect(() => {
    if (only) return; // a single-step run answers one question and hands it back itself
    onSave?.({ ...patch(), setupStep: step });
  }, [step, ui, packId, nativeLang, cefr, minutes, prov, hosts, models]);

  // The preview sentence on the last screen is measured from the real plan, so
  // the promise and the plan cannot drift (§6).
  const preview = useMemo(
    () => buildDailyPlan(draft(), { date: todayKey(), dayIndex: 1, dueVocab: 0 }),
    [packId, cefr, minutes, nativeLang],
  );
  // The speech adapter for the last screen's two buttons — built once, from the
  // settings as they stand.
  const speech = useMemo(() => getSpeech(draft(), () => {}), [settings]);
  // The last screen's microphone test result — null until it has been asked.
  const [micMsg, setMicMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Where the app's data lives, for the last screen's one-line promise.
  const [dataDir, setDataDir] = useState("");
  useEffect(() => {
    void appDataDir().then(setDataDir).catch(() => setDataDir(""));
  }, []);

  // The poll: once a second while on step 3, ask both local servers what they
  // serve. §5 3a — no refresh button; the screen moves on by itself.
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
    const id = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [step, hosts.ollama, hosts.lmstudio]);

  // How much machine there is, once — 0 means unknown and no size claim is made.
  useEffect(() => {
    void machineRam().then(setRam);
  }, []);

  // What the poll found, read the same way by the screen and by the two effects
  // below: which providers answered, which of those serve anything, and the state
  // that follows. Derived on every render rather than stored — a second copy in
  // state is a second thing that can be stale.
  const up = (["ollama", "lmstudio"] as LocalProvider[]).filter((p) => served[p] !== null);
  const stocked = up.filter((p) => (served[p] ?? []).length > 0);
  const modelState = !asked ? "looking" : stocked.length ? "ready" : up.length ? "empty" : "none";

  // Move to the provider that actually has models — unless the learner has
  // already chosen one, in which case their choice stands.
  useEffect(() => {
    if (modelState !== "ready" || touched.current) return;
    if (!stocked.includes(prov)) setProv(stocked[0]);
  }, [modelState, stocked.join(","), prov]);

  // Preselect: the recommended row, or the first local one, but only while the
  // model on file is not something the server is actually serving.
  useEffect(() => {
    if (modelState !== "ready" || touched.current) return;
    if ((served[prov] ?? []).some((m) => m.id === models[prov])) return;
    const rows = localChoices(served[prov] ?? [], ram);
    const rec = rows.find((r) => r.recommended) ?? rows.find((r) => !isRemoteModel(r.id));
    if (rec) setModels((m) => ({ ...m, [prov]: rec.id }));
  }, [modelState, prov, ram]);

  // Abort a running download and any pending advance when the step goes away.
  useEffect(() => {
    return () => {
      abortPull.current?.abort();
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  const startTest = useCallback(async () => {
    setTestErr("");
    const pool = poolFor(packId);
    if (pool) {
      setQuiz(pool);
      setQi(0);
      setAnswers([]);
      return setMode("test"); // official languages: instant
    }
    const primed = placementPending();
    setMode("busy");
    setWaitedAt(Date.now());
    cancelled.current = false;
    try {
      const qs = await (primed ?? (primePlacement(draft(), getPack(packId)), placementPending()!));
      if (!qs) throw new Error("The model didn't return a usable test.");
      if (cancelled.current) return; // the learner left "busy" while the model wrote
      setQuiz(qs);
      setQi(0);
      setAnswers([]);
      setMode("test");
    } catch (e: any) {
      clearPlacement();
      setTestErr(`${String(e?.message ?? e)} — pick your level below instead.`);
      setMode("pick");
    }
  }, [packId, prov, host]);

  const answer = (choice: number) => {
    const next = [...answers, choice];
    setAnswers(next);
    if (next.length < quiz.length) return setQi(next.length);
    setCefr(scorePlacement(quiz, next));
    setMode("result");
  };

  const skip = () => {
    setCefr(SKIP_DEFAULTS.level);
    setMinutes(SKIP_DEFAULTS.dailyMinutes);
    // §6: the model step is the one that cannot be skipped. Once a model is
    // verified, skip lands on Ready; until then it lands on the model screen
    // rather than walking straight past it.
    setStep(verify === "ok" ? 5 : 3);
  };

  // ---- keyboard: the whole flow is drivable without a mouse ----
  // Options are numbered 1–9, Enter continues, Esc goes back one step (and leaves setup on a replay).
  const picks: (() => void)[] = [];
  let onEnter: (() => void) | undefined;

  const back = () => {
    if (step === 4 && mode !== "pick") return setMode("pick"); // out of the test, not out of the step
    if (step > 0) return setStep(step - 1);
    onExit?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) {
        if (e.key === "Escape") (el as HTMLInputElement).blur();
        return;
      }
      if (!live("onboarding", e.key)) return; // the table is the gate
      if (e.key === "Escape") {
        e.preventDefault();
        return back();
      }
      if (e.key === "Enter" && onEnter) {
        e.preventDefault();
        return onEnter();
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && picks[n - 1]) {
        e.preventDefault();
        picks[n - 1]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- step bodies (each one registers its number keys and its Enter action) ----

  const stepModel = () => {
    // 3a: nothing is running (or we are still looking). Offer the installs.
    if (modelState === "none" || modelState === "looking") {
      INSTALLS.forEach((_, i) => (picks[i] = () => setOpenInstall(i)));
      onEnter = undefined; // there is nothing to continue to yet
      return (
        <>
          <h1>Verba needs a model on this machine.</h1>
          {skipTried && (
            <div className="native" style={{ marginBottom: 12 }}>
              Setup can be skipped, but the model cannot: without one there is nothing to talk to. Everything else is
              already assumed.
            </div>
          )}
          <div className="sub">
            Verba talks to a language model running on your own computer. You set it up once, then forget about it. This
            screen is watching, and moves on by itself the moment it finds one.
          </div>
          <div className="col">
            {INSTALLS.map((install, i) => {
              const open = openInstall === i;
              return (
                <div key={install.id} className={`pick ${open ? "on" : ""}`} style={{ textAlign: "left" }}>
                  <span className="tag">{i + 1}</span>
                  <div className="big" style={{ fontSize: 20 }}>
                    {install.name}
                  </div>
                  <div className="small" style={{ lineHeight: 1.5 }}>
                    {install.what}
                  </div>
                  {open && (
                    <>
                      <div className="small" style={{ lineHeight: 1.5, marginTop: 10 }}>
                        <strong>Size:</strong> {install.size}
                      </div>
                      <div className="small" style={{ lineHeight: 1.5 }}>
                        <strong>Time:</strong> {install.time}
                      </div>
                      <ol style={{ margin: "10px 0 0 20px", padding: 0 }}>
                        {install.steps.map((s, j) => (
                          <li key={j} className="small" style={{ lineHeight: 1.5 }}>
                            {s}
                          </li>
                        ))}
                      </ol>
                      {install.id === "ollama" && (
                        <div className="native" style={{ marginTop: 12 }}>
                          <code>{pullCommand()}</code> <CopyButton text={pullCommand()} />
                        </div>
                      )}
                    </>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <a href={install.url} target="_blank" rel="noreferrer">
                      Download {install.name} →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="native" style={{ marginTop: 26 }}>
            {modelState === "looking" ? "Still looking for Ollama or LM Studio…" : "Nothing is running yet. This updates on its own."}
          </div>
        </>
      );
    }

    // 3b: a provider is up but serving nothing. One download and it is done.
    if (modelState === "empty") {
      const p = up[0];
      const name = INSTALLS.find((x) => x.id === p)!.name;
      const rec = prettyModel(suggestedModel());
      const doPull = async () => {
        setPullErr("");
        const ctrl = new AbortController();
        abortPull.current = ctrl;
        try {
          await pullModel(hosts.ollama, suggestedModel(), setPulling, ctrl.signal);
        } catch (e: any) {
          setPullErr(String(e?.message ?? e));
        } finally {
          abortPull.current = null;
        }
      };
      onEnter = undefined;
      return (
        <>
          <h1>{name} is running — there is no model yet.</h1>
          {skipTried && (
            <div className="native" style={{ marginBottom: 12 }}>
              Setup can be skipped, but the model cannot: without one there is nothing to talk to. Everything else is
              already assumed.
            </div>
          )}
          <div className="sub">
            Verba can see it at {hosts[p]}, and it is serving nothing. One download and you are finished.
          </div>
          <div className="native" style={{ marginTop: 20 }}>
            <strong>{rec}</strong> — The model Verba starts everyone on. It fits comfortably on most machines.
            {ram > 0 && ram < 8 * 1024 ** 3 && ` Your machine has ${gb(ram)} of memory, so expect it to be slow.`}
          </div>
          <div className="native" style={{ marginTop: 12 }}>
            <code>{pullCommand()}</code> <CopyButton text={pullCommand()} />
          </div>
          {p === "ollama" && (
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => void doPull()} disabled={!!pulling}>
                {pulling
                  ? `${pulling.status}${pulling.total > 0 ? ` — ${gb(pulling.done)} of ${gb(pulling.total)}` : ""}`
                  : "Download it for me"}
              </button>
              {pulling && pulling.total > 0 && (
                <div className="meter" style={{ margin: "12px 0" }}>
                  <div style={{ width: `${(pulling.done / pulling.total) * 100}%` }} />
                </div>
              )}
              {pullErr && <div className="err" style={{ marginTop: 10 }}>{pullErr}</div>}
            </div>
          )}
          <div className="native" style={{ marginTop: 20 }}>
            When it finishes, this screen moves on by itself.
          </div>
        </>
      );
    }

    // 3c: at least one provider is serving models. Pick one, then verify.
    const name = INSTALLS.find((x) => x.id === prov)!.name;
    const rows = localChoices(served[prov] ?? [], ram);
    const local = rows.filter((r) => !isRemoteModel(r.id));
    const remote = rows.filter((r) => isRemoteModel(r.id));
    const flat = [...local, ...remote]; // local-first, so the number keys and the visual order agree
    flat.forEach((r, i) => (picks[i] = () => {
      setModels((m) => ({ ...m, [prov]: r.id }));
      clearPlacement(); // a pending test was written for the old model
    }));

    const selected = models[prov];
    const selectedRemote = isRemoteModel(selected);

    const check = async () => {
      setVerify("busy");
      const p = await testConnection(draft());
      setProbe(p);
      if (!p.ok) return setVerify("idle");
      setVerify("ok");
      if (!poolFor(packId)) primePlacement(draft(), getPack(packId)); // §5: the test starts writing itself here — but not for a language with a curated pool
      // A slow model is a broken experience, so a passing-but-painful probe does
      // not auto-advance — the learner reads the note and chooses to continue.
      if (!slowNote(p.ms)) advanceTimer.current = setTimeout(() => setStep(4), 700);
    };

    const slow = probe?.ok ? slowNote(probe.ms) : "";
    onEnter = modelState === "ready" && verify !== "busy" ? () => void check() : undefined;

    return (
      <>
        <h1>
          Connected to {name} · {rows.length} {rows.length === 1 ? "model" : "models"}
        </h1>
        {skipTried && (
          <div className="native" style={{ marginBottom: 12 }}>
            Setup can be skipped, but the model cannot: without one there is nothing to talk to. Everything else is
            already assumed.
          </div>
        )}
        <div className="col">
          <div className="native">
            <strong>On this machine</strong> — These run on your computer. Nothing you say leaves it.
          </div>
          {local.map((r) => (
            <button
              key={r.id}
              className={`pick ${selected === r.id ? "on" : ""}`}
              title={r.id}
              onClick={() => {
                setModels((m) => ({ ...m, [prov]: r.id }));
                clearPlacement(); // a pending test was written for the old model
              }}
            >
              <div className="big" style={{ fontSize: 19 }}>
                {prettyModel(r.id)}
                {r.recommended && <span className="rec">Recommended</span>}
              </div>
              <div className="small" style={{ lineHeight: 1.5 }}>{r.hint}</div>
              {r.warning && <div className="warn" style={{ marginTop: 6 }}>{r.warning}</div>}
            </button>
          ))}
          {remote.length > 0 && (
            <>
              <div className="native" style={{ marginTop: 20 }}>
                <strong>On someone else's</strong> — These run on {name}'s servers. What you say in a conversation is
                sent there.
              </div>
              {remote.map((r) => (
                <button
                  key={r.id}
                  className={`pick ${selected === r.id ? "on" : ""}`}
                  title={r.id}
                  onClick={() => {
                    setModels((m) => ({ ...m, [prov]: r.id }));
                    clearPlacement(); // a pending test was written for the old model
                  }}
                >
                  <div className="big" style={{ fontSize: 19 }}>
                    {prettyModel(r.id)}
                    {r.recommended && <span className="rec">Recommended</span>}
                  </div>
                  <div className="small" style={{ lineHeight: 1.5 }}>{r.hint}</div>
                  {r.warning && <div className="warn" style={{ marginTop: 6 }}>{r.warning}</div>}
                </button>
              ))}
            </>
          )}
        </div>

        {selectedRemote && (
          <div className="warn" style={{ marginTop: 16 }}>
            The model you have chosen runs on {name}'s servers, so the promise that nothing leaves this machine does
            not hold for it.
          </div>
        )}

        <details className="native" style={{ marginTop: 20 }}>
          <summary>Advanced</summary>
          <div className="row" style={{ marginTop: 12 }}>
            {INSTALLS.map((p, i) => (
              <button
                key={p.id}
                className={`pick ${prov === p.id ? "on" : ""}`}
                style={{ flex: 1 }}
                onClick={() => {
                  touched.current = true;
                  setProv(p.id);
                }}
              >
                <span className="tag">{i + 1}</span>
                <div className="big" style={{ fontSize: 18 }}>{p.name}</div>
              </button>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Server</label>
            <input value={host} onChange={(e) => setHosts((h) => ({ ...h, [prov]: e.target.value }))} />
          </div>
        </details>

        {verify === "busy" && <div className="native" style={{ marginTop: 20 }}>Asking the model to say hello…</div>}
        {verify === "ok" && probe?.ok && (
          <div className="native" style={{ marginTop: 20 }}>
            Model responds — {(probe.ms / 1000).toFixed(1)}s
            {slow && (
              <>
                <div className="warn" style={{ marginTop: 8 }}>{slow}</div>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => setStep(4)}>
                  Continue anyway →
                </button>
              </>
            )}
          </div>
        )}
        {verify === "idle" && probe && !probe.ok && (() => {
          const t = troubleFrom(probe, name, hosts[prov], models[prov]);
          return (
            <div className="native" style={{ marginTop: 20 }}>
              <div className="err">{t!.why}</div>
              <div className="small" style={{ marginTop: 6 }}>{t!.next}</div>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => void check()}>
                Try again
              </button>
            </div>
          );
        })()}

        <button className="btn" style={{ marginTop: 32 }} disabled={verify === "busy"} onClick={() => void check()}>
          Continue →
        </button>
      </>
    );
  };

  const stepUi = () => {
    UI_LANGUAGES.forEach((code, i) => {
      picks[i] = () => {
        setUi(code);
        setNativeLang(langName(code));
      };
    });
    onEnter = () => setStep(1); // always available; one option is always selected
    return (
      <>
        {!settings.onboarded && (
          <div className="native">
            <strong>Used Verba before?</strong> If you keep your data in a synced folder — iCloud Drive, Google Drive, a
            drive you carry — point Verba at it and your words, history and setup come back. Nothing here to answer
            again.
            <div style={{ marginTop: 10 }}>
              <button className="btn sm ghost" onClick={() => void restoreFromFolder()} disabled={!!restoring}>
                {restoring || "Restore from a folder…"}
              </button>
            </div>
            {restoreErr && (
              <div className="warn" style={{ marginTop: 10 }}>
                {restoreErr}
              </div>
            )}
          </div>
        )}
        <h1>Which language should Verba speak to you in?</h1>
        <div className="sub">
          You can change this later in Settings. It is also the language your corrections will be written in.
        </div>
        <div className="grid3">
          {UI_LANGUAGES.map((code, i) => (
            <button key={code} className={`pick ${ui === code ? "on" : ""}`} onClick={() => { setUi(code); setNativeLang(langName(code)); }}>
              <span className="tag">{i + 1}</span>
              <div className="big">{endonym(code)}</div>
              <div className="small">{langName(code)}</div>
            </button>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 32 }} onClick={() => setStep(1)}>
          Continue →
        </button>
      </>
    );
  };

  const stepLanguage = () => {
    packs.forEach((p, i) => {
      if (i < 9)
        picks[i] = () => {
          setPackId(p.id);
          clearPlacement(); // a pending test was written for the old language
        };
    });
    // §6: the same two languages can never stand together — and the clash is a
    // question, not a dead end (the patch below would be refused and the learner
    // would never learn why). There is no "yes, both English" branch.
    const clash = pack ? sameLanguage(pack.name, nativeLang) : false;
    onEnter = packId && !clash ? () => setStep(2) : undefined;
    return (
      <>
        <h1>Which language are you learning?</h1>
        <div className="grid3">
          {packs.map((p) => {
            const origin = packOrigin(p.id);
            return (
              <button
                key={p.id}
                className={`pick ${packId === p.id ? "on" : ""}`}
                onClick={() => setPackId(p.id)}
              >
                {origin && (
                  <span className="tag" title={PACK_ORIGIN_NOTE[origin]}>
                    {originLabel(origin)}
                  </span>
                )}
                <div className="big">{p.nativeName}</div>
                <div className="small">{langNameIn(p.id, langCode(nativeLang) || "en")}</div>
              </button>
            );
          })}
        </div>
        {clash ? (
          <div className="native" style={{ marginTop: 26 }}>
            You already speak {nativeLang} — so which is it?
            <div style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => setForceNative((n) => n + 1)}>
                I'm learning {nativeLang}. Change my native language
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn sm ghost" onClick={() => setPackId("")}>
                Pick a different language to learn
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className="btn" style={{ marginTop: 32 }} disabled={!packId} onClick={() => setStep(2)}>
              Continue →
            </button>
            {!packId && (
              <div className="native" style={{ marginTop: 26 }}>
                Pick a language to continue
              </div>
            )}
          </>
        )}
        <NativePicker
          key={forceNative}
          value={nativeLang}
          onChange={setNativeLang}
          exclude={lang}
          defaultOpen={forceNative > 0}
          prefix="Explanations and corrections will be written in "
        />
      </>
    );
  };

  const stepLevel = () => {
    if (mode === "pick") {
      LEVELS.forEach(([l], i) => {
        picks[i] = () => setCefr(l); // selecting a card sets the level, does not advance
      });
      onEnter = () => advance(5, cefr);
      return (
        <>
          <h1>Where are you starting from?</h1>
          <div className="sub">
            Your conversations keep calibrating this, so a rough answer is fine — and you can change it any time in
            Settings.
          </div>
          {testErr && <div className="err">{testErr}</div>}
          <div className="col">
            {LEVELS.map(([l, title, desc], i) => (
              <button
                key={l}
                className={`pick ${cefr === l ? "on" : ""}`}
                onClick={() => setCefr(l)}
              >
                <span className="tag">{i + 1}</span>
                <div className="big" style={{ fontSize: 20 }}>
                  {title} · {l}
                </div>
                <div className="small" style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
                  {desc}
                </div>
              </button>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 32 }} onClick={() => advance(5, cefr)}>
            Continue →
          </button>
          <div style={{ marginTop: 16 }}>
            <button className="link" onClick={() => void startTest()}>
              Not sure? Take a short test →
            </button>
          </div>
        </>
      );
    }

    if (mode === "busy") {
      onEnter = undefined; // Esc already goes back (see back())
      return (
        <>
          <h1>Writing your test…</h1>
          <div className="sub">
            {prettyModel(models[prov])} is writing eight questions in {lang}. This is the slowest part of setup —
            usually well under a minute.
          </div>
          <div className="native">
            {Math.round((now - waitedAt) / 1000)}s so far
          </div>
          <div className="row" style={{ marginTop: 24, gap: 12 }}>
            <button
              className="btn ghost"
              onClick={() => {
                cancelled.current = true;
                clearPlacement();
                setMode("pick");
              }}
            >
              Cancel
            </button>
            <button
              className="btn"
              onClick={() => {
                cancelled.current = true;
                setMode("pick");
              }}
            >
              I'll pick my level myself
            </button>
          </div>
        </>
      );
    }

    if (mode === "test") {
      const q = quiz[qi];
      q.options.forEach((_, i) => (picks[i] = () => answer(i)));
      picks[q.options.length] = () => answer(-1); // the skip has a number key too
      return (
        <>
          <div className="meter" style={{ margin: "18px 0 26px" }}>
            <div style={{ width: `${(qi / quiz.length) * 100}%` }} />
          </div>
          <h1 style={{ fontSize: 32, margin: "0 0 28px" }}>{q.prompt}</h1>
          <div className="col">
            {q.options.map((o, i) => (
              <button key={i} className="pick" onClick={() => answer(i)}>
                <span className="tag">{i + 1}</span>
                <div className="big" style={{ fontSize: 19 }}>
                  {o}
                </div>
              </button>
            ))}
          </div>
          <div className="native">
            Question {qi + 1} of {quiz.length} · Skip if you do not know it. You can change your level any time.
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="link" onClick={() => answer(-1)}>
              Skip this one →
            </button>
          </div>
        </>
      );
    }

    // result — proposed, never imposed
    onEnter = () => advance(5, cefr);
    return (
      <>
        <h1>You're around {cefr}.</h1>
        <div className="sub">
          You answered {answers.filter((a, i) => a === quiz[i]?.answer).length} of {quiz.length} correctly. That is
          where Day 1 will start. Change it here if it feels wrong — the coach keeps adjusting either way.
        </div>
        <div className="native" style={{ marginBottom: 12 }}>
          Start me at
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 10, marginBottom: 36 }}>
          {CEFR_LEVELS.map((l) => (
            <button key={l} className={`chip ${cefr === l ? "on" : ""}`} onClick={() => setCefr(l)}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => advance(5, cefr)}>
          {only ? "Save this level →" : "Continue →"}
        </button>
      </>
    );
  };

  const stepRhythm = () => {
    TIMES.forEach(([n], i) => (picks[i] = () => setMinutes(n)));
    onEnter = () => setStep(3);
    return (
      <>
        <h1>How much time, most days?</h1>
        <div className="row" style={{ marginBottom: 36 }}>
          {TIMES.map(([n, desc], i) => (
            <button
              key={n}
              className={`pick ${minutes === n ? "on" : ""}`}
              style={{ flex: 1, textAlign: "center" }}
              onClick={() => setMinutes(n)}
            >
              <span className="tag">{i + 1}</span>
              <div className="big" style={{ fontSize: 26 }}>
                {n} min
              </div>
              <div className="small">{desc}</div>
            </button>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 32 }} onClick={() => setStep(3)}>
          Continue →
        </button>
      </>
    );
  };

  const stepReady = () => {
    onEnter = () => onDone(patch());
    const line = pack?.id === "es" ? "Hola. Empezamos cuando quieras." : "This is the voice Verba will use.";
    const testMic = async () => {
      try {
        const stream = await mic(settings.micDeviceId);
        stream.getTracks().forEach((t) => t.stop());
        setMicMsg({ ok: true, text: "Microphone works." });
      } catch (e) {
        setMicMsg({ ok: false, text: micTrouble(e) });
      }
    };
    return (
      <>
        <h1>Day 1 starts now.</h1>
        {/* daySummary ends in a full stop of its own — a second one reads as a typo. */}
        <div className="sub">{daySummary(preview)}</div>
        {speech.canSpeak && (
          <button className="btn" style={{ marginTop: 20 }} onClick={() => void speech.speak(line, { locale: pack?.speech.locale })}>
            Hear the coach
          </button>
        )}
        {speech.canListen && (
          <button className="btn" style={{ marginTop: 20 }} onClick={() => void testMic()}>
            Test your microphone
          </button>
        )}
        {micMsg && (
          <div className={micMsg.ok ? "native" : "err"} style={{ marginTop: 12 }}>
            {micMsg.text}
          </div>
        )}
        <div className="native" style={{ marginTop: 26 }}>
          {dataDir ? `Everything you do stays in ${dataDir} on this machine.` : "Everything you do stays on this machine."}{" "}
          {/* Not a bare href: App switches space on hashchange, so a plain link out of
              here abandons setup with nothing written and every answer lost. Setup is
              finished first, then the panel opens — `onDone`'s destination exists for
              exactly this. */}
          <button
            className="link"
            onClick={() => {
              window.location.hash = AT.privacy;
              onDone(patch(), "settings");
            }}
          >
            Keep a copy in a folder you choose
          </button>
        </div>
        <button className="btn" style={{ marginTop: 32 }} onClick={() => onDone(patch())}>
          Start Day 1 →
        </button>
      </>
    );
  };

  const body = [stepUi, stepLanguage, stepRhythm, stepModel, stepLevel, stepReady][step]();

  return (
    <div className="onb">
      <div className="mark">
        Verba<span style={{ color: "var(--accent)" }}>.</span>
      </div>

      <div className="onb-esc">
        {/* Skip sits on the same screen, in the same place, on every step (§6). It
            does not act the same on every step: on the model step it can only say
            why it cannot skip (there is nothing to talk to without a model), and on
            a single-step run there is no setup to skip at all. What it assumes is
            held once, in lib/settings, and read from here. */}
        {!only && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button
              className="skip"
              onClick={() => {
                if (step === 3) return setSkipTried(true);
                skip();
              }}
              title={skipNote(nativeLang)}
            >
              Skip setup →
            </button>
            <span className="native" style={{ width: 230, fontSize: 11, lineHeight: 1.4, textAlign: "right" }}>
              {skipNote(nativeLang)}
            </span>
          </div>
        )}
        {onExit && (
          <button className="skip esc" onClick={onExit}>
            <span className="kbd">esc</span> {only ? "Back to settings" : "Leave setup"}
          </button>
        )}
      </div>

      <div className="sheet">
        <div className="eyebrow">{only ? "Your level" : STEP_LABELS[step]}</div>
        {body}

        <div className="hints" style={{ marginTop: 40 }}>
          <Hints
            settings={settings}
            surface="onboarding"
            has={[
              // `picks` gates the row; `picks:N` feeds the label's real count.
              picks.length > 0 ? "picks" : "",
              picks.length > 0 ? `picks:${picks.length}` : "",
              onEnter ? "enter" : "",
              // Esc on the first step of a fresh install has nothing to go back
              // to — it leaves the field instead. The label follows the state.
              step === 0 && !onExit ? "field" : "back",
            ]}
          />
        </div>
      </div>
    </div>
  );
}
