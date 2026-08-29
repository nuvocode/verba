import type { PlacementQ } from "../../../placement.ts";

/**
 * Spanish placement questions, written by hand.
 *
 * §5 screen 4: for official languages the level a learner starts at is too
 * important to leave to whatever the local model produced this minute. The model
 * writes the test only for languages that have no pool.
 *
 * One question per rung of PLACEMENT_LADDER, in the same order. Three options each,
 * exactly one right, and the right one moves around.
 */
export const placement: PlacementQ[] = [
  { level: "A1", prompt: "— ¿Cómo ___ llamas? — Me llamo Ana.", options: ["se", "te", "me"], answer: 1 },
  { level: "A1", prompt: "Yo ___ estudiante.", options: ["soy", "es", "eres"], answer: 0 },
  { level: "A2", prompt: "Ayer ___ al cine con mi hermana.", options: ["voy", "iré", "fui"], answer: 2 },
  { level: "B1", prompt: "Si tuviera más tiempo, ___ más.", options: ["viajaré", "viajaría", "viajaba"], answer: 1 },
  { level: "B1", prompt: "Me molesta que la gente no ___ puntual.", options: ["es", "será", "sea"], answer: 2 },
  { level: "B2", prompt: "Por más que ___, no conseguirá convencerme.", options: ["insista", "insiste", "insistirá"], answer: 0 },
  { level: "C1", prompt: "El proyecto se vino abajo ___ la falta de fondos.", options: ["a fin de", "a raíz de", "a costa de"], answer: 1 },
  { level: "C2", prompt: "No por mucho madrugar ___ más temprano.", options: ["amaneciera", "amanecerá", "amanece"], answer: 2 },
];
