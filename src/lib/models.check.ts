// Runnable check: `node --experimental-strip-types src/lib/models.check.ts`
//
// The model picker's rules (§5.7): which row is recommended, which row is too
// big for this machine, and what a row says about itself. All of it is one pure
// function so the claims a learner reads are claims a check can hold.
import assert from "node:assert";
import { CLOUD_MODELS, gb, isRemoteModel, localChoices, modelTrouble, PROVIDERS, type Installed } from "./models.ts";
import { defaultSettings, isLocalProvider } from "./settings.ts";

const GB = 1024 ** 3;
const m = (id: string, sizeGb: number): Installed => ({ id, bytes: Math.round(sizeGb * GB) });

// A 16 GB machine, and four models: two comfortable, one borderline, one hopeless.
const RAM = 16 * GB;
const served = [m("tiny", 1.2), m("mid", 4.7), m("big", 9.8), m("huge", 40)];
const rows = localChoices(served, RAM);
const at = (id: string) => rows.find((r) => r.id === id)!;

// Every model stays on screen. A row hidden for being too big reads as a model
// that is not installed — which is a different and wrong thing to tell someone.
assert.deepEqual(rows.map((r) => r.id), ["tiny", "mid", "big", "huge"], "the list is what the server serves");

// Exactly one recommendation, and it is the largest that still fits: 9.8 GB is
// under 70% of 16 GB, 40 is not.
assert.equal(rows.filter((r) => r.recommended).length, 1, "recommended is on exactly one row at a time");
assert(at("big").recommended, "the biggest model that fits is the best this machine can run");

// The warning goes on the one that doesn't fit, and names the machine's memory
// so the number is not floating free (§6: no number without its meaning).
assert(!at("big").warning, "a model that fits is not warned about");
assert(at("huge").warning, "a model past the ceiling says so");
assert.match(at("huge").warning!, /16 GB/, "…and names what this machine actually has");

// The hint is speed and quality, not a bare byte count.
assert.match(at("tiny").hint, /Quick/, "a small model is described as quick");
assert.match(at("huge").hint, /Slower/, "a large one as slower");
for (const r of rows) assert.match(r.hint, /GB/, "every hint carries the size it is talking about");

// A server that reports no sizes (LM Studio's list has none) gets no opinions
// rather than invented ones — and no badge, because a badge on a guess is worse
// than no badge at all.
const sizeless = localChoices([m("a", 0), m("b", 0)], RAM);
assert.equal(sizeless.filter((r) => r.recommended).length, 0, "nothing is recommended when nothing has a size");
assert(sizeless.every((r) => !r.warning && !r.hint), "…and nothing is claimed about it either");

// Same when the machine's memory is the unknown half: the rows still list.
const noRam = localChoices(served, 0);
assert.equal(noRam.length, 4, "an unknown machine still shows every model");
assert(noRam.every((r) => !r.warning && !r.recommended), "…and makes no claim it cannot support");

// Ollama lists its own hosted models beside the pulled ones, with a manifest-sized
// `size`. A row saying "0.0 GB" would read as the cheapest thing on the list.
const withCloud = localChoices([m("qwen:cloud", 0.0000005), m("mid", 4.7)], RAM);
assert(!/GB/.test(withCloud[0].hint), "a manifest-sized entry claims no size");
assert(!withCloud[0].warning, "…and is not warned about either");
assert(!withCloud[0].recommended, "…and is never the recommendation");
assert(withCloud[1].recommended, "the real model is");

// The same for a genuinely sizeless local row: a `0.0 GB` must never appear.
assert(!localChoices([m("odd", 0.001)], RAM)[0].hint.includes("GB"));

// ---- Ollama's hosted models are a cloud provider in a local coat ----

for (const id of ["qwen3.5:cloud", "gemma4:31b-cloud", "QWEN:CLOUD"])
  assert(isRemoteModel(id), `${id} is served from somewhere else`);
// Anchored, so a model that merely has the word in it is left alone.
for (const id of ["nimbus-cloud-7b", "cloudy:7b", "llama3.1:8b", "nomic-embed-text:latest"])
  assert(!isRemoteModel(id), `${id} is a local model and must stay in the list`);

const mixed = [m("qwen3.5:cloud", 0.0000005), m("mid", 4.7), m("gemma4:31b-cloud", 0.0000005)];

// Lock off: everything is listed, and the remote ones say what they are — the
// heading claims these are installed, and two of them are not.
const unlocked = localChoices(mixed, RAM);
assert.equal(unlocked.length, 3, "nothing is hidden while the lock is off");
assert.match(unlocked[0].hint, /Ollama's servers/, "a hosted model says where it runs");
assert.match(unlocked[1].hint, /4\.7 GB/, "a real one still describes itself by size");

// Lock on: they are gone. Offering a row that cannot be picked would be the
// contradiction §5.5 refuses to put on screen.
const locked = localChoices(mixed, RAM, true);
assert.deepEqual(locked.map((r) => r.id), ["mid"], "the lock takes the hosted models off the list");
assert(locked[0].recommended, "…and the recommendation moves to what is left");

// The badge never lands on a hosted model, lock or no lock: it has no size, and
// "best this machine can run" is a claim about this machine.
assert.equal(unlocked.filter((r) => r.recommended).length, 1);
assert(unlocked.find((r) => r.id === "mid")!.recommended, "the local model is the only candidate");

// An empty server is an empty list, not a crash.
assert.deepEqual(localChoices([], RAM), []);

// gb() rounds where a person would: one decimal while it matters, none after.
assert.equal(gb(4.7 * GB), "4.7 GB");
assert.equal(gb(40 * GB), "40 GB");

// Every cloud list carries exactly one recommendation, for the same reason the
// local one does — two recommendations is no recommendation.
for (const [id, list] of Object.entries(CLOUD_MODELS)) {
  assert(list && list.length > 0, `${id} must offer something to pick`);
  assert.equal(list.filter((c) => c.recommended).length, 1, `${id} must recommend exactly one model`);
  for (const c of list) assert(c.hint.trim().length > 0, `${id}/${c.id} must say what it is like to use`);
}

// ---- state 2: Today owes a warning when there is nothing to talk to ----
//
// §7 row 2, "Model yanıt vermiyor". Everything asserted here is free to find out
// at start-up — a port on this machine, or the length of a saved key. None of it
// spends a token, which is the whole reason Today is allowed to ask.
const ollama = { ...defaultSettings, provider: "ollama" as const, ollamaModel: "gemma4:e2b-mlx" };

// Never answered is a different sentence from running-with-nothing-pulled, and a
// learner acts on them differently: start the server, or pull a model.
const dead = modelTrouble(ollama, null)!;
assert.match(dead, /not answering/, "state 2: a server that is down says so");
assert.match(dead, new RegExp(ollama.ollamaHost.replace(/[/:.]/g, "\\$&")), "state 2: …and names the address it tried");
assert.match(modelTrouble(ollama, [])!, /no models pulled/, "state 2: an empty server is its own problem");

// Running, serving models, but not the one this app is set to use — the failure
// that looks like nothing is wrong until the first turn.
const wrong = modelTrouble(ollama, [m("llama3.1:8b", 4.7)])!;
assert.match(wrong, /gemma4:e2b-mlx/, "state 2: the missing model is named");
assert.equal(modelTrouble(ollama, [m("gemma4:e2b-mlx", 6.1)]), null, "state 2: a working setup says nothing");

// A cloud provider is judged on what can be known for free. A missing key is a
// certainty; a wrong key is not, and claiming it would mean spending money to
// find out — Advanced's Test connection is where that is asked on purpose.
const cloud = { ...defaultSettings, provider: "anthropic" as const, anthropicKey: "" };
assert.match(modelTrouble(cloud, null)!, /API key/, "state 2: a cloud provider with no key cannot answer either");
assert.equal(modelTrouble({ ...cloud, anthropicKey: "sk-ant-x" }, null), null, "state 2: a key that exists is not second-guessed");

// Every provider is reachable by this door — a provider missing from the table
// would silently never warn about anything.
for (const p of PROVIDERS) {
  assert(p.name.trim(), `${p.id} must have a name`);
  assert(isLocalProvider(p.id) ? !!p.host : !!p.key, `${p.id} must name the field that makes it usable`);
}

console.log(`models.check ✓ ${rows.length} local rows, ${Object.keys(CLOUD_MODELS).length} cloud lists`);
