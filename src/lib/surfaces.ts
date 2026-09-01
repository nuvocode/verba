// The surface-state registry (PLAN-016). Data, not JSX: `surfaces.check` reads it,
// no view imports it, and it must never import React. Each content-generating
// surface owes all four states (§3.2); a surface that does not generate owes none.
//
// A generating row's state entries are either `{ file, marker }` — a real file that
// carries a marker comment AND renders the matching state component, both verified
// by `surfaces.check` — or `{ pending: "PLAN-022" }`, naming a later plan that
// builds it. `surfaces.check` fails if a `pending` names a plan not in docs/plans/,
// so the registry is a to-do list that cannot rot.
//
// A non-generating surface (memory: it is a collection, not an output) leaves
// `states` empty — it owes no states, so a placeholder pending would be a lie.

export type StateName = "loading" | "empty" | "error" | "unusable";

/** One state of a generating surface: wired to a file+marker, or left for a plan. */
export type SurfaceState = { file: string; marker: string } | { pending: string };

export interface SurfaceRow {
  id: "today" | "talk" | "read" | "listen" | "memory" | "coach";
  /** Does this surface generate content? One that does owes the four states; one
   *  that does not leaves `states` empty. */
  generates: boolean;
  /** Which file renders each state and the marker comment in it. Empty when
   *  `generates` is false. */
  states: Partial<Record<StateName, SurfaceState>>;
}

export const SURFACES: SurfaceRow[] = [
  {
    // Today generates the day's *plan*: it must say when the plan is being built,
    // when the build failed, and when the day is done (§2.1 in PLAN-013). Its four
    // states point at where Today.tsx renders them.
    id: "today",
    generates: true,
    states: {
      loading: { file: "src/views/Today.tsx", marker: "surface today: loading" },
      empty: { file: "src/views/Today.tsx", marker: "surface today: empty" },
      error: { file: "src/views/Today.tsx", marker: "surface today: error" },
      unusable: { file: "src/views/Today.tsx", marker: "surface today: unusable" },
    },
  },
  {
    id: "talk",
    generates: true,
    states: {
      loading: { file: "src/views/Talk.tsx", marker: "surface talk: loading" },
      empty: { file: "src/views/Talk.tsx", marker: "surface talk: empty" },
      error: { file: "src/views/Talk.tsx", marker: "surface talk: error" },
      // PLAN-020 owns the reflection-summary parse; a reflection that comes back
      // unusable is where it surfaces.
      unusable: { file: "src/views/Talk.tsx", marker: "surface talk: unusable" },
    },
  },
  {
    id: "read",
    generates: true,
    states: {
      loading: { file: "src/views/Read.tsx", marker: "surface read: loading" },
      empty: { file: "src/views/Read.tsx", marker: "surface read: empty" },
      error: { file: "src/views/Read.tsx", marker: "surface read: error" },
      // The passage's quality gates land in PLAN-022; they need somewhere to put
      // what they reject, but the gate itself is that plan's job.
      unusable: { pending: "PLAN-022" },
    },
  },
  {
    id: "listen",
    generates: true,
    states: {
      loading: { file: "src/views/Listening.tsx", marker: "surface listen: loading" },
      empty: { file: "src/views/Listening.tsx", marker: "surface listen: empty" },
      error: { file: "src/views/Listening.tsx", marker: "surface listen: error" },
      // Listen's transcript-and-answers contract (PLAN-026) decides what a broken
      // chapter looks like; until then the empty state is the honest one.
      unusable: { pending: "PLAN-026" },
    },
  },
  {
    // Memory is a collection, not an output — nothing on it is generated, so it
    // owes no states. Its empty/loading/error moments are ordinary page states,
    // already handled, not content states.
    id: "memory",
    generates: false,
    states: {},
  },
  {
    id: "coach",
    generates: true,
    states: {
      loading: { file: "src/views/Coach.tsx", marker: "surface coach: loading" },
      empty: { file: "src/views/Coach.tsx", marker: "surface coach: empty" },
      error: { file: "src/views/Coach.tsx", marker: "surface coach: error" },
      unusable: { file: "src/views/Coach.tsx", marker: "surface coach: unusable" },
    },
  },
];
