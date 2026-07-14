/**
 * Verba website — multi-language build script.
 * Reads strings/*.json + template.html, writes one index.html per language.
 *
 * Usage:  node build.js
 *
 * Zero dependencies — only Node.js built-in modules.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const STRINGS_DIR = path.join(ROOT, "strings");
const TEMPLATE_PATH = path.join(ROOT, "template.html");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Recursive resolve of "meta.title" → strings.meta.title */
function resolve(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Replace ALL {{key}} tokens in a template string, calling `lookup(key)` for each. */
function replaceTokens(template, lookup) {
  return template.replace(/\{\{(.+?)\}\}/g, (match, key) => {
    const val = lookup(key.trim());
    return val != null ? val : match;
  });
}

/** Build hreflang <link> tags for all languages. */
function buildHreflang(langs, currentLang, siteUrl) {
  const lines = [];
  for (const l of langs) {
    lines.push(
      `    <link rel="alternate" hreflang="${l}" href="${siteUrl}/${l}/" />`
    );
  }
  // x-default points to English
  if (langs.includes("en")) {
    lines.push(
      `    <link rel="alternate" hreflang="x-default" href="${siteUrl}/en/" />`
    );
  }
  return lines.join("\n");
}

/** Build <a> links for the lang-switcher dropdown. */
function buildLangLinks(langs, allStrings, currentLang) {
  const lines = [];
  for (const l of langs) {
    const name = resolve(allStrings[l], "langNames." + l) || l.toUpperCase();
    const cls = l === currentLang ? ' class="active"' : "";
    lines.push(
      `            <a href="/${l}/"${cls}><span>${name}</span><span class="lang-code">${l}</span></a>`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  // 1. load all language strings
  const fileNames = fs.readdirSync(STRINGS_DIR).filter((f) => f.endsWith(".json"));
  if (fileNames.length === 0) {
    console.error("No .json files found in strings/");
    process.exit(1);
  }

  const allStrings = {}; // { en: {...}, tr: {...}, ... }
  const langs = [];       // ["en", "tr", ...]

  for (const f of fileNames) {
    const raw = fs.readFileSync(path.join(STRINGS_DIR, f), "utf-8");
    const obj = JSON.parse(raw);
    const lang = obj.lang;
    allStrings[lang] = obj;
    langs.push(lang);
  }
  langs.sort();

  // 2. load template
  let template = fs.readFileSync(TEMPLATE_PATH, "utf-8");

  const siteUrl = "https://verba.nuvo.page";

  // 3. generate one page per language
  for (const lang of langs) {
    const strings = allStrings[lang];
    const version = strings.version || "v0.1.0";
    const versionUnderscore = version.replace(/^v/, ""); // "0.1.0"

    // pre-build the hreflang block and lang-links block
    const hreflangHtml = buildHreflang(langs, lang, siteUrl);
    const langLinksHtml = buildLangLinks(langs, allStrings, lang);

    let page = replaceTokens(template, (key) => {
      // special tokens
      if (key === "lang") return lang;
      if (key === "version") return version;
      if (key === "versionUnderscore") return versionUnderscore;
      if (key === "hreflang") return hreflangHtml;
      if (key === "langLinks") return langLinksHtml;

      // resolve nested key from the language's strings
      return resolve(strings, key);
    });

    // 4. write output
    const outDir = path.join(ROOT, lang);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "index.html");
    fs.writeFileSync(outPath, page, "utf-8");
    console.log(`  ✅  ${lang}/index.html`);
  }

  // 5. generate sitemap.xml
  const today = new Date().toISOString().slice(0, 10);
  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
  sitemap += '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

  for (const lang of langs) {
    sitemap += "  <url>\n";
    sitemap += `    <loc>${siteUrl}/${lang}/</loc>\n`;
    sitemap += `    <lastmod>${today}</lastmod>\n`;
    sitemap += "    <changefreq>monthly</changefreq>\n";
    sitemap += "    <priority>1.0</priority>\n";
    for (const alt of langs) {
      if (alt === lang) continue;
      sitemap += `    <xhtml:link rel="alternate" hreflang="${alt}" href="${siteUrl}/${alt}/" />\n`;
    }
    // x-default
    if (langs.includes("en")) {
      sitemap += `    <xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}/en/" />\n`;
    }
    sitemap += "  </url>\n";
  }
  sitemap += "</urlset>\n";

  const sitemapPath = path.join(ROOT, "sitemap.xml");
  fs.writeFileSync(sitemapPath, sitemap, "utf-8");
  console.log(`  ✅  sitemap.xml (${langs.length} languages)`);

  console.log(`\n  🎉  Done — ${langs.length} languages built.`);
}

main();
