// Mock speech adapter for the rehearsal behavioral check (PLAN-034). Records
// every spoken line so the check can count what the coach actually said — the
// offer test asserts that in role nothing is spoken over the wait.
export const spoken = [];
// closing.check.ts queues what the mic "hears"; empty queue, empty clip.
export const heard = [];

export function getSpeech() {
  return {
    canSpeak: true,
    canListen: false,
    partials: false,
    speak: async (text) => {
      spoken.push(text);
      return 1000;
    },
    cancel: async () => {},
    listen: async () => heard.shift() ?? { text: "", ms: 0, levels: [] },
  };
}

export function listenBlocker() {
  return null;
}