// Mock store for the rehearsal behavioral check (PLAN-034). Returns a ready
// baseline (12 measured turns) so `waitMs()` is non-null and the wait machine
// would actually fire an offer if the mode gate were not there — the offer
// test needs the offer to be *possible* in order to prove it is stood down.
const measured = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`,
  activityId: "a1",
  kind: "unpromptedTurn",
  observedAt: Date.now() - i * 1000,
  payload: { label: "turn", words: 6, sentences: 1, chars: 30, latencyMs: 5000, speakMs: 0, speakUnknown: false },
}));

export async function recentSignals() {
  return measured;
}
export async function recentMemories() {
  return [];
}
export async function createSession() {
  return 1;
}
export async function addMessage() {}
export async function stampMemoryAsked() {}
export async function getSession() {
  return null;
}
export async function sessionMessages() {
  return [];
}
export async function setSummary() {}
export async function setTitle() {}
export async function saveMemories() {}
export async function saveMetrics() {}
export async function vocabCounts() {
  return { total: 0 };
}
export async function addVocab() {
  return true;
}
export async function deleteVocabTerm() {}
export async function keepVocab() {}