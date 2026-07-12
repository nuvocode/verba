import { useEffect, useState } from "react";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import { vocabCounts } from "./lib/db";
import Daily from "./views/Daily";
import Chat from "./views/Chat";
import Reading from "./views/Reading";
import Vocabulary from "./views/Vocabulary";
import SettingsView from "./views/Settings";
import "./App.css";

type Tab = "daily" | "chat" | "reading" | "vocab" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("daily");
  const [settings, setSettings] = useState<Settings>(loadSettings());
  const [due, setDue] = useState(0);

  useEffect(() => {
    vocabCounts()
      .then((c) => setDue(c.due))
      .catch(() => {});
  }, [tab]);

  function update(s: Settings) {
    setSettings(s);
    saveSettings(s);
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">❄️ Speaksy</div>
        <button className={tab === "daily" ? "active" : ""} onClick={() => setTab("daily")}>
          🗓️ Today
        </button>
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
          💬 Conversation
        </button>
        <button className={tab === "reading" ? "active" : ""} onClick={() => setTab("reading")}>
          📖 Reading
        </button>
        <button className={tab === "vocab" ? "active" : ""} onClick={() => setTab("vocab")}>
          🗂️ Vocabulary {due > 0 && <span className="badge">{due}</span>}
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          ⚙️ Settings
        </button>
        <div className="foot">
          {settings.targetLang} · {settings.provider}
        </div>
      </nav>
      <main className="content">
        {tab === "daily" && <Daily settings={settings} onNavigate={setTab} />}
        {tab === "chat" && <Chat settings={settings} />}
        {tab === "reading" && <Reading settings={settings} />}
        {tab === "vocab" && <Vocabulary />}
        {tab === "settings" && <SettingsView settings={settings} onChange={update} />}
      </main>
    </div>
  );
}
