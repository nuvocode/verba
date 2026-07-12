# Contributing to Speaksy

Thanks for helping build an open, local-first language-learning app. The most
valuable contributions are **language packs** and **scenarios** — the content
that makes Speaksy useful in a new language.

## Pack provenance & the "Unverified" label

Every pack the app knows about carries an origin (see `src/lib/packs/registry.ts`):

| Origin | Where it lives | Verified? | Shown as |
| --- | --- | --- | --- |
| **Official** | `src/lib/packs/bundled.ts`, maintained by the core team | yes | `[Official]` |
| **Community** | `src/lib/packs/community.ts`, merged via the flow below | yes | `[Community]` |
| **Unverified** | pasted into Settings → Import at runtime | no | `⚠️ [Unverified]` |

"Verified" means a human reviewed the pack against the criteria below and merged
it — not a cryptographic guarantee. A pack you paste in yourself is always
labelled **Unverified** so you know it hasn't been through review.

## Language pack quality criteria

A pack must pass the automated gate **and** the human review.

**Automated** (`checkCompatibility` in `src/lib/packs/registry.ts`):

- `formatVersion` matches the app's `PACK_FORMAT_VERSION` (currently `1`).
- All required fields present and correctly typed (run the validator).
- No unknown fields (they warn; clean them up before submitting).

**Human review** — a reviewer checks that:

1. **Accuracy** — pronunciation and grammar notes are correct and idiomatic,
   written by or verified with a fluent/native speaker.
2. **Level-appropriate guidance** — `promptHint` and grammar notes help the tutor
   grade its language, and name the register (formal/informal) conventions.
3. **Neutral, safe content** — no slurs, no politically loaded example text.
4. **Correct speech locale** — `speech.locale` is a real BCP-47 tag (e.g. `it-IT`)
   and, if set, `voiceHint` matches a commonly installed voice.
5. **Complete** — `pronunciation` and `grammar` each have at least three
   substantive notes; `nativeName` uses the language's own script/endonym.

## Official vs community review flow

```
Author a pack  ─►  self-check  ─►  open a PR  ─►  review  ─►  merge
(literal or           (validator +      adds it to      1 maintainer +   ships as
 pasted JSON)         compatibility)    community.ts     1 native/fluent   [Community]
                                                          speaker OK
```

1. **Draft** — write the pack as a JSON literal (copy an entry from
   `bundled.ts`), or prototype it live via **Settings → Import language pack**.
2. **Self-check** — `node --experimental-strip-types src/lib/phase2.check.ts`
   validates bundled packs; add yours to `community.ts` and re-run
   `phase3.check.ts` to confirm the registry accepts it.
3. **PR** — add the literal to `src/lib/packs/community.ts` with a short note on
   who verified the language.
4. **Review** — one maintainer for code/schema, plus one contributor fluent in
   the language for content. Both approve → merge. It then ships as
   **[Community]** (verified).

**Official** packs follow the same bar but are adopted into `bundled.ts` by the
core team when a language warrants first-class, ongoing maintenance.

Scenarios follow the same idea via `src/lib/scenarios.ts` and its validator.

## License of contributions

By contributing you agree your contribution is licensed under the project's
[MIT license](./LICENSE). See the README's **License & sustainability** section
for why MIT and where a hosted version fits.
