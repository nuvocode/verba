// Mock store for the conditions behavioral check (PLAN-036). `useListening`
// reads recent memories and writes listening sessions / metrics; the check
// needs those to be no-ops so it can drive `generate`, `check`, `next` and
// `walkBackAndReplay` to a real, observable decision.
export async function recentMemories() {
  return [];
}
export async function saveListening() {}
export async function saveListeningProgress() {}
export async function latestListeningProgress() {
  return null;
}
export async function saveMetrics() {}
export async function vocabCounts() {
  return { total: 0 };
}
