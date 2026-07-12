import { useCallback, useEffect, useMemo, useState } from "react";
import { SKIP_DEFAULTS, type ProviderId, type Settings } from "../lib/settings";
import { listPacks, packOrigin, originLabel } from "../lib/packs";
import { languages } from "../lib/langs";
import { listModels, type LocalProvider } from "../lib/models";
import { getProvider } from "../lib/providers";
import { CEFR_LEVELS, type Cefr } from "../lib/level";
import { parsePlacement, placementPrompt, scorePlacement, type PlacementQ } from "../lib/placement";

/** Every CEFR level is selectable — the test only proposes one. */
const LEVELS: [Cefr, string, string][] = [
  ["A1", "Brand new", "I know a few words at most. Start me from zero, gently."],
  ["A2", "I can get by", "Ordering food, asking directions — but real conversations lose me fast."],
  ["B1", "Conversational", "I can hold a conversation but plateau on nuance, speed, and idiom."],
  ["B2", "Comfortable", "I'm fluent in most situations; I want nuance, idiom, and native speed."],
  ["C1", "Advanced", "I work or study in it. I'm after precision, register, and the last 5%."],
  ["C2", "Near-native", "I want to sound like someone who grew up with it."],
];

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

const TIMES: [number, string][] = [
  [20, "a focused burst"],
  [45, "the sweet spot"],
  [75, "deep immersion"],
];

const GOALS = ["Travel", "Work", "Family & friends", "Books & film"];

const STEP_LABELS = ["Setup · 1 of 4", "Setup · 2 of 4", "Setup · 3 of 4", "Setup · 4 of 4", "Your plan"];

type LevelMode = "intro" | "busy" | "test" | "manual" | "result";

/** "Native language: Turkish — change", where change opens a searchable list in place. */
function NativePicker({
  value,
  onChange,
  prefix,
}: {
  value: string;
  onChange: (name: string) => void;
  prefix?: string;
}) {
  const all = useMemo(languages, []);
  const [open, setOpen] = useState(false);
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

export default function Onboarding({
  settings,
  onDone,
  onExit,
}: {
  settings: Settings;
  onDone: (patch: Partial<Settings>, dest?: "today" | "settings") => void;
  /** Present only on a replay — a first run has nowhere to escape to. */
  onExit?: () => void;
}) {
  const packs = listPacks();
  const [step, setStep] = useState(0);

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
  const [nativeLang, setNativeLang] = useState(settings.nativeLang);
  const [cefr, setCefr] = useState(settings.onboarded ? settings.cefr : "");
  const [minutes, setMinutes] = useState(settings.dailyMinutes);
  const [goals, setGoals] = useState<string[]>(settings.goals);

  // ---- level test (step 2) ----
  const [mode, setMode] = useState<LevelMode>("intro");
  const [quiz, setQuiz] = useState<PlacementQ[]>([]);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [testErr, setTestErr] = useState("");

  const host = hosts[prov];
  const model = models[prov];
  const pack = packs.find((p) => p.id === packId);
  const lang = pack?.name ?? settings.targetLang;

  const patch = (): Partial<Settings> => ({
    provider: prov as ProviderId,
    ollamaHost: hosts.ollama,
    ollamaModel: models.ollama,
    lmstudioHost: hosts.lmstudio,
    lmstudioModel: models.lmstudio,
    packId,
    targetLang: lang,
    nativeLang,
    cefr,
    dailyMinutes: minutes,
    goals,
  });

  /** The settings the placement test itself must run under — the ones just chosen, not the saved ones. */
  const draft = (): Settings => ({ ...settings, ...patch() } as Settings);

  // Probe the chosen server whenever the provider or its host changes.
  useEffect(() => {
    let live = true;
    setProbing(true);
    void listModels(prov, host).then((list) => {
      if (!live) return;
      setFound(list);
      setProbing(false);
      // Adopt the first served model only if the current one isn't there — never overwrite a real choice.
      if (list?.length && !list.includes(models[prov])) setModels((m) => ({ ...m, [prov]: list[0] }));
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
      const raw = await getProvider(s).chat([{ role: "user", content: placementPrompt(s) }], { json: true });
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
    setCefr(SKIP_DEFAULTS.cefr);
    setMinutes(SKIP_DEFAULTS.dailyMinutes);
    setGoals(SKIP_DEFAULTS.goals);
    setStep(4);
  };

  // ---- keyboard: the whole flow is drivable without a mouse ----
  // Options are numbered 1–9, Enter continues, Esc goes back one step (and leaves setup on a replay).
  const picks: (() => void)[] = [];
  let onEnter: (() => void) | undefined;

  const back = () => {
    if (step === 2 && mode !== "intro") return setMode("intro"); // out of the test, not out of the step
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
    onEnter = model.trim() ? () => setStep(1) : undefined;
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

        <button className="btn" style={{ marginTop: 32 }} disabled={!model.trim()} onClick={() => setStep(1)}>
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
          setStep(2);
        };
    });
    onEnter = packId ? () => setStep(2) : undefined;
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
                onClick={() => {
                  setPackId(p.id);
                  setStep(2);
                }}
              >
                {origin && <span className="tag">{originLabel(origin)}</span>}
                <div className="big">{p.nativeName}</div>
                <div className="small">{p.name}</div>
              </button>
            );
          })}
        </div>
        <NativePicker value={nativeLang} onChange={setNativeLang} prefix="Native language: " />
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
          setStep(3);
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
                  setStep(3);
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
    onEnter = () => setStep(3);
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
        <button className="btn" onClick={() => setStep(3)}>
          Continue →
        </button>
      </>
    );
  };

  const stepRhythm = () => {
    TIMES.forEach(([n], i) => (picks[i] = () => setMinutes(n)));
    onEnter = () => setStep(4);
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
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          Mostly for <span className="opt">optional</span>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 10, marginBottom: 40 }}>
          {GOALS.map((g) => (
            <button
              key={g}
              className={`chip ${goals.includes(g) ? "on" : ""}`}
              onClick={() => setGoals((gs) => (gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]))}
            >
              {g}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setStep(4)}>
          Build my plan →
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
              {changeLink(0)}
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
                prefix="Corrections and explanations are written in "
              />
            </div>
          </div>
          <div className="plan-row">
            <div className="key">LEVEL</div>
            <div className="val">
              {cefr ? (
                <>
                  Starting at <strong>{cefr}</strong>. {changeLink(2)}
                </>
              ) : (
                <>Unset — your first conversation places you. {changeLink(2)}</>
              )}
            </div>
          </div>
          <div className="plan-row">
            <div className="key">RHYTHM</div>
            <div className="val">
              About <strong>{minutes} minutes</strong> a day, conversation-first. Every session is planned fresh each
              morning from what you struggled with the day before. {changeLink(3)}
            </div>
          </div>
        </div>
        <button className="btn" style={{ marginTop: 32 }} onClick={() => onDone(patch())}>
          Start Day 1 →
        </button>
      </>
    );
  };

  const body = [stepAi, stepLanguage, stepLevel, stepRhythm, stepPlan][step]();

  return (
    <div className="onb">
      <div className="mark">
        Verba<span style={{ color: "var(--accent)" }}>.</span>
      </div>

      <div className="onb-esc">
        {/* Skip needs a language and a model first — without them there is nothing to generate. */}
        {(step === 2 || step === 3) && (
          <button className="skip" onClick={skip} title="Level: placed in your first conversation · 20 min a day">
            Skip setup →
          </button>
        )}
        {onExit && (
          <button className="skip esc" onClick={onExit}>
            <span className="kbd">esc</span> Leave setup
          </button>
        )}
      </div>

      <div className="sheet">
        <div className="eyebrow">{STEP_LABELS[step]}</div>
        {body}

        <div className="hints" style={{ marginTop: 40 }}>
          {picks.length > 0 && (
            <span>
              <span className="kbd">1–{Math.min(picks.length, 9)}</span> choose
            </span>
          )}
          {onEnter && (
            <span>
              <span className="kbd">↵</span> continue
            </span>
          )}
          <span>
            <span className="kbd">esc</span> {step === 0 && !onExit ? "leave a field" : "back"}
          </span>
        </div>
      </div>
    </div>
  );
}
