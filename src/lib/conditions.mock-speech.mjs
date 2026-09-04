// Mock speech adapter for the conditions behavioral check (PLAN-036). A
// seekable, filterable byte tier: `clip` hands back a fake `HTMLAudioElement`
// so `useListening.prepareFor` can build a timeline, and `can` declares the
// capabilities the check needs to drive `supported`.
export const clips = [];

function makeEl() {
  return {
    playbackRate: 1,
    currentTime: 0,
    duration: 1,
    ended: false,
    paused: true,
    addEventListener() {},
    removeEventListener() {},
    play: async () => {},
    pause() {},
  };
}

export function getSpeech() {
  return {
    canSpeak: true,
    canListen: false,
    partials: false,
    seekable: true,
    can: { rate: true, voices: 1, filterable: true },
    clip: async (text) => {
      const el = makeEl();
      clips.push(text);
      return {
        el,
        get duration() {
          return el.duration;
        },
        release() {},
      };
    },
    speak: async () => 1000,
    cancel() {},
    listen: async () => ({ text: "", ms: 0, levels: [] }),
  };
}

export function listenBlocker() {
  return null;
}
