// Mock provider for the rehearsal behavioral check (PLAN-034). Records every
// chat call so the check can assert what system prompt `start` actually chose,
// and returns a well-formed in-role turn.
export const calls = [];
// closing.check.ts parks the provider mid-call with this: while `hold` is a
// promise, every chat records itself and then waits on it.
export const gate = { hold: null };

export function getProvider() {
  return {
    async chat(messages) {
      calls.push({ messages });
      if (gate.hold) await gate.hold;
      return JSON.stringify({
        reply: "Hola, ¿qué tal?",
        corrections: [],
        suggestions: [],
        goalsMet: [],
        repair: null,
        missed: [],
        keyWord: "",
        praise: null,
        ease: false,
      });
    },
  };
}