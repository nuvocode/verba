import { useState } from "react";
import type { Settings } from "../lib/settings";
import { listPacks } from "../lib/packs";

const LEVELS: [string, string, string][] = [
  ["Brand new", "A1", "I know a few words at most. Start me from zero, gently."],
  ["I can get by", "A2", "Ordering food, asking directions — but real conversations lose me fast."],
  ["Conversational", "B1", "I can hold a conversation but plateau on nuance, speed, and idiom."],
];

const TIMES: [number, string][] = [
  [20, "a focused burst"],
  [45, "the sweet spot"],
  [75, "deep immersion"],
];

const GOALS = ["Travel", "Work", "Family & friends", "Books & film"];

const STEP_LABELS = ["Welcome · 1 of 3", "Welcome · 2 of 3", "Welcome · 3 of 3", "Your plan"];

export default function Onboarding({
  settings,
  onDone,
  onSkip,
}: {
  settings: Settings;
  onDone: (patch: Partial<Settings>) => void;
  onSkip: () => void;
}) {
  const packs = listPacks();
  const [step, setStep] = useState(0);
  const [packId, setPackId] = useState(settings.packId);
  const [cefr, setCefr] = useState(settings.cefr);
  const [minutes, setMinutes] = useState(settings.dailyMinutes);
  const [goal, setGoal] = useState(settings.goal);

  const pack = packs.find((p) => p.id === packId);
  const lang = pack?.name ?? settings.targetLang;

  return (
    <div className="onb">
      <div className="mark">
        Speaksy<span style={{ color: "var(--accent)" }}>.</span>
      </div>
      <button className="skip" onClick={onSkip}>
        Skip setup →
      </button>

      <div className="sheet">
        <div className="eyebrow">{STEP_LABELS[step]}</div>

        {step === 0 && (
          <>
            <h1>Which language are you learning?</h1>
            <div className="grid3">
              {packs.map((p) => (
                <button
                  key={p.id}
                  className={`pick ${packId === p.id ? "on" : ""}`}
                  onClick={() => {
                    setPackId(p.id);
                    setStep(1);
                  }}
                >
                  <div className="big">{p.nativeName}</div>
                  <div className="small">{p.name}</div>
                </button>
              ))}
            </div>
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
              {LEVELS.map(([title, level, desc]) => (
                <button
                  key={level}
                  className={`pick ${cefr === level ? "on" : ""}`}
                  onClick={() => {
                    setCefr(level);
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
              Mostly for
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 10, marginBottom: 40 }}>
              {GOALS.map((g) => (
                <button key={g} className={`chip ${goal === g ? "on" : ""}`} onClick={() => setGoal(g)}>
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
                  straight into every conversation.
                </div>
              </div>
              <div className="plan-row">
                <div className="key">RHYTHM</div>
                <div className="val">
                  About <strong>{minutes} minutes</strong> a day, conversation-first. Every session is planned fresh
                  each morning from what you struggled with the day before.
                </div>
              </div>
              <div className="plan-row">
                <div className="key">FIRST STEP</div>
                <div className="val">
                  A short, low-stakes conversation. Not a test — the coach just listens and places you on the CEFR scale
                  so Day 1 starts at the right difficulty.
                </div>
              </div>
            </div>
            <button
              className="btn"
              style={{ marginTop: 32 }}
              onClick={() => onDone({ packId, targetLang: lang, cefr, dailyMinutes: minutes, goal })}
            >
              Start Day 1 →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
