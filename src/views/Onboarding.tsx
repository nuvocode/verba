import { useEffect, useMemo, useState } from "react";
import { SKIP_DEFAULTS, type Settings } from "../lib/settings";
import { listPacks, packOrigin, originLabel } from "../lib/packs";
import { languages } from "../lib/langs";
import { ollamaUp } from "../lib/providers/ollama";

const LEVELS: [string, string, string][] = [
  ["Brand new", "A1", "I know a few words at most. Start me from zero, gently."],
  ["I can get by", "A2", "Ordering food, asking directions — but real conversations lose me fast."],
  ["Conversational", "B1", "I can hold a conversation but plateau on nuance, speed, and idiom."],
  ["Comfortable", "B2", "I'm fluent in most situations; I want nuance, idiom, and native speed."],
];

const TIMES: [number, string][] = [
  [20, "a focused burst"],
  [45, "the sweet spot"],
  [75, "deep immersion"],
];

const GOALS = ["Travel", "Work", "Family & friends", "Books & film"];

const STEP_LABELS = ["Welcome · 1 of 3", "Welcome · 2 of 3", "Welcome · 3 of 3", "Your plan"];

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
}: {
  settings: Settings;
  onDone: (patch: Partial<Settings>, dest?: "today" | "settings") => void;
}) {
  const packs = listPacks();
  const [step, setStep] = useState(0);
  // Nothing is pre-selected on a fresh install — a default target language would be a silent
  // guess. On a replay, the learner's current pack is shown as chosen.
  const [packId, setPackId] = useState(settings.onboarded ? settings.packId : "");
  const [nativeLang, setNativeLang] = useState(settings.nativeLang);
  const [cefr, setCefr] = useState(settings.onboarded ? settings.cefr : "");
  const [minutes, setMinutes] = useState(settings.dailyMinutes);
  const [goals, setGoals] = useState<string[]>(settings.goals);
  // null while the probe is in flight — the AI row stays quiet rather than flashing a wrong answer.
  const [aiUp, setAiUp] = useState<boolean | null>(null);

  useEffect(() => {
    if (step !== 3) return;
    let live = true;
    void ollamaUp(settings.ollamaHost).then((up) => live && setAiUp(up));
    return () => {
      live = false;
    };
  }, [step, settings.ollamaHost]);

  const pack = packs.find((p) => p.id === packId);
  const lang = pack?.name ?? settings.targetLang;
  const levelName = LEVELS.find(([, l]) => l === cefr)?.[0];
  const patch = (): Partial<Settings> => ({ packId, targetLang: lang, nativeLang, cefr, dailyMinutes: minutes, goals });

  const skip = () => {
    setCefr(SKIP_DEFAULTS.cefr);
    setMinutes(SKIP_DEFAULTS.dailyMinutes);
    setGoals(SKIP_DEFAULTS.goals);
    setStep(3);
  };

  const changeLink = (to: number) => (
    <button className="link" onClick={() => setStep(to)}>
      change
    </button>
  );

  return (
    <div className="onb">
      <div className="mark">
        Speaksy<span style={{ color: "var(--accent)" }}>.</span>
      </div>
      {/* No skip on step 1: without a target language there is nothing to generate. */}
      {(step === 1 || step === 2) && (
        <button
          className="skip"
          onClick={skip}
          title="Level: we'll place you in your first conversation · 20 min a day"
        >
          Skip setup →
        </button>
      )}

      <div className="sheet">
        <div className="eyebrow">{STEP_LABELS[step]}</div>

        {step === 0 && (
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
                      setStep(1);
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
        )}

        {step === 1 && (
          <>
            <h1>Where are you starting from?</h1>
            <div className="sub">
              A rough guess is fine — your first conversation calibrates this precisely, and the plan adapts every day
              after.
            </div>
            <div className="col">
              {LEVELS.map(([title, l, desc]) => (
                <button
                  key={l}
                  className={`pick ${cefr === l ? "on" : ""}`}
                  onClick={() => {
                    setCefr(l);
                    setStep(2);
                  }}
                >
                  <div className="big" style={{ fontSize: 20 }}>
                    {title}
                  </div>
                  <div className="small" style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
                    {desc}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>How much time, most days?</h1>
            <div className="row" style={{ marginBottom: 36 }}>
              {TIMES.map(([n, desc]) => (
                <button
                  key={n}
                  className={`pick ${minutes === n ? "on" : ""}`}
                  style={{ flex: 1, textAlign: "center" }}
                  onClick={() => setMinutes(n)}
                >
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
            <button className="btn" onClick={() => setStep(3)}>
              Build my plan →
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 style={{ lineHeight: 1.15, marginBottom: 28 }}>Your plan is ready.</h1>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div className="plan-row">
                <div className="key">LANGUAGE</div>
                <div className="val">
                  <strong>{lang}</strong> — the {lang} pack ships with the app. Grammar and pronunciation notes are fed
                  straight into every conversation. {changeLink(0)}
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
                <div className="key">RHYTHM</div>
                <div className="val">
                  About <strong>{minutes} minutes</strong> a day, conversation-first
                  {levelName ? `, starting at ${levelName.toLowerCase()} (${cefr})` : ""}. Every session is planned fresh
                  each morning from what you struggled with the day before. {changeLink(2)}
                </div>
              </div>
              <div className="plan-row">
                <div className="key">AI</div>
                <div className={`val ${aiUp === false ? "warn" : ""}`}>
                  {aiUp === null && "Looking for a local AI…"}
                  {aiUp === true && (
                    <>
                      <strong>Ollama detected</strong> · runs locally, nothing leaves your machine.{" "}
                      <button className="link" onClick={() => onDone(patch(), "settings")}>
                        change
                      </button>
                    </>
                  )}
                  {aiUp === false && (
                    <>
                      <strong>No local AI found</strong> —{" "}
                      <button className="link" onClick={() => onDone(patch(), "settings")}>
                        connect a provider
                      </button>
                      .
                    </>
                  )}
                </div>
              </div>
              <div className="plan-row">
                <div className="key">FIRST STEP</div>
                <div className="val">
                  A short, low-stakes conversation. Not a test — the coach just listens and places you on the CEFR scale
                  so Day 1 starts at the right difficulty. {changeLink(1)}
                </div>
              </div>
            </div>
            <button className="btn" style={{ marginTop: 32 }} onClick={() => onDone(patch())}>
              Start Day 1 →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
