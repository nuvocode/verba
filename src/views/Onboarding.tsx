import { useCallback, useEffect, useMemo, useState } from "react";
import { SKIP_DEFAULTS, type ProviderId, type Settings } from "../lib/settings";
import { getPack, listPacks, packOrigin, originLabel, type PackOrigin } from "../lib/packs";
import { endonym, langCode, langName, langNameIn, languages, UI_LANGUAGES } from "../lib/langs";
import { sameLanguage } from "../lib/rules";
import { listModels, type LocalProvider } from "../lib/models";
import { getProvider } from "../lib/providers";
import { CEFR_LEVELS, type CEFRLevel } from "../lib/model";
import { LEVELS, TIMES } from "../lib/choices";
import { parsePlacement, placementPrompt, scorePlacement, type PlacementQ } from "../lib/placement";
import { attach, detach, pickFolder, pull } from "../lib/vault";
import { live } from "../lib/keys";
import Hints from "./Hints";

/** Every CEFR level is selectable — the test only proposes one. */
const AI: { id: LocalProvider; name: string; desc: string; host: string }[] = [
  {
    id: "ollama",
    name: "Ollama",
    desc: "Runs on this machine. Private, free, works on a plane.",
    host: "http://localhost:11434",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    desc: "Local OpenAI-compatible server. No key needed.",
    host: "http://localhost:1234/v1",
  },
];

const STEP_LABELS = ["Before we start", "Setup · 1 of 4", "Setup · 2 of 4", "Setup · 3 of 4", "Setup · 4 of 4", "Your plan"];

type LevelMode = "intro" | "busy" | "test" | "manual" | "result";

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

/** The offered interface language that matches the OS locale, or English. */
function pickUi(locale: string): string {
  const base = (locale.split("-")[0] || "").toLowerCase();
  return (UI_LANGUAGES as readonly string[]).includes(base) ? base : "en";
}

export default function Onboarding({
  settings,
  onDone,
  onExit,
  only,
}: {
  settings: Settings;
  onDone: (patch: Partial<Settings>, dest?: "today" | "settings") => void;
  /** Present only on a replay — a first run has nowhere to escape to. */
  onExit?: () => void;
  /**
   * Run one step on its own and hand the answer straight back to where the
   * learner came from. Settings → Learning uses this for "I'm not sure — take a
   * short test": §5.3 asks for *the setup test*, not a second one written to
   * live in Settings, and two placement tests would be two things to keep true.
   */
  only?: { step: number; back: "settings" };
}) {
  const packs = listPacks();
  const [step, setStep] = useState(only?.step ?? 0);

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
      setRestoreErr(String(e?.message ?? e));
      setRestoring("");
    }
  };

  // ---- AI (step 0) ----
  const [prov, setProv] = useState<LocalProvider>(settings.provider === "lmstudio" ? "lmstudio" : "ollama");
  const [hosts, setHosts] = useState({ ollama: settings.ollamaHost, lmstudio: settings.lmstudioHost });
  const [models, setModels] = useState({ ollama: settings.ollamaModel, lmstudio: settings.lmstudioModel });
  // null while the probe is in flight; null after it fails means "server never answered".
  const [found, setFound] = useState<string[] | null>(null);
  const [probing, setProbing] = useState(true);

  // Nothing is pre-selected on a fresh install — a default target language would be a silent
  // guess. On a replay, the learner's current pack is shown as chosen.
  const [packId, setPackId] = useState(settings.onboarded ? settings.packId : "");
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
  const [mode, setMode] = useState<LevelMode>("intro");
  const [quiz, setQuiz] = useState<PlacementQ[]>([]);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [testErr, setTestErr] = useState("");

  const host = hosts[prov];
  const model = models[prov];
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

  // Probe the chosen server whenever the provider or its host changes.
  useEffect(() => {
    let live = true;
    setProbing(true);
    void listModels(prov, host).then((list) => {
      if (!live) return;
      setFound(list?.map((m) => m.id) ?? null);
      setProbing(false);
      // Adopt the first served model only if the current one isn't there — never overwrite a real choice.
      if (list?.length && !list.some((m) => m.id === models[prov]))
        setModels((m) => ({ ...m, [prov]: list[0].id }));
    });
    return () => {
      live = false;
    };
  }, [prov, host]);

  const startTest = useCallback(async () => {
    setMode("busy");
    setTestErr("");
    try {
      const s = draft();
      const raw = await getProvider(s).chat([{ role: "user", content: placementPrompt(s, getPack(s.packId)) }], {
        json: true,
      });
      const qs = parsePlacement(raw);
      if (!qs) throw new Error("The model didn't return a usable test.");
      setQuiz(qs);
      setQi(0);
      setAnswers([]);
      setMode("test");
    } catch (e: any) {
      setTestErr(`${String(e?.message ?? e)} — pick your level by hand instead.`);
      setMode("manual");
    }
  }, [prov, host, model, packId, nativeLang]);

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
    setStep(5);
  };

  // ---- keyboard: the whole flow is drivable without a mouse ----
  // Options are numbered 1–9, Enter continues, Esc goes back one step (and leaves setup on a replay).
  const picks: (() => void)[] = [];
  let onEnter: (() => void) | undefined;

  const back = () => {
    if (step === 4 && mode !== "intro") return setMode("intro"); // out of the test, not out of the step
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

  const changeLink = (to: number) => (
    <button className="link" onClick={() => setStep(to)}>
      change
    </button>
  );

  // ---- step bodies (each one registers its number keys and its Enter action) ----

  const stepAi = () => {
    AI.forEach((p, i) => (picks[i] = () => setProv(p.id)));
    onEnter = model.trim() ? () => setStep(4) : undefined;
    return (
      <>
        <h1>Where should the AI run?</h1>
        <div className="sub">
          Verba needs a model to talk to. Both options run on your own machine — nothing leaves it. Start the server,
          then pick the model you pulled.
        </div>
        <div className="row" style={{ marginBottom: 22 }}>
          {AI.map((p, i) => (
            <button
              key={p.id}
              className={`pick ${prov === p.id ? "on" : ""}`}
              style={{ flex: 1 }}
              onClick={() => setProv(p.id)}
            >
              <span className="tag">{i + 1}</span>
              <div className="big" style={{ fontSize: 20 }}>
                {p.name}
              </div>
              <div className="small" style={{ lineHeight: 1.5 }}>
                {p.desc}
              </div>
            </button>
          ))}
        </div>

        <div className="field">
          <label>Server</label>
          <input value={host} onChange={(e) => setHosts((h) => ({ ...h, [prov]: e.target.value }))} />
        </div>
        <div className="field">
          <label>Model</label>
          <input
            value={model}
            placeholder="Type a model name, or pick one below"
            onChange={(e) => setModels((m) => ({ ...m, [prov]: e.target.value }))}
          />
        </div>

        <div className="native" style={{ marginTop: 12 }}>
          {probing && "Looking for the server…"}
          {!probing && found === null && (
            <span className="warn">
              <strong>No answer from {host}</strong> — start {AI.find((p) => p.id === prov)!.name}, or type the model
              name anyway and fix the server later in Settings.
            </span>
          )}
          {!probing && found?.length === 0 && (
            <span className="warn">
              <strong>Server is up, but serving no models.</strong> Pull one first.
            </span>
          )}
          {!probing && !!found?.length && (
            <>
              <strong>{found.length} models available</strong> — click one, or keep what you typed.
              <div className="lang-list">
                {found.map((m) => (
                  <button
                    key={m}
                    className={`lang-opt ${m === model ? "on" : ""}`}
                    onClick={() => setModels((s) => ({ ...s, [prov]: m }))}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button className="btn" style={{ marginTop: 32 }} disabled={!model.trim()} onClick={() => setStep(4)}>
          Continue →
        </button>
        {/* Not a silent disabled (#42): the field is empty, so there is no model to continue with. */}
        {!model.trim() && (
          <div className="model" style={{ color: "var(--ink3)", marginTop: 8 }}>
            Type a model name to continue
          </div>
        )}
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
    if (mode === "intro") {
      picks[0] = () => void startTest();
      picks[1] = () => setMode("manual");
      onEnter = () => void startTest();
      return (
        <>
          <h1>Let's find your level.</h1>
          <div className="sub">
            {quiz.length || 8} short questions in {lang}, written by your own model and graded on this machine. It takes
            two minutes, and you can overrule the result on the next screen.
          </div>
          {testErr && <div className="err">{testErr}</div>}
          <div className="col">
            <button className="pick" onClick={() => void startTest()}>
              <span className="tag">1</span>
              <div className="big" style={{ fontSize: 20 }}>
                Take the test
              </div>
              <div className="small" style={{ lineHeight: 1.5 }}>
                Multiple choice, from A1 up to C2. We stop where you stop.
              </div>
            </button>
            <button className="pick" onClick={() => setMode("manual")}>
              <span className="tag">2</span>
              <div className="big" style={{ fontSize: 20 }}>
                I'll pick it myself
              </div>
              <div className="small" style={{ lineHeight: 1.5 }}>
                You already know where you are. A1 through C2, your call.
              </div>
            </button>
          </div>
        </>
      );
    }

    if (mode === "busy")
      return (
        <>
          <h1>Writing your test…</h1>
          <div className="sub">{model} is drafting eight questions in {lang}. This is the slowest part of setup.</div>
        </>
      );

    if (mode === "manual") {
      LEVELS.forEach(([l], i) => {
        picks[i] = () => {
          setCefr(l);
          advance(5, l);
        };
      });
      return (
        <>
          <h1>Where are you starting from?</h1>
          <div className="sub">
            Your conversations keep calibrating this, so a rough answer is fine.
          </div>
          {testErr && <div className="err">{testErr}</div>}
          <div className="col">
            {LEVELS.map(([l, title, desc], i) => (
              <button
                key={l}
                className={`pick ${cefr === l ? "on" : ""}`}
                onClick={() => {
                  setCefr(l);
                  advance(5, l);
                }}
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
        </>
      );
    }

    if (mode === "test") {
      const q = quiz[qi];
      q.options.forEach((_, i) => (picks[i] = () => answer(i)));
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
            Question {qi + 1} of {quiz.length} · guessing is fine — a wrong answer just sets your ceiling.
          </div>
        </>
      );
    }

    // result — proposed, never imposed
    onEnter = () => advance(5);
    return (
      <>
        <h1>You're around {cefr}.</h1>
        <div className="sub">
          You answered {answers.filter((a, i) => a === quiz[i]?.answer).length} of {quiz.length} correctly. Day 1 starts
          here — change it if it feels wrong, and the coach keeps adjusting either way.
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 10, marginBottom: 36 }}>
          {CEFR_LEVELS.map((l) => (
            <button key={l} className={`chip ${cefr === l ? "on" : ""}`} onClick={() => setCefr(l)}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => advance(5)}>
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

  const stepPlan = () => {
    onEnter = () => onDone(patch());
    const aiName = AI.find((p) => p.id === prov)!.name;
    return (
      <>
        <h1 style={{ lineHeight: 1.15, marginBottom: 28 }}>Your plan is ready.</h1>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <div className="plan-row">
            <div className="key">AI</div>
            <div className={`val ${found === null && !probing ? "warn" : ""}`}>
              <strong>
                {aiName} · {model}
              </strong>{" "}
              — {found === null && !probing ? "not answering yet; start it and Verba will connect." : "runs locally, nothing leaves your machine."}{" "}
              {changeLink(3)}
            </div>
          </div>
          <div className="plan-row">
            <div className="key">LANGUAGE</div>
            <div className="val">
              <strong>{lang}</strong> — the {lang} pack ships with the app. Grammar and pronunciation notes are fed
              straight into every conversation. {changeLink(1)}
            </div>
          </div>
          <div className="plan-row">
            <div className="key">NATIVE LANGUAGE</div>
            <div className="val">
              <NativePicker
                value={nativeLang}
                onChange={setNativeLang}
                exclude={lang}
                prefix="Corrections and explanations are written in "
              />
            </div>
          </div>
          <div className="plan-row">
            <div className="key">LEVEL</div>
            <div className="val">
              {cefr ? (
                <>
                  Starting at <strong>{cefr}</strong>. {changeLink(4)}
                </>
              ) : (
                <>Unset — your first conversation places you. {changeLink(4)}</>
              )}
            </div>
          </div>
          <div className="plan-row">
            <div className="key">RHYTHM</div>
            <div className="val">
              About <strong>{minutes} minutes</strong> a day, conversation-first. Every session is planned fresh each
              morning from what you struggled with the day before. {changeLink(2)}
            </div>
          </div>
        </div>
        <button className="btn" style={{ marginTop: 32 }} onClick={() => onDone(patch())}>
          Start Day 1 →
        </button>
      </>
    );
  };

  const body = [stepUi, stepLanguage, stepRhythm, stepAi, stepLevel, stepPlan][step]();

  return (
    <div className="onb">
      <div className="mark">
        Verba<span style={{ color: "var(--accent)" }}>.</span>
      </div>

      <div className="onb-esc">
        {/* Skip needs a language and a model first — without them there is nothing to
            generate. On a single-step run there is no setup to skip: the learner
            came here to answer one question and already has everything else. */}
        {!only && (step === 1 || step === 2 || step === 4) && (
          <button
            className="skip"
            onClick={skip}
            title="Level: B1 · 45 minutes a day · your system language"
          >
            Skip setup →
          </button>
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
