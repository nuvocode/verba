# Contributing to Verba

Thanks for helping build an open, local-first language-learning app. The most
valuable contributions are **language packs** and **scenarios** — the content
that makes Verba useful in a new language.

## How a language is laid out

One folder per language. The folder *is* the language — everything Verba knows
about Italian lives in `src/lib/packs/langs/it/`, and adding a language means
adding a folder, not editing five files.

```
src/lib/packs/
  schema.ts            the pack contract (format v1) + validator
  registry.ts          provenance: official / community / unverified
  doc.ts               markdown frontmatter parser
  docs.ts              loads every langs/*/*.md at build time
  bundled.ts           official packs  → one import line per language
  community.ts         community packs → one import line per language
  langs/
    es/
      pack.ts          REQUIRED — the pack literal, exported as `pack`
      README.md        optional — the language's index page
      pronunciation.md optional — long-form docs, as many as you like
      grammar.md
      register.md      optional — with `prompt: true`, the tutor reads it too
```

Only `pack.ts` is required. [`langs/es/`](./src/lib/packs/langs/es/) is the
reference example — copy it.

### pack.ts — what the app runs on

The pack is the machine-readable contract: a handful of short, structured fields
(`pronunciation`, `grammar`, `promptHint`, `speech`, …) validated on every load.
It is deliberately small, because every one of these lines is pasted into the
system prompt on every single model call. Three sharp bullets beat ten vague ones.

### *.md — what a language actually needs room for

Real guidance does not fit in three bullets. Markdown documents in the language's
folder carry the rest: a pronunciation write-up, a grammar chapter, cultural
register notes, false-friend lists. They are shown to the learner in
**Settings → Language**, index (`README.md`) first, then alphabetically by
filename — prefix `01-`, `02-` if your language needs a reading order.

Frontmatter is optional and understands exactly two keys:

```markdown
---
title: Register and courtesy   # defaults to the first `# heading`, then the filename
prompt: true                   # default false
---
```

`prompt: true` means **the tutor reads this document on every turn**, appended to
the pack's `promptHint`. It is how a language teaches the model something a
`promptHint` has no room for — but it costs tokens on every call, so:

- Keep a prompt-marked doc under ~40 lines, and write it as instructions to the
  tutor, not as prose for the learner.
- Everything else stays `prompt: false` (i.e. omit the key). Learner-facing docs
  can be as long as they deserve to be.

A pack you paste into Settings at runtime carries no docs — markdown is a
build-time asset of the repo, so an imported pack never inherits (or overrides)
the in-tree documents of the language whose id it shadows.

## Adding a language

1. **Draft** — `mkdir src/lib/packs/langs/<id>/`, copy `es/pack.ts`, fill it in.
   Or prototype live: **Settings → Import language pack** takes the same JSON.
2. **Document** — add the markdown your language needs. At minimum a `README.md`
   saying what variety the pack targets and who verified it.
3. **Register** — add one import line to `community.ts` (or `bundled.ts`, for
   core-team languages).
4. **Self-check** —
   ```
   node --experimental-strip-types src/lib/phase2.check.ts   # pack + doc validation
   node --experimental-strip-types src/lib/phase3.check.ts   # registry compatibility gate
   node --experimental-strip-types src/lib/onboarding.check.ts
   npx tsc --noEmit
   ```
5. **PR** — one maintainer reviews code/schema, one contributor fluent in the
   language reviews content. Both approve → merge, and it ships as
   **[Community]**.

## Pack provenance & the "Unverified" label

Every pack the app knows about carries an origin (see `src/lib/packs/registry.ts`):

| Origin | Where it lives | Verified? | Shown as |
| --- | --- | --- | --- |
| **Official** | `langs/<id>/`, listed in `bundled.ts`, maintained by the core team | yes | `[Official]` |
| **Community** | `langs/<id>/`, listed in `community.ts`, merged via the flow above | yes | `[Community]` |
| **Unverified** | pasted into Settings → Import at runtime | no | `⚠️ [Unverified]` |

"Verified" means a human reviewed the pack against the criteria below and merged
it — not a cryptographic guarantee. A pack you paste in yourself is always
labelled **Unverified** so you know it hasn't been through review.

## Language quality criteria

A pack must pass the automated gate **and** the human review.

**Automated** (`checkCompatibility` in `src/lib/packs/registry.ts`):

- `formatVersion` matches the app's `PACK_FORMAT_VERSION` (currently `1`).
- All required fields present and correctly typed (run the validator).
- No unknown fields (they warn; clean them up before submitting).

**Human review** — a reviewer checks that:

1. **Accuracy** — pronunciation and grammar notes are correct and idiomatic,
   written by or verified with a fluent/native speaker. This applies to the
   markdown docs as much as to the pack.
2. **Level-appropriate guidance** — `promptHint` and grammar notes help the tutor
   grade its language, and name the register (formal/informal) conventions.
3. **Neutral, safe content** — no slurs, no politically loaded example text. A
   `prompt: true` doc goes into the model's instructions, so it is reviewed as
   code, not as prose.
4. **Correct speech locale** — `speech.locale` is a real BCP-47 tag (e.g. `it-IT`)
   and, if set, `voiceHint` matches a commonly installed voice.
5. **Complete** — `pronunciation` and `grammar` each have at least three
   substantive notes; `nativeName` uses the language's own script/endonym.
6. **Scoped** — the docs say which variety the pack teaches (peninsular vs Latin
   American Spanish, Brazilian vs European Portuguese) rather than blurring them.

Scenarios follow the same idea via `src/lib/scenarios.ts` and its validator.

## License of contributions

By contributing you agree your contribution is licensed under the project's
[MIT license](./LICENSE). See the README's **License & sustainability** section
for why MIT and where a hosted version fits.
