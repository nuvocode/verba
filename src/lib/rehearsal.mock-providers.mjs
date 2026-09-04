// Mock provider for the rehearsal behavioral check (PLAN-034). Records every
// chat call so the check can assert what system prompt `start` actually chose,
// and returns a well-formed in-role turn.
export const calls = [];

export function getProvider() {
  return {
    async chat(messages) {
      calls.push({ messages });
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