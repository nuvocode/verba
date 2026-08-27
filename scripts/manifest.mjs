// Writes the updater manifest for a release: which bundle each platform should
// download, and the minisign signature that proves it is ours.
//
// This is a separate script rather than jq in the workflow because of one
// hazard it exists to catch: on macOS the updater bundle is named
// `Verba.app.tar.gz` with no architecture in it, so both macOS legs of the
// build matrix produce the same filename. The release workflow renames them on
// upload; if that ever stops happening, the lookup here finds one darwin bundle
// where it wants two and refuses to write anything — rather than pointing
// Apple Silicon at an Intel build, which is a bad day for every installed copy.
//
// Usage: node scripts/manifest.mjs <tag> <assets.json> <sig-dir>
//        node scripts/manifest.mjs --self-check
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Each platform key the manifest must carry, and how to spot its bundle among
// the release's assets. Keys are the updater's own `OS-ARCH` format.
const PLATFORMS = {
  "darwin-aarch64": (name) => name.endsWith("_aarch64.app.tar.gz"),
  "darwin-x86_64": (name) => name.endsWith("_x86_64.app.tar.gz"),
  "linux-x86_64": (name) => name.endsWith(".AppImage"),
  "windows-x86_64": (name) => name.endsWith("-setup.exe"),
};

export function buildManifest({ tag, version, notes, pubDate, assets, signature, repoUrl }) {
  const platforms = {};
  const problems = [];

  for (const [key, matches] of Object.entries(PLATFORMS)) {
    const found = assets.filter(matches);

    if (found.length === 0) {
      problems.push(`${key}: no bundle among the release assets`);
      continue;
    }
    // Two matches means the macOS rename regressed, or a target started
    // emitting a second bundle. Either way we cannot tell which one is right.
    if (found.length > 1) {
      problems.push(`${key}: ${found.length} bundles match (${found.join(", ")})`);
      continue;
    }

    const sig = signature(`${found[0]}.sig`);
    if (!sig) {
      problems.push(`${key}: ${found[0]} has no .sig`);
      continue;
    }

    platforms[key] = {
      signature: sig.trim(),
      url: `${repoUrl}/releases/download/${tag}/${encodeURIComponent(found[0])}`,
    };
  }

  if (problems.length > 0) {
    throw new Error(`the release is not complete, so no manifest is written:\n  ${problems.join("\n  ")}`);
  }

  return { version, notes, pub_date: pubDate, platforms };
}

if (process.argv[2] === "--self-check") {
  const { default: assert } = await import("node:assert");

  const assets = [
    "Verba_0.4.0_aarch64.dmg",
    "Verba_aarch64.app.tar.gz",
    "Verba_x86_64.app.tar.gz",
    "Verba_0.4.0_amd64.AppImage",
    "Verba_0.4.0_x64-setup.exe",
    "Verba_0.4.0_amd64.deb",
  ];
  const ok = { tag: "v0.4.0", version: "0.4.0", notes: "n", pubDate: "d", assets, signature: () => "sig", repoUrl: "https://github.com/o/r" };

  const m = buildManifest(ok);
  assert.deepEqual(Object.keys(m.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]);
  assert.equal(m.platforms["darwin-aarch64"].url, "https://github.com/o/r/releases/download/v0.4.0/Verba_aarch64.app.tar.gz");
  assert.equal(m.platforms["linux-x86_64"].signature, "sig", "the .deb and .rpm are ignored — only the AppImage updates itself");

  // The whole reason this file exists: unrenamed macOS bundles collide.
  assert.throws(
    () => buildManifest({ ...ok, assets: ["Verba.app.tar.gz", "Verba_0.4.0_amd64.AppImage", "Verba_0.4.0_x64-setup.exe"] }),
    /darwin-aarch64: no bundle/,
    "a macOS bundle without its arch must not be matched by either darwin key",
  );

  // A leg that built but never uploaded publishes nothing.
  assert.throws(() => buildManifest({ ...ok, assets: assets.filter((a) => !a.endsWith("-setup.exe")) }), /windows-x86_64: no bundle/);
  assert.throws(() => buildManifest({ ...ok, signature: (n) => (n.includes("AppImage") ? null : "sig") }), /linux-x86_64: .* has no \.sig/);

  console.log("✓ manifest self-check");
} else if (process.argv[1]?.endsWith("manifest.mjs")) {
  const [, , tag, assetsFile, sigDir] = process.argv;
  if (!tag || !assetsFile || !sigDir) {
    console.error("usage: node scripts/manifest.mjs <tag> <assets.json> <sig-dir>");
    process.exit(1);
  }

  const version = tag.replace(/^v/, "");
  const declared = JSON.parse(readFileSync("package.json", "utf8")).version;
  // The three files already agree with each other (scripts/version.mjs); this
  // is the fourth thing that has to agree — the tag the release was cut from.
  //
  // Exactly, prerelease suffix included: semver sorts 0.4.0-beta.1 *below*
  // 0.4.0, so a beta tag cut while the three files still say 0.4.0 would build
  // an app reporting 0.4.0 and a manifest offering it 0.4.0-beta.1 — an update
  // the updater correctly refuses, and a channel that looks broken for no
  // visible reason. Bump the three files to 0.4.0-beta.1 before tagging.
  if (version !== declared) {
    console.error(`manifest: tag ${tag} does not match the app version ${declared}`);
    process.exit(1);
  }

  const release = JSON.parse(readFileSync(assetsFile, "utf8"));
  const sigs = new Set(readdirSync(sigDir));

  const manifest = buildManifest({
    tag,
    version,
    notes: release.body ?? "",
    pubDate: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    assets: release.assets.map((a) => a.name),
    signature: (name) => (sigs.has(name) ? readFileSync(path.join(sigDir, name), "utf8") : null),
    repoUrl: process.env.REPO_URL,
  });

  console.log(JSON.stringify(manifest, null, 2));
}
