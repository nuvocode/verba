// Mock provider for the conditions behavioral check (PLAN-036). Records every
// chat call so the check can count how many chapters were generated, and returns
// a well-formed outline / chapter so `useListening.generate` can build a real
// piece.
export const calls = [];

export function getProvider() {
  return {
    async chat(messages, opts) {
      calls.push({ messages, opts });
      const text = messages?.[messages.length - 1]?.content ?? "";
      // Pass 1: the outline. Pass 2: a chapter.
      if (text.includes("Plan a short")) {
        return JSON.stringify({
          title: "Un día",
          premise: "Ana and Luis cook",
          beats: [
            { title: "El mercado", beat: "Ana meets Luis" },
            { title: "El plan", beat: "they agree to cook" },
            { title: "La cena", beat: "the dinner goes wrong" },
          ],
        });
      }
      return JSON.stringify({
        sentences: [
          { target: "Luis pagó la cuenta.", native: "Luis paid the bill." },
          { target: "Ana sonrió.", native: "Ana smiled." },
        ],
        questions: [
          {
            type: "multiple_choice",
            prompt: "Who paid?",
            options: [
              { text: "Luis", why: "correct" },
              { text: "Ana", why: "wrongSubject" },
              { text: "Luis pagará", why: "wrongTense" },
              { text: "La cuenta era cara", why: "irrelevantDetail" },
            ],
            answer: "Luis",
            line: "Luis pagó la cuenta.",
          },
          { type: "fill_blank", prompt: "Luis pagó la ___.", answer: "cuenta", line: "Luis pagó la cuenta." },
        ],
      });
    },
  };
}
