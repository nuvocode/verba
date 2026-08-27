// Settings → Privacy and data (spec §5.5). The offline lock and where the data
// lives are two halves of one question — "what leaves this machine, and what can
// I do with what stays" — so they share a page.
import DataPanel from "../DataPanel";
import { ToggleRow, type SectionProps } from "./parts";

export default function Privacy({
  settings,
  onChange,
  appVersion,
}: SectionProps & { appVersion: string }) {
  return (
    <>
      <div className="sec">Offline mode</div>
      <ToggleRow
        title="Never leave this machine"
        desc="Forces local providers only. Cloud options are closed and no learner data ever leaves your device."
        on={settings.offline}
        // Everything the lock drags with it — the provider, the cloud voices —
        // and the sentence it writes are lib/rules' business, not this row's.
        onClick={() => onChange({ offline: !settings.offline })}
      />

      <DataPanel
        appVersion={appVersion}
        offline={settings.offline}
        beta={settings.betaUpdates}
        onBeta={(betaUpdates) => onChange({ betaUpdates })}
      />
    </>
  );
}
