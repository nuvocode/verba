// The markdown side of a language: a pack.ts carries the short, structured
// guidance the tutor prompt needs, while langs/<id>/*.md carries the long-form
// material — pronunciation write-ups, grammar chapters, cultural register notes.
// A doc is human-facing by default; `prompt: true` also folds it into the tutor
// prompt. This module is pure (no bundler magic) so the .check.ts scripts can
// run it under plain node; docs.ts does the actual loading.

export interface LangDoc {
  lang: string; // pack id, from the folder name
  slug: string; // file name without .md
  title: string;
  prompt: boolean; // folded into the tutor's system prompt as well as shown
  body: string; // markdown, frontmatter stripped
}

/**
 * Parse one `langs/<id>/<slug>.md`. Frontmatter is optional and understands two
 * keys — `title:` and `prompt:` — everything else is ignored, not an error.
 * Title falls back to the first `# heading`, then to the slug.
 *
 * ponytail: 20 lines of split() beats a YAML dep for a two-key header. Reach for
 * gray-matter if docs ever need lists, dates or nesting up there.
 */
export function parseDoc(path: string, raw: string): LangDoc {
  const [, lang = "", slug = ""] = path.match(/([^/]+)\/([^/]+)\.md$/) ?? [];

  let body = raw.trim();
  const front: Record<string, string> = {};
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) {
      for (const line of body.slice(3, end).split("\n")) {
        const [k, ...v] = line.split(":");
        if (v.length) front[k.trim()] = v.join(":").trim();
      }
      body = body.slice(end + 4).trim();
    }
  }

  return {
    lang,
    slug,
    title: front.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || slug,
    prompt: front.prompt === "true",
    body,
  };
}
