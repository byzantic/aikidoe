// Seeded random numbers for design randomisation (spec §3: every random step takes an explicit
// seed, recorded in the study, so the same seed gives the same run sheet).
//
// Generator: xoshiro128** (Blackman & Vigna), state initialised from the 32-bit seed with
// splitmix32. Changing this algorithm changes every run sheet produced from a stored seed, so
// it is fixed; tests pin its first outputs.

function splitmix32(a) {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function rng(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`seed must be an integer 0 … 4294967295, got ${seed}`);
  const sm = splitmix32(seed);
  return fromState(sm(), sm(), sm(), sm());
}

/** xoshiro128** from an explicit 128-bit state (for testing the core against known outputs). */
export function fromState(s0, s1, s2, s3) {
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  const nextU32 = () => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t; s3 = rotl(s3, 11);
    return result;
  };
  return {
    u32: nextU32,
    /** uniform on [0, 1) with 53 random bits */
    random: () => ((nextU32() >>> 5) * 67108864 + (nextU32() >>> 6)) / 9007199254740992,
    /** uniform integer 0 … n−1, without modulo bias */
    int: (n) => {
      if (!(n >= 1 && n <= 0x100000000)) throw new Error(`int(${n})`);
      const lim = Math.floor(0x100000000 / n) * n;
      let x; do x = nextU32(); while (x >= lim);
      return x % n;
    },
    /** Fisher–Yates shuffle, returns a new array */
    shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = this.int(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; },
  };
}
