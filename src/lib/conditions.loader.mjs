// Runtime module loader for the conditions behavioral check (PLAN-036).
//
// `useListening.ts` is a React hook that imports `./providers`, `./speech` and
// `./db` with extensionless specifiers and pulls in Tauri/network/DB code that
// cannot run in a node check process. This loader (registered by
// `conditions.check.ts` before it imports `useListening`) does two things:
//
//   1. resolves the repo's extensionless relative imports to their `.ts` /
//      `.tsx` / `index.ts` targets, so the real module graph loads under node;
//   2. redirects `useListening`'s `./providers`, `./speech` and `./db` to the
//      in-repo mocks, so the hook runs against a fake provider, a fake speech
//      adapter and a fake store — the only way to drive `generate`, `check`,
//      `next` and `walkBackAndReplay` to a real, observable decision.
//
// The redirects are scoped to `useListening.ts` so the rest of the graph
// (conditions, listening, questions, timeline, …) stays real.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".")) {
    const base = fileURLToPath(context.parentURL);
    const { dirname, join } = await import("node:path");
    const target = join(dirname(base), specifier);
    if (base.endsWith("/useListening.ts")) {
      if (specifier === "./providers") return next(new URL("./conditions.mock-providers.mjs", import.meta.url).href, context);
      if (specifier === "./speech") return next(new URL("./conditions.mock-speech.mjs", import.meta.url).href, context);
      if (specifier === "./db") return next(new URL("./conditions.mock-db.mjs", import.meta.url).href, context);
    }
    if (!specifier.endsWith(".ts") && !specifier.endsWith(".tsx")) {
      if (existsSync(target + ".ts")) return next(specifier + ".ts", context);
      if (existsSync(target + ".tsx")) return next(specifier + ".tsx", context);
      if (existsSync(target) && statSync(target).isDirectory() && existsSync(join(target, "index.ts"))) {
        return next(specifier + "/index.ts", context);
      }
    }
  }
  return next(specifier, context);
}
