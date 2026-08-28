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
      {/* The name of a setting, not a slogan (§5.5) — it says what it does to the
          machine, and the sentence under it says what that costs. */}
      <div data-setting="offline">
        <ToggleRow
          title="Use this computer only"
          desc="Models that run over the network are closed, and so are the voices that do. Verba works from what is installed here, and nothing you say, write or save leaves this computer."
          on={settings.offline}
          // Everything the lock drags with it — the provider, the cloud voices —
          // and the sentence it writes are lib/rules' business, not this row's.
          onClick={() => onChange({ offline: !settings.offline })}
        />
      </div>

      <DataPanel
        appVersion={appVersion}
        offline={settings.offline}
        beta={settings.betaUpdates}
        onBeta={(betaUpdates) => onChange({ betaUpdates })}
      />
    </>
  );
}
