export function nextRandom(seed: number): [number, number] {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const nextSeed = x | 0;
  return [(nextSeed >>> 0) / 4294967296, nextSeed];
}

export function shuffle<T>(values: readonly T[], seed: number): { values: T[]; seed: number } {
  const result = [...values];
  let currentSeed = seed || 0x6d2b79f5;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const [roll, nextSeed] = nextRandom(currentSeed);
    currentSeed = nextSeed;
    const j = Math.floor(roll * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return { values: result, seed: currentSeed };
}
