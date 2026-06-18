// ── SPACED REPETITION ──────────────────────────────────────────────────────
// Simple Leitner-style SRS for vocabulary entries.
// Levels: 0=new, 1=1d, 2=3d, 3=7d, 4=30d (mastered, no more review).
// Each vocab entry gets srsLevel (0-4) and srsNext (epoch ms of next review).
// Leaf module — imports nothing from game-*.js.

const DAY = 86400000;
const INTERVALS = [0, 1*DAY, 3*DAY, 7*DAY, 30*DAY];

export function srsInit(v) {
  if (v.srsLevel === undefined) v.srsLevel = 0;
  if (!v.srsNext) v.srsNext = Date.now();
}

export function srsPromote(v) {
  srsInit(v);
  if (v.srsLevel < 4) v.srsLevel++;
  v.srsNext = Date.now() + (INTERVALS[v.srsLevel] || 0);
}

export function srsDemote(v) {
  srsInit(v);
  v.srsLevel = 0;
  v.srsNext = Date.now() + INTERVALS[1];
}

export function srsIsDue(v) {
  return (v.srsLevel || 0) < 4 && v.srsNext <= Date.now();
}

export function srsGetDue(vocab) {
  return vocab.filter(v => srsIsDue(v));
}

export function srsDueCount(vocab) {
  let n = 0;
  for (const v of vocab) if (srsIsDue(v)) n++;
  return n;
}
