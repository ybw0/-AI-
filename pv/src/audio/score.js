// ============================================================================================================
//  微分几何 · Differential Geometry  —  ORIGINAL SCORE  (100 % procedural, Web Audio OfflineAudioContext)
//  120 BPM (beat 0.5 s, bar 2 s) · D minor centre, lifts to F, luminous D major / Dsus2 resolution.
//  Deterministic: only a seeded PRNG (mulberry32) is used, no Math.random / Date.now.
//
//  MUSICAL MAP  (absolute seconds; bar = 2 s; chords are given per scene in local beats in CH_TABLE)
//  ------------------------------------------------------------------------------------------------------
//  s00 CURVES     0-10   E 2>5   Dm | Bb (4s) | F (6s, HERO) | A (8s)      0.6 s: single pure D6 sine = the point of light igniting.
//                        pad+sub swell in, heartbeat soft kick every 1 s, sparse glass drops, riser 2>5.88, hero = light-pulse
//                        run through the knot (32nd-note bell run) + medium impact. 8.7-10: zoom whoosh into s01.
//  s01 SURFACES  10-20   E 4>6   Dm Bb Gm | F (15 HERO) | C | A            arps (16ths) enter on the downbeat, kicks from 12,
//                        riser 12>14.88, hero = "lines of curvature" twin bell cascades, full groove 15-20, riser into flash.
//  s02 CURVATURE 20-32   E 6>8   Dm Bb C | Dm (26 HERO) Bb | F (30 CLIMAX) C  20 = flash impact, bright shimmer that settles dark;
//                        drums drop in at the hero, snare-roll into the climax (choir + doubled bells), fill into the iris.
//  s03 GEODESICS 32-42   E 5>7   F Bb C | F (37 HERO) | Dm C              elegant: string pad + harp-like plucks, drums thin,
//                        hero = 30-note rising pentatonic pluck cascade (the fan of geodesic beams), glitch lead-in at 41.5.
//  s04 GAUSS-B.  42-52   E 6>8   Dm Bb Gm | Bb (47 HERO) | F C A           glitch stutter cut, tresillo (3-3-2) saw stabs, 16th bass,
//                        hero = huge Bb chord with choir; syncopated groove after.
//  s05 SPACETIME 52-62   E 8>9   Dm Bb C | Dm (58 HERO) | Bb A             deep cosmic: D1 sub, choir, taiko half-time, granular stars,
//                        biggest riser + biggest impact of the film so far at 58.
//  s06 RICCI     62-70   E 3     Dd (dark D5+b2 drone) | Bbmaj7 (66 HERO) | A  near silence, low drone, two far bells; the hero is a warm
//                        exhale/release (not a bang). 68-70 quiet dominant build into the flash.
//  s07 FINALE    70-84   E 10    A (montage) | Dm (73 HERO) Bb F C A | D (80) | Dsus2 (82)
//                        70 whiteout impact, 70.4-72.88 spiral-inward montage (converging glides to D6 = the ignition tone of s00),
//                        73 = full-band anthem (theme in D minor, lead + bells + choir), 79 dominant, 80 luminous D major, sparse bell
//                        melody, long natural reverb tail, log-fade to silence 82.4-83.4 (film fade-out).
//  Signal flow (DETERMINISM: no ConvolverNode and no feedback cycle is used inside the Web Audio graph - Chromium's convolver runs its tail on a
//  worker thread and its cycle-resolution order depends on pointer hashing, so both made two renders differ by up to -30 dB):
//   graph (8-ch offline context):  voices (lazy-instantiated 1 s ahead via ctx.suspend windows) -> buses (bass/pad[HP+notch]/arp/drum/fx)
//      -> kick-sidechain ducks -> breakdown dip -> Haas widener -> DRY stem (ch 0-1); reverb SEND stems long (ch 2-3) / short (ch 4-5);
//      arp ping-pong SEND (ch 6); the master gain curve (loudness trim x hero-gap duck x fade) is rendered on a DC probe (ch 7).
//   JS (all Float32/Float64 arithmetic, fixed order):  ping-pong delay -> long/short reverb by partitioned-FFT convolution with the generated
//      IRs (same level as the old ConvolverNode: Chromium's IR normalisation is reproduced) -> dry+wet -> master gain curve -> soft compressor
//      -> DC block -> RMS trim -> true-peak (4x oversampled) look-ahead limiter at -1.5 dBTP.
//  Every hero gets: riser ending 0.12 s early, master duck (silence gap), 1.1 s "breakdown" dip of the music buses, then impact.
// ============================================================================================================

// ------------------------------------------------------------------ utilities
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dbToLin = (d) => Math.pow(10, d / 20);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const curve = (pts) => (t) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0); }
  }
  return pts[pts.length - 1][1];
};

// ------------------------------------------------------------------ harmony
// r = sub-bass MIDI note (kept in 29..38 so the bass line stays smooth), pad = warm voicing, arp = bell pool (ascending), hi = octave up
const CH = {
  Dm:     { r: 38, pad: [50, 57, 62, 65, 69], arp: [62, 65, 69, 74, 77, 81], hi: [74, 77, 81, 86] },
  Bb:     { r: 34, pad: [46, 53, 58, 62, 65], arp: [58, 62, 65, 70, 74, 77], hi: [70, 74, 77, 82] },
  F:      { r: 29, pad: [53, 57, 60, 65, 69], arp: [60, 65, 69, 72, 77, 81], hi: [72, 77, 81, 84] },
  C:      { r: 36, pad: [48, 55, 60, 64, 67], arp: [60, 64, 67, 72, 76, 79], hi: [72, 76, 79, 84] },
  Gm:     { r: 31, pad: [43, 50, 55, 58, 62], arp: [58, 62, 67, 70, 74, 79], hi: [70, 74, 79, 82] },
  A:      { r: 33, pad: [45, 52, 57, 61, 64], arp: [57, 61, 64, 69, 73, 76], hi: [69, 73, 76, 81] },
  D:      { r: 38, pad: [50, 57, 62, 66, 69], arp: [62, 66, 69, 74, 78, 81], hi: [74, 78, 81, 86] },
  Dsus2:  { r: 38, pad: [50, 57, 62, 64, 69], arp: [62, 64, 69, 74, 76, 81], hi: [74, 76, 81, 86] },
  Bbmaj7: { r: 34, pad: [46, 53, 58, 62, 69], arp: [58, 62, 65, 69, 74, 77], hi: [70, 74, 77, 81] },
  Dd:     { r: 38, pad: [38, 45, 50, 51], arp: [62, 69, 74, 75, 81, 86], hi: [74, 81, 86, 87] },
};
// per scene: [local beat, chord]
const CH_TABLE = [
  [[0, 'Dm'], [8, 'Bb'], [12, 'F'], [16, 'A']],
  [[0, 'Dm'], [4, 'Bb'], [8, 'Gm'], [10, 'F'], [14, 'C'], [18, 'A']],
  [[0, 'Dm'], [4, 'Bb'], [8, 'C'], [12, 'Dm'], [16, 'Bb'], [20, 'F'], [22, 'C']],
  [[0, 'F'], [4, 'Bb'], [8, 'C'], [10, 'F'], [14, 'Dm'], [18, 'C']],
  [[0, 'Dm'], [4, 'Bb'], [8, 'Gm'], [10, 'Bb'], [14, 'F'], [16, 'C'], [18, 'A']],
  [[0, 'Dm'], [4, 'Bb'], [8, 'C'], [12, 'Dm'], [16, 'Bb'], [18, 'A']],
  [[0, 'Dd'], [8, 'Bbmaj7'], [12, 'A']],
  [[0, 'A'], [6, 'Dm'], [8, 'Bb'], [12, 'F'], [16, 'C'], [18, 'A'], [20, 'D'], [24, 'Dsus2']],
];
const PENT_F = [0, 2, 4, 7, 9];      // F major pentatonic (from F) - the geodesic pluck cascade

// loudness-arc trim (dB) on the whole mix: [absolute time s, dB]; linear-in-dB between points.
// Flat (or rising) around every hero so the hit always lifts; s00 opens quiet, s06 is the quietest chapter, s05/s07 the loudest.
const TRIM_PTS = [
  [0, 0], [6.6, 0], [7.6, -3.5], [10, -3], [10.4, -3], [13.5, -2.5], [15, -1.5], [16, -2.5], [19.9, -2.5],
  [20, -1], [25, -1], [26, 0], [29, 0], [30, 0.5], [31.5, 0], [32, -3.5], [36, -3.2], [37, -2.5], [38, -3], [41.9, -2.5],
  [42, -3], [46, -2.5], [47, -2], [52, -2], [52.5, -0.8], [58, -0.6], [61.9, -1.6], [62, -6.5], [65.9, -6.5], [66.2, -5], [69.9, -5], [70.1, 0], [70.6, -2.5], [72.9, -2.5], [73, 2.4], [79.9, 2.4], [80.6, -2.5], [82, -4], [84, -4],
];

// ------------------------------------------------------------------ deterministic JS DSP (post-render)
/** RBJ biquad, Web-Audio flavour (Q of lowpass/highpass is in dB). Returns [b0,b1,b2,a1,a2] normalised. */
function biquadCoef(type, f, qDb, SR) {
  const w = (2 * Math.PI * f) / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * Math.pow(10, qDb / 20));
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; } else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  const a0 = 1 + al; return [b0 / a0, b1 / a0, b2 / a0, (-2 * cw) / a0, (1 - al) / a0];
}
function biquadRun(x, c) {
  const [b0, b1, b2, a1, a2] = c; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
}
/** in-place iterative radix-2 complex FFT factory (Float64) */
function makeFFT(N) {
  const lg = Math.round(Math.log2(N)), rev = new Uint32Array(N), cs = new Float64Array(N / 2), sn = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < lg; b++) if (i & (1 << b)) r |= 1 << (lg - 1 - b); rev[i] = r; }
  for (let i = 0; i < N / 2; i++) { cs[i] = Math.cos((2 * Math.PI * i) / N); sn[i] = Math.sin((2 * Math.PI * i) / N); }
  return (re, im, inv) => {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    const sg = inv ? 1 : -1;
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cs[k], wi = sg * sn[k], a = i + j, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}
/** uniform-partitioned overlap-save convolution of a stereo signal with a stereo IR (L*irL, R*irR), both channels through ONE complex FFT
 *  (z = L + iR). Fixed evaluation order -> bit-reproducible. Output is not delayed; length = input length. */
function convolveStereo(inL, inR, irL, irR, B, gain) {
  const n = inL.length, N = 2 * B, H = N / 2 + 1, P = Math.ceil(irL.length / B), fft = makeFFT(N);
  const hr = [[], []], hi = [[], []], re = new Float64Array(N), im = new Float64Array(N);
  [irL, irR].forEach((ir, c) => {
    for (let p = 0; p < P; p++) {
      re.fill(0); im.fill(0); const o = p * B; for (let i = 0; i < B && o + i < ir.length; i++) re[i] = ir[o + i];
      fft(re, im, false); hr[c].push(Float64Array.from(re.subarray(0, H))); hi[c].push(Float64Array.from(im.subarray(0, H)));
    }
  });
  const xr = [[], []], xi = [[], []]; for (let p = 0; p < P; p++) for (let c = 0; c < 2; c++) { xr[c].push(new Float64Array(H)); xi[c].push(new Float64Array(H)); }
  const outL = new Float32Array(n), outR = new Float32Array(n), ar = [new Float64Array(H), new Float64Array(H)], ai = [new Float64Array(H), new Float64Array(H)];
  const nb = Math.ceil(n / B), inv = gain / N;
  for (let b = 0; b < nb; b++) {
    const s0 = b * B, sp = b % P;
    for (let i = 0; i < B; i++) {   // [previous block | current block]
      const ip = s0 - B + i, ic = s0 + i;
      re[i] = ip >= 0 ? inL[ip] : 0; im[i] = ip >= 0 ? inR[ip] : 0;
      re[B + i] = ic < n ? inL[ic] : 0; im[B + i] = ic < n ? inR[ic] : 0;
    }
    fft(re, im, false);
    for (let k = 0; k < H; k++) {   // split the packed spectrum into the L and R spectra
      const k2 = (N - k) & (N - 1), zr = re[k], zi = im[k], cr = re[k2], ci = -im[k2];
      xr[0][sp][k] = 0.5 * (zr + cr); xi[0][sp][k] = 0.5 * (zi + ci);
      xr[1][sp][k] = 0.5 * (zi - ci); xi[1][sp][k] = -0.5 * (zr - cr);
    }
    for (let c = 0; c < 2; c++) { ar[c].fill(0); ai[c].fill(0); }
    for (let p = 0; p < P && p <= b; p++) {
      const q = ((b - p) % P + P) % P;
      for (let c = 0; c < 2; c++) {
        const Xr = xr[c][q], Xi = xi[c][q], Hr = hr[c][p], Hi = hi[c][p], Ar = ar[c], Ai = ai[c];
        for (let k = 0; k < H; k++) { Ar[k] += Xr[k] * Hr[k] - Xi[k] * Hi[k]; Ai[k] += Xr[k] * Hi[k] + Xi[k] * Hr[k]; }
      }
    }
    for (let k = 0; k < H; k++) {   // recombine: Y = YL + i*YR (both Hermitian)
      const lr = ar[0][k], li = ai[0][k], rr = ar[1][k], ri = ai[1][k];
      re[k] = lr - ri; im[k] = li + rr;
      if (k > 0 && k < N / 2) { const k2 = N - k; re[k2] = lr + ri; im[k2] = -li + rr; }
    }
    fft(re, im, true);
    const m = Math.min(B, n - s0); for (let i = 0; i < m; i++) { outL[s0 + i] = re[B + i] * inv; outR[s0 + i] = im[B + i] * inv; }
  }
  return [outL, outR];
}
/** deterministic feedback ping-pong (dotted-eighth) delay: mono in -> stereo out (same topology/levels as the former graph version) */
function pingPong(inp, SR, D, fbAmt, lpHz, outGain) {
  const n = inp.length, d = Math.round(D * SR), bufL = new Float32Array(d), bufR = new Float32Array(d), c = biquadCoef('lp', lpHz, 1, SR);
  const outL = new Float32Array(n), outR = new Float32Array(n), gA = Math.cos(0.1 * Math.PI / 2), gB = Math.sin(0.1 * Math.PI / 2);
  let a1x1 = 0, a1x2 = 0, a1y1 = 0, a1y2 = 0, a2x1 = 0, a2x2 = 0, a2y1 = 0, a2y2 = 0, wp = 0;
  for (let i = 0; i < n; i++) {
    const yL = bufL[wp], yR = bufR[wp];   // delay outputs (written d samples ago)
    // LP1(yL) -> fb1 -> right line ; LP2(yR) -> fb2 -> left line
    const l1 = c[0] * yL + c[1] * a1x1 + c[2] * a1x2 - c[3] * a1y1 - c[4] * a1y2; a1x2 = a1x1; a1x1 = yL; a1y2 = a1y1; a1y1 = l1;
    const l2 = c[0] * yR + c[1] * a2x1 + c[2] * a2x2 - c[3] * a2y1 - c[4] * a2y2; a2x2 = a2x1; a2x1 = yR; a2y2 = a2y1; a2y1 = l2;
    bufL[wp] = inp[i] + fbAmt * l2; bufR[wp] = fbAmt * l1; wp = wp + 1 === d ? 0 : wp + 1;
    outL[i] = outGain * (gA * yL + gB * yR); outR[i] = outGain * (gB * yL + gA * yR);
  }
  return [outL, outR];
}
/** feed-forward compressor with look-ahead (no latency), detector = max(|L|,|R|). Static curve = Chromium's DynamicsCompressor
 *  (exponential soft knee that spans `knee` dB above the threshold, then constant ratio), so the dynamics match the former graph node. */
function compressor(L, R, SR, { thr = -15, knee = 16, ratio = 2.4, atk = 0.012, rel = 0.2, la = 0.006 } = {}) {
  const lin = (d) => Math.pow(10, d / 20), dbv = (x) => 20 * Math.log10(x), lt = lin(thr), kt = lin(thr + knee), slope = 1 / ratio;
  const kneeCurve = (x, k) => (x < lt ? x : lt + (1 - Math.exp(-k * (x - lt))) / k);
  const slopeAt = (x, k) => (x < lt ? 1 : (dbv(kneeCurve(x * 1.001, k)) - dbv(kneeCurve(x, k))) / (dbv(x * 1.001) - dbv(x)));
  let lo = 0.1, hi = 10000, k = 5;
  for (let i = 0; i < 15; i++) { if (slopeAt(kt, k) < slope) hi = k; else lo = k; k = Math.sqrt(lo * hi); }
  const yk = dbv(kneeCurve(kt, k));
  const sat = (x) => (x < kt ? kneeCurve(x, k) : lin(yk + slope * (dbv(x) - (thr + knee))));
  const n = L.length, gr = new Float32Array(n), aA = 1 - Math.exp(-1 / (atk * SR)), aR = 1 - Math.exp(-1 / (rel * SR)), lk = Math.round(la * SR);
  let env = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.max(Math.abs(L[i]), Math.abs(R[i])), t = x <= lt ? 0 : dbv(x / sat(x));   // gain reduction in dB (>= 0)
    env += (t - env) * (t > env ? aA : aR); gr[i] = env;
  }
  for (let i = 0; i < n; i++) { const g = Math.pow(10, -gr[Math.min(n - 1, i + lk)] / 20); L[i] *= g; R[i] *= g; }
}
/** 4x-oversampled (true) peak per sample: max(|x|, |interpolated inter-sample values|), 32-tap Hann-windowed sinc; skipped when far below `floor` */
function truePeak(L, R, scale, floor) {
  const TAPS = 32, HALF = TAPS / 2, n = L.length, out = new Float32Array(n);
  const T = [1, 2, 3].map((ph) => { const h = new Float64Array(TAPS); for (let m = -(HALF - 1); m <= HALF; m++) { const d = ph / 4 - m; h[m + HALF - 1] = (Math.sin(Math.PI * d) / (Math.PI * d)) * 0.5 * (1 + Math.cos((Math.PI * d) / HALF)); } return h; });
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]) * scale, b = Math.abs(R[i]) * scale; let pk = a > b ? a : b;
    const nb = Math.max(i > 0 ? Math.max(Math.abs(L[i - 1]), Math.abs(R[i - 1])) : 0, i + 1 < n ? Math.max(Math.abs(L[i + 1]), Math.abs(R[i + 1])) : 0) * scale;
    if (Math.max(pk, nb) > floor && i >= HALF && i + HALF < n) {
      for (let p = 0; p < 3; p++) { const h = T[p]; let sl = 0, sr = 0; for (let m = 0; m < TAPS; m++) { sl += L[i - (HALF - 1) + m] * h[m]; sr += R[i - (HALF - 1) + m] * h[m]; } sl = Math.abs(sl) * scale; sr = Math.abs(sr) * scale; if (sl > pk) pk = sl; if (sr > pk) pk = sr; }
    }
    out[i] = pk;
  }
  return out;
}

const MASTER_RMS_DB = -15.8, CEILING_DB = -1.5, CLIP_KNEE = 0.68, CLIP_W = 0.34;   // whole-file mono RMS target before limiting / true-peak ceiling (AAC-safe)

export async function renderScore(TL, { sampleRate = 48000, onProgress } = {}) {
  const SR = sampleRate, TOTAL = TL.TOTAL, BEAT = 60 / TL.BPM;
  const prog = (x, s) => { try { onProgress && onProgress(x, s); } catch (e) { /* ignore */ } };
  const NCH = 8;   // stems: 0-1 dry, 2-3 long-reverb send, 4-5 short-reverb send, 6 ping-pong send, 7 master-gain probe
  const ctx = new OfflineAudioContext(NCH, Math.round(TOTAL * SR), SR);
  const rnd = mulberry32(0x5EED0D1F);      // musical jitter / dust / stutter stream
  const rdN = mulberry32(0xC0FFEE11);      // noise-source offsets

  // ------------------------------------------------------------ noise buffers & impulse responses
  function makeNoise(seconds, seed, pink) {
    const r = mulberry32(seed), n = Math.round(seconds * SR), b = ctx.createBuffer(2, n, SR);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        if (!pink) d[i] = w;
        else { // Paul Kellet economy pink
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      }
    }
    return b;
  }
  const WHITE = makeNoise(6, 101, false), PINK = makeNoise(6, 202, true);

  function makeIR(seconds, rt60, seed, { pre = 0.012, dark = 1.0 } = {}) {
    const n = Math.round(seconds * SR), r = mulberry32(seed), ch = [new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < 2; c++) {
      const d = ch[c]; let lp = 0, lp2 = 0;
      const p0 = Math.round(pre * SR * (c ? 1.35 : 1));
      for (let i = 0; i < n; i++) {
        let x = 0;
        if (i >= p0) {
          const tt = (i - p0) / SR;
          const env = Math.exp((-6.9078 * tt) / rt60);
          const w = r() * 2 - 1;
          // tail gets darker with time (air absorption)
          const a = clamp(0.92 - 0.72 * dark * (1 - Math.exp(-tt / 1.1)), 0.12, 0.95);
          lp += (w - lp) * a;
          // remove low-end mud (subtract slow LP)
          lp2 += (lp - lp2) * 0.012;
          const fadeIn = Math.min(1, tt / 0.006);
          x = (lp - lp2) * env * fadeIn;
        }
        d[i] = x * Math.min(1, (n - i) / (0.05 * SR));
      }
    }
    // level normalisation identical to Chromium's ConvolverNode (normalize = true): RMS-based, -58 dB calibration, sample-rate scaled
    let e = 0; for (const d of ch) for (let i = 0; i < n; i++) e += d[i] * d[i];
    const pw = Math.max(Math.sqrt(e / (2 * n)), 0.000125);
    return { L: ch[0], R: ch[1], scale: (Math.pow(10, -58 / 20) / pw) * (44100 / SR) };
  }
  const IR_LONG = makeIR(5.2, 4.2, 303, { pre: 0.018 });
  const IR_SHORT = makeIR(1.1, 0.75, 404, { pre: 0.006, dark: 1.4 });
  prog(0.02, 'noise+IR');

  // ------------------------------------------------------------ graph
  const mk = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  // DETERMINISTIC SUMMATION: Chromium sums the connections of a node input in pointer-hash order, and float addition is not associative, so any
  // node with 3+ simultaneously non-zero inputs makes two renders differ in the last bit (=> +-1 LSB flips after quantisation). Two-term sums
  // are exact/commutative, therefore (a) every fan-in is a balanced binary tree of 2-input gains (treeSum) and (b) each bus is a bank of
  // "lanes": a voice is assigned to a lane in which at most one other voice can still be sounding (laneBus).
  const treeSum = (nodes) => {
    let cur = nodes.slice();
    while (cur.length > 1) { const nx = []; for (let i = 0; i < cur.length; i += 2) { if (i + 1 < cur.length) { const g = mk(1); cur[i].connect(g); cur[i + 1].connect(g); nx.push(g); } else nx.push(cur[i]); } cur = nx; }
    return cur[0];
  };
  const LANE_TAIL = 0.5;   // s: filter ring-out allowance after a voice's sources stop
  function laneBus(M = 72) {
    const lanes = Array.from({ length: M }, () => ({ node: mk(1), iv: [] })); let overflow = 0;
    return {
      out: treeSum(lanes.map((l) => l.node)),
      add(node, t0, t1) {
        t1 += LANE_TAIL; let best = 0, bestC = 1e9;
        for (let k = 0; k < M && bestC > 1; k++) { let c = 0; for (const [a, b] of lanes[k].iv) if (a < t1 && b > t0) c++; if (c < bestC) { bestC = c; best = k; } }
        if (bestC > 1) overflow++;
        lanes[best].iv.push([t0, t1]); node.connect(lanes[best].node);
      },
      get overflow() { return overflow; },
    };
  }
  const mix = mk(1);
  // master gain chain (loudness trim x hero-gap duck x fade) exists ONCE, on a DC probe: the resulting per-sample curve is applied in JS
  const trim = mk(1), masterDuck = mk(1), fadeG = mk(1);
  const probe = ctx.createConstantSource(); probe.offset.value = 1; probe.start(0);
  probe.connect(trim); trim.connect(masterDuck); masterDuck.connect(fadeG);
  const stemBus = ctx.createChannelMerger(NCH); stemBus.connect(ctx.destination);
  fadeG.connect(stemBus, 0, 7);
  const tap = (node, ch) => { const sp = ctx.createChannelSplitter(2); node.connect(sp); sp.connect(stemBus, 0, ch); sp.connect(stemBus, 1, ch + 1); };
  tap(mix, 0);

  const bassBus = laneBus(), padBus = laneBus(), padRawBus = laneBus(), arpBus = laneBus(), drumBus = laneBus(), fxBus = laneBus();
  const duckBass = mk(1), duckPad = mk(1), duckArp = mk(1), dip = mk(1);
  // pad bus: high-pass + a broad notch keeps the 130-400 Hz region from stacking with the sub / bass pulse
  const padHP = ctx.createBiquadFilter(); padHP.type = 'highpass'; padHP.frequency.value = 150; padHP.Q.value = -3;
  const padNotch = ctx.createBiquadFilter(); padNotch.type = 'peaking'; padNotch.frequency.value = 300; padNotch.Q.value = 0.8; padNotch.gain.value = -3.6;
  const dipSrc = [duckBass, duckPad, duckArp, drumBus.out];
  bassBus.out.connect(duckBass);
  padBus.out.connect(padHP); padHP.connect(padNotch); padNotch.connect(duckPad); padRawBus.out.connect(duckPad);   // s06 drone pad bypasses the HP/notch (its 100-300 Hz body is the point)
  arpBus.out.connect(duckArp);
  dip.connect(mix); fxBus.out.connect(mix);

  // reverb sends (long hall for pads/bells/impacts, short room for drums): convolved deterministically in JS after the render
  const send = (from, amt) => { const g = mk(amt); from.connect(g); return g; };
  tap(treeSum([send(duckPad, 0.30), send(duckArp, 0.32), send(fxBus.out, 0.42)]), 2);
  tap(treeSum([send(drumBus.out, 0.25), send(fxBus.out, 0.10)]), 4);

  // Haas widener for the pads (decorrelated, high-passed early copies hard left/right)
  [[0.023, -0.9], [0.017, 0.9]].forEach(([dt, pn]) => {
    const hs = mk(0.32); hs.channelCount = 1; hs.channelCountMode = 'explicit'; duckPad.connect(hs);
    const hd = ctx.createDelay(0.1); hd.delayTime.value = dt; const hh = ctx.createBiquadFilter(); hh.type = 'highpass'; hh.frequency.value = 260;
    const hp = ctx.createStereoPanner(); hp.pan.value = pn; hs.connect(hd); hd.connect(hh); hh.connect(hp); dipSrc.push(hp);
  });
  treeSum(dipSrc).connect(dip);
  // ping-pong dotted-eighth delay (0.375 s) on the arp bus: only the SEND lives in the graph (a feedback cycle in Web Audio is resolved in a
  // pointer-order dependent way in Chromium = non-deterministic); the feedback delay itself runs in JS (see pingPong below)
  const dSend = mk(0.36); dSend.channelCount = 1; dSend.channelCountMode = 'explicit'; duckArp.connect(dSend); dSend.connect(stemBus, 0, 6);

  // ------------------------------------------------------------ envelope / source helpers
  function adsr(p, t, a, peak, hold, r, endPeak = peak) {
    p.setValueAtTime(0.0001, t);
    const ta = t + Math.max(0.002, a);
    p.linearRampToValueAtTime(peak, ta);
    const th = Math.max(ta + 0.001, t + hold);
    if (endPeak !== peak) p.linearRampToValueAtTime(endPeak, th); else p.setValueAtTime(peak, th);
    p.exponentialRampToValueAtTime(0.0001, th + r);
    return th + r * 0.85;
  }
  const OK = (t) => t < TOTAL - 0.001 && t > -1;
  function noiseSrc(t0, t1, kind = 'white') {
    const buf = kind === 'pink' ? PINK : WHITE, s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.start(t0, rdN() * (buf.duration - 0.5)); s.stop(t1); return s;
  }
  function panner(p) { const n = ctx.createStereoPanner(); n.pan.value = clamp(p, -1, 1); return n; }
  function osc(type, f, t0, t1) { if (!(f > 0)) f = 1; if (f > 20000) f = 20000; const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t0); o.stop(t1); return o; }

  // ------------------------------------------------------------ sidechain (pump) + hero gaps registered here
  const duckEv = [];
  const duck = (t, b = 0.7, p = 0.5, a = 0.25) => duckEv.push({ t, b, p, a });

  // ------------------------------------------------------------ voices
  /** warm detuned-saw pad chord with slow filter sweep (c0 -> c1 over the chord length) */
  function _padChord(t, dur, notes, o = {}) {
    if (!OK(t)) return;
    const { g = 0.5, a = 0.7, r = 1.6, c0 = 500, c1 = 2400, type = 'sawtooth', bus = padBus, det = [-11, 0, 11], spread = 0.7, q = 0.7, g1 = g } = o;
    const end = t + dur, f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(c0, t); f.frequency.exponentialRampToValueAtTime(c1, Math.max(end, t + 0.05));
    const eg = mk(0), N = notes.length * det.length, k = 0.7 / Math.sqrt(N);
    const stop = adsr(eg.gain, t, a, g * k, dur, r, g1 * k);
    f.connect(eg); bus.add(eg, t, stop + 0.05); const leaves = [];
    notes.forEach((m, ni) => det.forEach((d, di) => {
      const os = ctx.createOscillator(); os.type = type; os.frequency.value = midi(m); os.detune.value = d + (((ni * 7) % 5) - 2);
      const p = panner(spread * (((ni + di) % 3) - 1)); os.connect(p); leaves.push(p); os.start(t); os.stop(stop + 0.05);
    }));
    treeSum(leaves).connect(f);
  }
  /** choir-like "aah/ooh": detuned saws + vibrato through three formant band-passes */
  function _choir(t, dur, notes, o = {}) {
    if (!OK(t)) return;
    const { g = 0.5, a = 1.0, r = 2.0, vowel = 'ah', g1 = g, bus = padBus } = o;
    const F = vowel === 'oo' ? [[380, 1, 6], [720, 0.5, 6], [2600, 0.12, 8]] : [[700, 1, 6], [1100, 0.6, 7], [2700, 0.18, 8]];
    const lfo = osc('sine', 5.1, t, t + dur + r + 0.1), lg = mk(9); lfo.connect(lg);
    const eg = mk(0), stop = adsr(eg.gain, t, a, g * 0.5 / Math.sqrt(notes.length), dur, r, g1 * 0.5 / Math.sqrt(notes.length));
    bus.add(eg, t, stop + 0.05); const fl = [];
    notes.forEach((m, ni) => {
      const sum = mk(1); const fm = midi(m);
      [-7, 7].forEach((d, di) => {
        const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = fm; o1.detune.value = d; lg.connect(o1.detune);
        const p = panner((ni % 2 ? 1 : -1) * (di ? 0.5 : 0.2)); o1.connect(p); p.connect(sum); o1.start(t); o1.stop(stop + 0.05);
      });
      F.forEach(([fr, gg, qq]) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = qq; const gn = mk(gg * 1.6); sum.connect(bp); bp.connect(gn); fl.push(gn); });
    });
    treeSum(fl).connect(eg);
  }
  function _subNote(t, dur, m, g, o = {}) {
    if (!OK(t)) return;
    const { a = 0.03, r = 0.35, harm = 0.45, bus = bassBus } = o, f = midi(m); g *= 0.42; const g1 = (o.g1 === undefined ? g / 0.42 : o.g1) * 0.42;
    const eg = mk(0), stop = adsr(eg.gain, t, a, g, dur, r, g1);
    const o1 = osc('sine', f, t, stop + 0.05), o2 = osc('sine', f * 2, t, stop + 0.05), h = mk(harm);
    o1.connect(eg); o2.connect(h); h.connect(eg); bus.add(eg, t, stop + 0.05);
  }
  /** plucked bass: saw+sine through decaying low-pass */
  function _bassNote(t, len, m, g, o = {}) {
    if (!OK(t)) return;
    const { cut = 900, bus = bassBus } = o, f = midi(m); g *= 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
    lp.frequency.setValueAtTime(cut, t); lp.frequency.exponentialRampToValueAtTime(160, t + len);
    const eg = mk(0), stop = adsr(eg.gain, t, 0.006, g, len * 0.6, len * 0.4 + 0.05);
    const o1 = osc('sawtooth', f, t, stop + 0.05), o2 = osc('sine', f, t, stop + 0.05), h = mk(0.7);
    o1.connect(lp); lp.connect(eg); o2.connect(h); h.connect(eg); bus.add(eg, t, stop + 0.05);
  }
  /** glassy FM bell */
  function _bell(t, f, g, o = {}) {
    if (!OK(t)) return;
    const { dur = 1.4, ratio = 3.5, pan = 0, bus = arpBus } = o; g *= 1.3;
    // keep the FM side-bands (f + k*ratio*f) below ~10 kHz: tame the modulation index for high notes (no aliasing / harshness)
    const idx = Math.min(o.idx === undefined ? 2.2 : o.idx, Math.max(0.35, 10000 / (ratio * f) - 1));
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * ratio;
    const mg = mk(0); mg.gain.setValueAtTime(idx * f * ratio, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, 0.04 * idx * f * ratio), t + dur * 0.4);
    mod.connect(mg); mg.connect(car.frequency);
    const eg = mk(0), stop = adsr(eg.gain, t, 0.003, g, 0.001, dur);
    const p = panner(pan); car.connect(eg); eg.connect(p); bus.add(p, t, stop + 0.05);
    car.start(t); car.stop(stop + 0.05); mod.start(t); mod.stop(stop + 0.05);
  }
  function _sineTone(t, f, g, r, a = 0.03, hold = 0.25, bus = fxBus) {
    if (!OK(t)) return; const eg = mk(0), stop = adsr(eg.gain, t, a, g, hold, r), o1 = osc('sine', f, t, stop + 0.05); o1.connect(eg); bus.add(eg, t, stop + 0.05);
  }
  /** harp / pluck (saw+triangle through a closing low-pass) */
  function _pluck(t, f, g, o = {}) {
    if (!OK(t)) return;
    const { dur = 1.1, cut = 4200, pan = 0, bus = arpBus } = o; g *= 1.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(cut, t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.3), t + dur * 0.5);
    const eg = mk(0), stop = adsr(eg.gain, t, 0.003, g, 0.001, dur);
    const o1 = osc('sawtooth', f, t, stop + 0.05), o2 = osc('triangle', f * 2.003, t, stop + 0.05), h = mk(0.5);
    o1.connect(lp); o2.connect(h); h.connect(lp); lp.connect(eg); const p = panner(pan); eg.connect(p); bus.add(p, t, stop + 0.05);
  }
  /** rhythmic saw-chord stab */
  function _stab(t, notes, g, o = {}) {
    if (!OK(t)) return;
    const { len = 0.14, cut = 3800, pan = 0, bus = arpBus } = o;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(cut, t); lp.frequency.exponentialRampToValueAtTime(380, t + len);
    const eg = mk(0), stop = adsr(eg.gain, t, 0.002, g / Math.sqrt(notes.length * 2), 0.01, len + 0.04);
    const sl = []; notes.forEach((m) => [-9, 9].forEach((d) => { const o1 = osc('sawtooth', midi(m), t, stop + 0.05); o1.detune.value = d; sl.push(o1); }));
    treeSum(sl).connect(lp); lp.connect(eg); const p = panner(pan); eg.connect(p); bus.add(p, t, stop + 0.05);
  }
  /** anthem lead: 3 detuned saws through gentle LP with delayed vibrato */
  function _lead(t, dur, m, g, o = {}) {
    if (!OK(t)) return;
    const { cut = 3400, bus = arpBus, pan = 0 } = o, f = midi(m);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(cut * 1.6, t); lp.frequency.exponentialRampToValueAtTime(cut, t + 0.25);
    const eg = mk(0), stop = adsr(eg.gain, t, 0.03, g / 1.9, dur, 0.5);
    const lfo = osc('sine', 5.4, t + 0.25, stop + 0.05), lg = mk(8); lfo.connect(lg);
    treeSum([-12, 0, 12].map((d) => { const o1 = osc('sawtooth', f, t, stop + 0.05); o1.detune.value = d; lg.connect(o1.detune); return o1; })).connect(lp);
    lp.connect(eg); const p = panner(pan); eg.connect(p); bus.add(p, t, stop + 0.05);
  }
  function _grain(t, f, g, pan, d, bus = fxBus) {
    if (!OK(t)) return; const eg = mk(0), o1 = osc(rnd() < 0.3 ? 'triangle' : 'sine', f, t, t + d + 0.02);
    eg.gain.setValueAtTime(0, t); eg.gain.linearRampToValueAtTime(g, t + d * 0.3); eg.gain.linearRampToValueAtTime(0, t + d);
    const p = panner(pan); o1.connect(eg); eg.connect(p); bus.add(p, t, t + d + 0.02);
  }
  function dust(t0, t1, densFn, root, scale, gFn, { lo = 0, hi = 1, bus = fxBus } = {}) {
    let t = t0;   // scale === 'chord': grains are drawn from the current chord's bell pool, so they can never clash
    for (;;) {
      t += -Math.log(1 - rnd()) / Math.max(0.2, densFn(t)); if (t >= t1) break;
      const pool = scale === 'chord' ? segAt(t).c.arp : scale;
      const m = (scale === 'chord' ? 0 : root) + 12 * (lo + Math.floor(rnd() * (hi - lo + 1))) + pool[Math.floor(rnd() * pool.length)];
      grain(t, midi(m), gFn(t) * (0.4 + 0.6 * rnd()), rnd() * 1.8 - 0.9, 0.05 + rnd() * 0.10, bus);
    }
  }

  // ---- drums
  function _kick(t, g = 1, o = {}) {
    if (!OK(t)) return;
    const { tail = 0.34, f0 = 150, f1 = 48, click = 0.22, dk = [0.72, 0.5, 0.25] } = o;
    const eg = mk(0), stop = adsr(eg.gain, t, 0.002, g * 0.8, 0.004, tail), os = ctx.createOscillator();
    os.frequency.setValueAtTime(f0, t); os.frequency.exponentialRampToValueAtTime(f1, t + 0.11); os.start(t); os.stop(stop + 0.05);
    os.connect(eg); drumBus.add(eg, t, stop + 0.05);
    if (click > 0) {
      const s = noiseSrc(t, t + 0.02), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const ce = mk(0); adsr(ce.gain, t, 0.001, g * click, 0.001, 0.012); s.connect(hp); hp.connect(ce); drumBus.add(ce, t, t + 0.05);
    }
  }
  function _clap(t, g = 0.5, o = {}) {
    if (!OK(t)) return;
    const { f = 1700, tailT = 0.17 } = o;
    const s = noiseSrc(t, t + tailT + 0.1), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.8;
    const eg = mk(0), p = eg.gain; p.setValueAtTime(0.0001, t);
    [0, 0.011, 0.022].forEach((dt, i) => { p.linearRampToValueAtTime(g * (i === 2 ? 1 : 0.8), t + dt + 0.001); if (i < 2) p.exponentialRampToValueAtTime(g * 0.25, t + dt + 0.010); });
    p.exponentialRampToValueAtTime(0.0001, t + 0.022 + tailT);
    s.connect(bp); bp.connect(eg); const pn = panner(0.05); eg.connect(pn); drumBus.add(pn, t, t + tailT + 0.12);
  }
  function _hat(t, g = 0.15, open = false, pan = 0) {
    if (!OK(t)) return;
    g *= 1.7; const d = open ? 0.17 : 0.035, s = noiseSrc(t, t + d + 0.05), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6200;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 10000;
    const eg = mk(0); adsr(eg.gain, t, 0.001, g, 0.001, d); s.connect(hp); hp.connect(lp); lp.connect(eg); const p = panner(pan); eg.connect(p); drumBus.add(p, t, t + d + 0.06);
  }
  function _taiko(t, g = 0.8) {
    if (!OK(t)) return;
    const eg = mk(0), stop = adsr(eg.gain, t, 0.003, g, 0.01, 0.9), os = ctx.createOscillator();
    os.frequency.setValueAtTime(135, t); os.frequency.exponentialRampToValueAtTime(58, t + 0.22); os.start(t); os.stop(stop + 0.05); os.connect(eg); fxBus.add(eg, t, stop + 0.05);
    const s = noiseSrc(t, t + 0.15), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; const ne = mk(0); adsr(ne.gain, t, 0.002, g * 0.5, 0.002, 0.08);
    s.connect(lp); lp.connect(ne); fxBus.add(ne, t, t + 0.16);
  }

  // ---- fx
  function _noiseRise(t0, t1, o = {}) {
    if (!OK(t0)) return;
    const { g = 0.1, f0 = 300, f1 = 8000, q0 = 0.8, q1 = 3, bus = fxBus, kind = 'white' } = o;
    const s = noiseSrc(t0, t1 + 0.05, kind), bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t1); bp.Q.setValueAtTime(q0, t0); bp.Q.linearRampToValueAtTime(q1, t1);
    const eg = mk(0); eg.gain.setValueAtTime(0.0001, t0); eg.gain.exponentialRampToValueAtTime(g, Math.max(t0 + 0.05, t1 - 0.012)); eg.gain.linearRampToValueAtTime(0, t1);
    s.connect(bp); bp.connect(eg); bus.add(eg, t0, t1 + 0.05);
  }
  function _pitchRise(t0, t1, f0, f1, g, o = {}) {
    if (!OK(t0)) return;
    const { bus = fxBus, type = 'sawtooth', cut = 4200 } = o, lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(cut * 0.3, t0); lp.frequency.exponentialRampToValueAtTime(cut, t1);
    const eg = mk(0); eg.gain.setValueAtTime(0.0001, t0); eg.gain.exponentialRampToValueAtTime(g, Math.max(t0 + 0.05, t1 - 0.012)); eg.gain.linearRampToValueAtTime(0, t1);
    [-8, 8].forEach((d) => { const os = ctx.createOscillator(); os.type = type; os.detune.value = d; os.frequency.setValueAtTime(f0, t0); os.frequency.exponentialRampToValueAtTime(f1, t1); os.start(t0); os.stop(t1 + 0.05); os.connect(lp); });
    lp.connect(eg); bus.add(eg, t0, t1 + 0.05);
  }
  /** riser bundle that peaks at t1 (call with t1 = hero - 0.12) */
  function riser(t0, t1, size = 1, o = {}) {
    const { f0 = 300, f1 = 8000, p0 = 110, p1 = 880 } = o;
    noiseRise(t0, t1, { g: 0.13 * size, f0, f1, q0: 0.7, q1: 2.5 });
    noiseRise(t0, t1, { g: 0.06 * size, f0: f0 * 0.5, f1: f1 * 0.35, q0: 1.2, q1: 4, kind: 'pink' });
    pitchRise(t0, t1, p0, p1, 0.06 * size);
  }
  function _whoosh(t0, t1, tp, o = {}) {
    if (!OK(t0)) return;
    const { f0 = 400, f1 = 4500, g = 0.1, pan0 = -0.7, pan1 = 0.7, q = 1.0 } = o;
    const s = noiseSrc(t0, t1 + 0.05), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t1);
    const eg = mk(0); eg.gain.setValueAtTime(0.0001, t0); eg.gain.exponentialRampToValueAtTime(g, Math.max(t0 + 0.02, tp)); eg.gain.exponentialRampToValueAtTime(0.0001, t1);
    const p = ctx.createStereoPanner(); p.pan.setValueAtTime(pan0, t0); p.pan.linearRampToValueAtTime(pan1, t1);
    s.connect(bp); bp.connect(eg); eg.connect(p); fxBus.add(p, t0, t1 + 0.05);
  }
  function _revCymbal(t0, t1, g = 0.12) {
    if (!OK(t0)) return;
    const s = noiseSrc(t0, t1 + 0.05), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.6;
    hp.frequency.setValueAtTime(1500, t0); hp.frequency.exponentialRampToValueAtTime(4500, t1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9500;
    const eg = mk(0); eg.gain.setValueAtTime(0.0005, t0); eg.gain.exponentialRampToValueAtTime(g, Math.max(t0 + 0.05, t1 - 0.01)); eg.gain.linearRampToValueAtTime(0, t1);
    s.connect(hp); hp.connect(lp); lp.connect(eg); fxBus.add(eg, t0, t1 + 0.05);
  }
  /** big cinematic hit: sub drop + broadband noise burst + boom + click + air */
  function _impact(t, size = 1, o = {}) {
    if (!OK(t)) return;
    const { sub = 1, bright = 1, subF = 96, tail = 2.4, subDelay = size >= 0.8 ? 0.006 : 0 } = o, ts = t + subDelay;   // sub weight lands 6 ms behind the click/kick on big hits (peak stagger)
    // sub drop
    let eg = mk(0), stop = adsr(eg.gain, ts, 0.003, 0.72 * size * sub, 0.06, tail * Math.min(1.2, 0.6 + size * 0.5));
    let os = ctx.createOscillator(); os.frequency.setValueAtTime(subF, ts); os.frequency.exponentialRampToValueAtTime(31, ts + 0.75); os.start(ts); os.stop(stop + 0.05); os.connect(eg); fxBus.add(eg, ts, stop + 0.05);
    eg = mk(0); stop = adsr(eg.gain, ts, 0.003, 0.28 * size * sub, 0.01, 0.8);
    os = ctx.createOscillator(); os.type = 'triangle'; os.frequency.setValueAtTime(subF * 2, ts); os.frequency.exponentialRampToValueAtTime(62, ts + 0.45); os.start(ts); os.stop(stop + 0.05); os.connect(eg); fxBus.add(eg, ts, stop + 0.05);
    // broadband burst (closing low-pass)
    let s = noiseSrc(t, t + 2.2), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(9500, t); lp.frequency.exponentialRampToValueAtTime(220, t + 1.7);
    eg = mk(0); adsr(eg.gain, t, 0.001, 0.62 * size * bright, 0.01, 1.7); s.connect(lp); lp.connect(eg); fxBus.add(eg, t, t + 2.2);
    // low boom (pink)
    s = noiseSrc(t, t + 3.2, 'pink'); lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    eg = mk(0); adsr(eg.gain, t, 0.002, 0.6 * size, 0.05, 2.6); s.connect(lp); lp.connect(eg); fxBus.add(eg, t, t + 3.2);
    // click / crack
    s = noiseSrc(t, t + 0.2); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.6;
    eg = mk(0); adsr(eg.gain, t, 0.001, 0.4 * size * bright, 0.001, 0.07); s.connect(bp); bp.connect(eg); fxBus.add(eg, t, t + 0.2);
    // air / crash
    s = noiseSrc(t, t + 2.4); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 8500;
    eg = mk(0); adsr(eg.gain, t, 0.004, 0.2 * size * bright, 0.03, 1.9); s.connect(hp); hp.connect(lp2); lp2.connect(eg); fxBus.add(eg, t, t + 2.4);
  }
  /** glitchy stutter burst (bit-crushed saw blips + noise ticks) */
  function _stutter(t0, t1, step, g) {
    const n = 10, c = new Float32Array(1024); for (let i = 0; i < 1024; i++) c[i] = Math.round(((i / 1023) * 2 - 1) * n) / n;
    const ws = ctx.createWaveShaper(); ws.curve = c; const out = mk(1); ws.connect(out); arpBus.add(out, t0, t1 + 0.1);
    const seg = segAt(t0); let i = 0;
    for (let t = t0; t < t1 - 1e-6; t += step, i++) {
      const r = rnd(); if (r < 0.12) continue; const len = step * 0.72; const eg = mk(0);
      const lv = g * (0.6 + 0.4 * ((t - t0) / (t1 - t0)));
      eg.gain.setValueAtTime(lv, t); eg.gain.setValueAtTime(0, t + len); eg.connect(ws);
      if (r < 0.6) { const pool = seg.c.arp; const m = pool[Math.floor(rnd() * pool.length)] + (rnd() < 0.3 ? 12 : 0); osc('sawtooth', midi(m), t, t + len + 0.01).connect(eg); }
      else { const s = noiseSrc(t, t + len + 0.01), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; s.connect(hp); hp.connect(eg); }
    }
  }


  // ------------------------------------------------------------ lazy voice creation
  // Nodes that are created up-front but start later still cost CPU in Chromium, so every voice is queued and only
  // instantiated one second before it sounds (ctx.suspend windows, see the render loop).
  const Q = [];
  const defer = (t, fn) => Q.push({ t, fn, i: Q.length });
  const lazy = (fn) => (...args) => { if (!OK(args[0])) return; defer(args[0], () => fn(...args)); };
  const padChord = lazy(_padChord), choir = lazy(_choir), subNote = lazy(_subNote), bassNote = lazy(_bassNote), bell = lazy(_bell), sineTone = lazy(_sineTone),
    pluck = lazy(_pluck), stab = lazy(_stab), lead = lazy(_lead), grain = lazy(_grain), clap = lazy(_clap), hat = lazy(_hat), taiko = lazy(_taiko),
    noiseRise = lazy(_noiseRise), pitchRise = lazy(_pitchRise), whoosh = lazy(_whoosh), revCymbal = lazy(_revCymbal), impact = lazy(_impact), stutter = lazy(_stutter);
  const _kickLazy = lazy(_kick);
  const kick = (t, g = 1, o = {}) => { if (!OK(t)) return; const dk = o.dk === undefined ? [0.72, 0.5, 0.25] : o.dk; if (dk) duck(t, dk[0], dk[1], dk[2]); _kickLazy(t, g, o); };

  // ------------------------------------------------------------ chord map
  const segs = [];
  TL.scenes.forEach((s, i) => {
    const tab = CH_TABLE[i];
    tab.forEach(([b, n], k) => segs.push({ t0: s.start + b * BEAT, t1: k + 1 < tab.length ? s.start + tab[k + 1][0] * BEAT : s.start + s.dur, n, c: CH[n], scene: i }));
  });
  const segAt = (t) => segs.find((s) => t >= s.t0 - 1e-6 && t < s.t1 - 1e-6) || segs[segs.length - 1];
  const heroes = TL.scenes.map((s) => s.start + s.anchors.hero);
  const isHeroT = (t) => heroes.some((h) => Math.abs(h - t) < 1e-3);

  const grid = (t0, t1, step, cb) => { for (let i = Math.ceil(t0 / step - 1e-9); i * step < t1 - 1e-9; i++) cb(i * step, i); };
  const S = (i, l) => TL.scenes[i].start + l;
  const segsIn = (t0, t1, cb) => { for (const s of segs) { if (s.t1 <= t0 + 1e-6 || s.t0 >= t1 - 1e-6) continue; cb(Math.max(s.t0, t0), Math.min(s.t1, t1), s); } };
  const opt = (o, a, b, s) => (typeof o === 'function' ? o(a, b, s) : o);

  // ---- layers
  const padLayer = (t0, t1, o) => segsIn(t0, t1, (a, b, s) => padChord(a, b - a, s.c.pad, opt(o, a, b, s)));
  const choirLayer = (t0, t1, o) => segsIn(t0, t1, (a, b, s) => choir(a, b - a, s.c.pad.slice(0, 4).map((m, i) => (i === 0 ? m + 12 : m + 12)), opt(o, a, b, s)));
  const subLayer = (t0, t1, o) => segsIn(t0, t1, (a, b, s) => { const oo = opt(o, a, b, s); subNote(a, b - a, s.c.r, oo.g, oo); });
  /** 8th-note pulsing plucked bass, octave jumps on the off-beats */
  function bassPulse(t0, t1, gFn, step = 0.25, offOct = 12) {
    grid(t0, t1, step, (t, i) => { const s = segAt(t); const off = Math.round(t / step) % 2; const m = s.c.r + 12 + (off ? offOct : 0); bassNote(t, step * 0.92, m, gFn(t) * (off ? 0.7 : 1), { cut: off ? 1400 : 900 }); });
  }
  const PAT = [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 5, 3, 2, 1, 2];
  /** 16th (or 8th) note bell arpeggio locked to the grid */
  function arpLayer(t0, t1, gFn, { step = 0.125, oct = 0, dur = 1.3, ratio = 3.0, idx = 1.6, pat = PAT, skip = null } = {}) {
    grid(t0, t1, step, (t, i) => {
      if (skip && skip(t, i)) return; const s = segAt(t), pool = s.c.arp, k = pat[i % pat.length];
      const acc = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.75 : 0.55;
      bell(t, midi(pool[k % pool.length] + oct), gFn(t) * acc, { dur, ratio, idx, pan: 0.55 * Math.sin(i * 0.9) });
    });
  }
  const kick4 = (t0, t1, g, o) => grid(t0, t1, BEAT, (t) => kick(t, typeof g === 'function' ? g(t) : g, o));
  const clap24 = (t0, t1, g) => grid(t0, t1, BEAT, (t, i) => { if (i % 2 === 1) clap(t, typeof g === 'function' ? g(t) : g); });
  function hats16(t0, t1, gFn, { openOff = true } = {}) {
    const V = [1, 0.35, 0.65, 0.35];
    grid(t0, t1, 0.125, (t, j) => { const k = j % 4; const open = openOff && k === 2 && j % 8 === 2; hat(t, gFn(t) * V[k] * (open ? 1.1 : 1), open, ((j % 3) - 1) * 0.3); });
  }
  function hats8(t0, t1, gFn) { grid(t0, t1, 0.25, (t, j) => hat(t, gFn(t) * (j % 2 ? 1 : 0.55), j % 4 === 3, (j % 2 ? 0.25 : -0.25))); }
  /** rising clap roll: interval shrinks geometrically */
  function clapRoll(t0, t1, i0, ratio, g0, g1) {
    let t = t0, iv = i0, n = 0; const N = 40;
    while (t < t1 - 0.02) { const x = (t - t0) / (t1 - t0); clap(t, g0 + (g1 - g0) * x, { tailT: 0.08 }); t += iv; iv = Math.max(0.045, iv * ratio); n++; if (n > 80) break; }
  }
  function pumpOnly(t0, t1, step, b, p, a) { grid(t0, t1, step, (t) => duck(t, b, p, a)); }

  // ============================================================ ARRANGEMENT
  prog(0.05, 'arranging');

  // ------------------------------------------------------------ s00 CURVES  0-10
  {
    const sc = 0, h = heroes[0];
    sineTone(0.6, 1174.66, 0.15, 3.6);                       // THE first sound: pure D6 sine (point of light)
    whoosh(0.9, 2.6, 1.5, { f0: 500, f1: 2600, g: 0.022, pan0: -0.3, pan1: 0.3 });   // faint shockwave ring
    subLayer(1.2, 10, (a, b, s) => ({ g: curve([[1.2, 0.05], [4, 0.28], [6, 0.34], [10, 0.4]])(a), a: a < 4 ? 2.5 : 0.7, g1: curve([[1.2, 0.05], [4, 0.28], [6, 0.34], [10, 0.4]])(b), r: 0.6 }));
    padLayer(1.2, 10, (a, b, s) => ({ g: isHeroT(a) ? 0.9 : curve([[1.2, 0.18], [4, 0.4], [10, 0.55]])(a), a: isHeroT(a) ? 0.05 : a < 4 ? 2.4 : 1.0, r: 1.8, c0: a < 4 ? 260 : 700, c1: a < 4 ? 1000 : 2400, g1: isHeroT(a) ? 0.55 : curve([[1.2, 0.18], [4, 0.4], [10, 0.55]])(b) }));
    // heartbeat pulse (soft kick every second)
    grid(2, 9.9, 1.0, (t) => { if (Math.abs(t - h) < 0.01) return; kick(t, curve([[2, 0.22], [6, 0.5], [10, 0.5]])(t), { f0: 110, f1: 44, tail: 0.3, click: 0.05, dk: [0.35, 0.3, 0.1] }); });
    // glass drops while the point flies
    grid(3, 5.86, 0.5, (t, i) => { const s = segAt(t); bell(t, midi(s.c.arp[(i * 2) % 6] + 12), 0.03 + 0.006 * (t - 3), { dur: 2.2, pan: 0.5 * Math.sin(i * 1.7) }); });
    dust(1.6, 10, curve([[1.6, 2], [6, 6], [10, 8]]), 62, 'chord', curve([[1.6, 0.02], [6, 0.045], [10, 0.05]]), { lo: 0, hi: 1 });
    // build: 2.0 -> 5.88, hero 6.0
    riser(2.0, h - 0.12, 0.55, { f0: 400, f1: 7000, p0: 146.8, p1: 587 });
    impact(h, 0.62, { bright: 0.8 });
    kick(h, 0.9);
    // the pulse of light running through the knot: fast 32nd-note ascending run
    [65, 69, 72, 77, 81, 84, 88, 93].forEach((m, i) => bell(h + 0.02 + i * 0.0625, midi(m), 0.07 + 0.004 * i, { dur: 1.8, pan: -0.6 + i * 0.17 }));
    // after the hero: airy melody, sparse
    [[6.5, 84], [7.0, 81], [7.5, 77], [8.0, 85], [8.5, 81], [9.0, 76], [9.5, 73]].forEach(([t, m], i) => bell(t, midi(m), 0.05, { dur: 2.4, pan: i % 2 ? 0.5 : -0.5 }));
    // hint of the next chapter
    whoosh(8.7, 10.6, 10.0, { f0: 300, f1: 4200, g: 0.055 });
  }

  // ------------------------------------------------------------ s01 SURFACES 10-20
  {
    const h = heroes[1], s0 = S(1, 0);
    // zoom transition: whoosh peaking on the downbeat + thump
    whoosh(s0 - 0.6, s0 + 0.9, s0 + 0.02, { f0: 350, f1: 5000, g: 0.16 });
    impact(s0, 0.55, { bright: 0.7, sub: 0.7 }); kick(s0, 0.9);
    subLayer(s0, 20, (a, b) => ({ g: 0.4, a: 0.05, r: 0.4 }));
    padLayer(s0, 20, (a) => ({ g: isHeroT(a) ? 1.0 : 0.62, a: isHeroT(a) ? 0.05 : 0.9, r: 1.6, c0: isHeroT(a) ? 3500 : 500, c1: isHeroT(a) ? 1800 : 2600, g1: isHeroT(a) ? 0.7 : 0.62 }));
    // arps: enter on the downbeat, growing
    arpLayer(s0, h - 0.12, curve([[10, 0.05], [15, 0.11]]), { dur: 1.2 });
    arpLayer(h, 20 - 0.0, () => 0.12, { dur: 1.2 });
    // build 12 -> 14.88 with beats
    kick4(12, h - 1.0, 0.7, { dk: [0.7, 0.5, 0.25] });
    hats8(14, h - 1.0, () => 0.1);
    bassPulse(12, h - 1.0, () => 0.32);
    riser(12.0, h - 0.12, 0.85, { f0: 350, f1: 7500, p0: 130, p1: 700 });
    impact(h, 0.85);
    kick(h, 1.0);
    // lines of curvature ignite: twin bell cascades (parallels + meridians)
    [72, 76, 79, 84, 88, 91].forEach((m, i) => { bell(h + 0.03 + i * 0.07, midi(m), 0.09, { dur: 2.2, pan: -0.7 + 0.05 * i }); bell(h + 0.06 + i * 0.07, midi([60, 65, 69, 72, 77, 81][i]), 0.07, { dur: 2.0, ratio: 2, pan: 0.7 - 0.05 * i }); });
    // groove after the hero
    kick4(h + 0.5, 19.0, 0.95); clap24(16, 19.0, 0.42); hats16(h + 0.5, 19.0, curve([[15, 0.08], [19, 0.12]]));
    bassPulse(h, 19.0, curve([[15, 0.42], [19, 0.5]]));
    // riser into the flash of s02 (ends 0.12 s before 20)
    riser(18.6, 20 - 0.12, 0.8, { f0: 500, f1: 8000, p0: 200, p1: 1200 }); revCymbal(18.4, 20 - 0.12, 0.12);
  }

  // ------------------------------------------------------------ s02 CURVATURE 20-32
  {
    const s0 = S(2, 0), h = heroes[2], cl = S(2, 10);
    // flash = impact on the downbeat, bright shimmer that settles dark
    impact(s0, 0.95, { bright: 1.1 }); kick(s0, 1.0);
    [86, 81, 77, 74, 89, 93].forEach((m, i) => bell(s0 + 0.02 + i * 0.03, midi(m), 0.09 - 0.008 * i, { dur: 3.4, pan: (i % 2 ? 1 : -1) * 0.5 }));
    subLayer(s0, 32, (a) => ({ g: isHeroT(a) ? 0.55 : 0.42, a: 0.03, r: 0.4 }));
    padLayer(s0, 32, (a) => {
      if (Math.abs(a - s0) < 0.01) return { g: 0.75, a: 0.02, r: 1.8, c0: 5200, c1: 700, g1: 0.55 };     // bright -> dark
      if (isHeroT(a)) return { g: 1.05, a: 0.05, c0: 3800, c1: 1800, g1: 0.75 };
      if (Math.abs(a - cl) < 0.01) return { g: 1.15, a: 0.05, c0: 4000, c1: 2200, g1: 0.9 };
      return { g: 0.62, a: 0.8, r: 1.6, c0: 500, c1: 2800, g1: 0.7 };
    });
    // Act A: rolling 16th bells, half-time pulse (no full drums yet)
    arpLayer(s0 + 0.5, h - 0.12, curve([[20, 0.06], [26, 0.11]]), { dur: 1.2 });
    bassPulse(s0 + 2, h - 1.0, () => 0.34);
    grid(s0 + 1, h - 1.0, 2 * BEAT * 2 / 2, (t, i) => { if (Math.round(t / 1) % 2 === 0) kick(t, 0.7); });  // kick on every bar downbeat only
    kick4(S(2, 4), h - 1.0, 0.7);
    hats8(S(2, 4), h - 1.0, () => 0.08);
    riser(22.0, h - 0.12, 1.0, { f0: 350, f1: 8000, p0: 120, p1: 900 });
    clapRoll(S(2, 4.6), h - 0.12, 0.25, 0.9, 0.12, 0.3);
    // HERO 26: drums drop in, full arps
    impact(h, 1.0); kick(h, 1.05);
    arpLayer(h, cl - 0.12, curve([[26, 0.12], [30, 0.15]]), { dur: 1.3 });
    kick4(h + 0.5, cl - 1.0, 1.0); clap24(h + 1.0, cl - 1.0, 0.5); hats16(h + 0.5, cl - 1.0, () => 0.11);
    bassPulse(h, cl - 1.0, curve([[26, 0.5], [30, 0.55]]));
    // riser + snare roll into the CLIMAX at 30
    riser(S(2, 8.0), cl - 0.12, 1.0, { f0: 500, f1: 8500, p0: 150, p1: 1000 });
    clapRoll(S(2, 8.4), cl - 0.12, 0.25, 0.86, 0.15, 0.4);
    impact(cl, 0.9); kick(cl, 1.05);
    [72, 79, 84, 88, 91, 96].forEach((m, i) => bell(cl + 0.02 + i * 0.05, midi(m), 0.09, { dur: 3.0, pan: (i % 2 ? 1 : -1) * 0.6 }));
    choirLayer(cl, 32, (a) => ({ g: 0.75, a: 0.15, r: 2.4, vowel: 'ah' }));
    arpLayer(cl, 31.5, () => 0.16, { dur: 1.3 });
    arpLayer(cl, 31.5, () => 0.08, { dur: 1.0, oct: 12, step: 0.25, pat: [3, 4, 5, 4, 3, 5, 4, 2] });
    kick4(cl + 0.5, S(2, 11.5), 1.05); clap24(cl + 0.5, S(2, 11.5), 0.55); hats16(cl + 0.5, S(2, 11.5), () => 0.13);
    bassPulse(cl, S(2, 11.5), () => 0.58);
    // fill into the iris
    revCymbal(S(2, 10.6), 32 - 0.0, 0.13);
    hat(S(2, 11.5), 0.12); clap(S(2, 11.75), 0.3);
  }

  // ------------------------------------------------------------ s03 GEODESICS 32-42
  {
    const s0 = S(3, 0), h = heroes[3];
    // iris: rising sweep landed in previous scene; here a soft chime cluster + gentle thump
    noiseRise(s0 - 0.9, s0 + 0.0, { g: 0.05, f0: 600, f1: 6000, q0: 1, q1: 3 });
    [77, 81, 84, 89, 93].forEach((m, i) => bell(s0 + 0.02 + i * 0.06, midi(m), 0.08, { dur: 3.2, ratio: 2, pan: (i % 2 ? 1 : -1) * 0.5 }));
    kick(s0, 0.7, { f0: 120, tail: 0.4 }); impact(s0, 0.3, { bright: 0.3, sub: 0.6 });
    subLayer(s0, 42, (a) => ({ g: 0.32, a: 0.08, r: 0.5 }));
    // strings-like pad: slower attack, gentler filter
    padLayer(s0, 42, (a) => (isHeroT(a) ? { g: 1.0, a: 0.06, c0: 3600, c1: 2200, det: [-7, 0, 7], g1: 0.75 } : { g: 0.6, a: 1.1, r: 1.8, c0: 900, c1: 2600, det: [-7, 0, 7], q: 0.5 }));
    // harp-like plucks on 8ths (up-down)
    const HP = [0, 2, 4, 5, 4, 2, 3, 1];
    grid(s0 + 0.5, h - 0.12, 0.25, (t, i) => { const s = segAt(t), pool = s.c.arp; pluck(t, midi(pool[HP[i % 8] % 6] + (i % 16 < 8 ? 0 : 12)), curve([[32, 0.07], [37, 0.11]])(t) * (i % 2 ? 0.7 : 1), { dur: 1.1, pan: 0.6 * Math.sin(i * 0.7) }); });
    bell(s0 + 4.0, midi(84), 0.05, { dur: 3, ratio: 2 });
    kick(S(3, 2), 0.4); kick(S(3, 4), 0.4); kick(S(3, 6), 0.45);
    riser(S(3, 2.0), h - 0.12, 0.6, { f0: 900, f1: 7500, p0: 300, p1: 1400 });
    // hero 37: geodesic beams = 30-note rising pentatonic pluck cascade
    impact(h, 0.78, { bright: 0.9, sub: 0.85 }); kick(h, 0.9);
    for (let i = 0; i < 30; i++) {
      const k = Math.round(i * 0.62), m = 53 + 12 * Math.floor(k / 5) + PENT_F[k % 5];
      pluck(h + 0.01 + i * 0.075, midi(m), 0.13 * (1 - 0.35 * (i / 30)), { dur: 1.6, cut: 5200, pan: 0.85 * Math.sin(i * 0.55) });
      if (i % 3 === 0) bell(h + 0.02 + i * 0.075, midi(m + 12), 0.05, { dur: 2.2, ratio: 2, pan: -0.85 * Math.sin(i * 0.55) });
    }
    // after: drums re-enter softly, energy up to 7
    kick4(h + 2.5, 41.0, curve([[39.5, 0.42], [41, 0.6]])); hats8(h + 2.0, 41.0, () => 0.055);
    clap24(h + 3.0, 41.0, 0.2);
    bassPulse(h + 2.0, 41.0, curve([[39, 0.28], [41, 0.42]]));
    arpLayer(h + 0.3, 41.5, curve([[37, 0.07], [41, 0.11]]), { step: 0.125, dur: 1.2, ratio: 2 });
    // glitch lead-in for s04
    stutter(41.5, 42.0, 0.0625, 0.05);
    riser(40.6, 42 - 0.05, 0.6, { f0: 800, f1: 8000, p0: 250, p1: 1500 });
  }

  // ------------------------------------------------------------ s04 GAUSS-BONNET 42-52
  {
    const s0 = S(4, 0), h = heroes[4];
    // glitch cut
    kick(s0, 1.0); clap(s0, 0.5); impact(s0, 0.5, { bright: 0.9, sub: 0.6, tail: 1.2 });
    stutter(s0 + 0.0, s0 + 0.5, 0.0625, 0.06);
    subLayer(s0, 52, (a) => ({ g: isHeroT(a) ? 0.55 : 0.34, a: 0.03, r: 0.3 }));
    padLayer(s0, 52, (a) => (isHeroT(a) ? { g: 1.15, a: 0.05, c0: 4200, c1: 2200, g1: 0.85 } : { g: 0.5, a: 0.5, c0: 400, c1: 2000, r: 1.4 }));
    // 3-3-2 saw stabs on the 16th grid + 16th bass
    const STAB = [0, 3, 6, 8, 11, 14];
    grid(s0 + 0.5, h - 1.0, 0.125, (t, i) => { const st = i % 16; if (STAB.includes(st)) { const s = segAt(t); stab(t, s.c.pad.slice(1, 4).map((m) => m + 12), 0.2, { pan: st % 2 ? 0.4 : -0.4 }); } });
    const BASSP = [0, 2, 3, 6, 8, 10, 11, 14];
    grid(s0 + 0.5, h - 1.0, 0.125, (t, i) => { const st = i % 16; if (BASSP.includes(st)) { const s = segAt(t); bassNote(t, 0.11, s.c.r + 12 + (st === 3 || st === 11 ? 12 : 0), 0.42, { cut: 1300 }); } });
    kick4(s0 + 0.5, h - 1.0, 0.9); kick(s0 + 1.75, 0.55); clap24(s0 + 1.0, h - 1.0, 0.36);
    grid(s0 + 0.5, h - 1.0, 0.125, (t, j) => { if (rnd() < 0.72) hat(t, 0.075 * [1, 0.4, 0.7, 0.4][j % 4], j % 8 === 6, rnd() * 0.8 - 0.4); });
    arpLayer(S(4, 3), h - 1.0, () => 0.08, { step: 0.125, dur: 0.8, ratio: 2, skip: (t, i) => i % 3 === 2 });
    // random glitch bursts every 2 bars
    [S(4, 3.5), S(4, 6.0)].forEach((t, i) => stutter(t + 0.5, t + 0.5 + 0.5, 0.0625, 0.05));
    riser(S(4, 2.0), h - 0.12, 0.95, { f0: 400, f1: 8000, p0: 130, p1: 900 });
    clapRoll(S(4, 3.8), h - 0.12, 0.25, 0.88, 0.1, 0.32);
    // HERO 47: huge Bb chord
    impact(h, 1.05); kick(h, 1.05);
    choir(h, 3.0, [58, 62, 65, 70], { g: 0.75, a: 0.08, r: 2.0, vowel: 'ah' });
    stab(h + 0.008, [58, 65, 70, 74, 77], 0.55, { len: 0.6, cut: 5000 });
    [74, 77, 82, 86, 89, 94].forEach((m, i) => bell(h + 0.02 + i * 0.05, midi(m), 0.09, { dur: 2.8, pan: (i % 2 ? 1 : -1) * 0.6 }));
    // after: driving groove, energy 8
    arpLayer(h, 52 - 0.0, curve([[47, 0.13], [52, 0.15]]), { dur: 1.2 });
    kick4(h + 0.5, 51.5, 0.95); clap24(h + 1.0, 51.5, 0.4); hats16(h + 0.5, 51.5, () => 0.085);
    bassPulse(h, 51.5, () => 0.5, 0.25, 0);
    grid(h + 1.0, 51.5, 0.125, (t, i) => { const st = i % 16; if (STAB.includes(st) && t > h + 1.9 && ((Math.round(t / 2) % 2) === 1)) { const s = segAt(t); stab(t, s.c.pad.slice(1, 4).map((m) => m + 12), 0.16, { pan: st % 2 ? 0.4 : -0.4 }); } });
    // fill into the zoom
    clapRoll(S(4, 9.0), 52 - 0.0, 0.125, 0.9, 0.2, 0.4);
    revCymbal(S(4, 8.6), 52, 0.12);
  }

  // ------------------------------------------------------------ s05 SPACETIME 52-62
  {
    const s0 = S(5, 0), h = heroes[5];
    // zoom whoosh + deep thump
    whoosh(s0 - 0.6, s0 + 1.0, s0 + 0.02, { f0: 250, f1: 4500, g: 0.12 });
    impact(s0, 0.6, { bright: 0.5 }); taiko(s0, 0.9);
    subLayer(s0, 62, (a) => ({ g: isHeroT(a) ? 0.5 : 0.4, a: 0.05, r: 0.5, harm: 0.9 }));
    // very low slow tremolo drone (D1 pedal) for mass
    defer(s0, () => {
      const dr = mk(0); adsr(dr.gain, s0, 1.0, 0.18, 9.0, 0.5); bassBus.add(dr, s0, 62.5);
      const dlfo = osc('sine', 0.22, s0, 62.5), dlg = mk(0.06); dlfo.connect(dlg); dlg.connect(dr.gain);
      osc('sine', midi(26), s0, 62.5).connect(dr);
      const d2 = mk(0.42); osc('sine', midi(38), s0, 62.5).connect(d2); d2.connect(dr);   // D2 (73 Hz): the pitch stays audible on small speakers
    });
    padLayer(s0, 62, (a) => (isHeroT(a) ? { g: 1.2, a: 0.05, c0: 4500, c1: 2600, g1: 0.9, r: 2.5 } : { g: 0.68, a: 1.2, c0: 500, c1: 3200, r: 2.0, det: [-14, -5, 5, 14] }));
    choirLayer(s0 + 0.5, 62, (a) => (isHeroT(a) ? { g: 1.0, a: 0.06, r: 3.0, vowel: 'ah' } : { g: 0.6, a: 1.2, r: 2.2, vowel: a > s0 + 4 ? 'ah' : 'oo' }));
    // half-time taiko + kick, big clap on 3
    grid(s0 + 1.0, h - 1.0, 1.0, (t, i) => { if (i % 2 === 0) { kick(t, 1.0, { tail: 0.42, f1: 50 }); taiko(t + 0.001, 0.5); } else clap(t, 0.5, { tailT: 0.3 }); });
    grid(s0 + 2.0, h - 1.0, 0.5, (t, i) => { if (i % 4 === 3) taiko(t, 0.35); });
    // slow wide bells + granular stars
    arpLayer(s0 + 1.0, h - 0.12, () => 0.07, { step: 0.5, dur: 3.0, ratio: 2.0, oct: 12, pat: [0, 3, 5, 2, 4, 1, 5, 3] });
    dust(s0 + 0.2, 62, curve([[52, 8], [58, 16], [62, 12]]), 62, 'chord', curve([[52, 0.03], [58, 0.06], [62, 0.05]]), { lo: 0, hi: 1 });
    riser(S(5, 2.0), h - 0.12, 1.3, { f0: 250, f1: 9000, p0: 60, p1: 700 });
    noiseRise(S(5, 2.0), h - 0.12, { g: 0.09, f0: 120, f1: 1400, q0: 1, q1: 2, kind: 'pink' });
    pitchRise(S(5, 2.0), h - 0.12, 36.7, 220, 0.08, { cut: 900 });
    clapRoll(S(5, 4.4), h - 0.12, 0.25, 0.9, 0.1, 0.3);
    // HERO 58: the biggest so far
    impact(h, 1.3, { bright: 1.2, subF: 110, tail: 3.0 }); kick(h, 1.1); taiko(h + 0.003, 0.6);
    [74, 81, 86, 89, 93, 98].forEach((m, i) => bell(h + 0.02 + i * 0.05, midi(m), 0.1, { dur: 3.4, pan: (i % 2 ? 1 : -1) * 0.65 }));
    stab(h + 0.008, [50, 57, 62, 65, 69, 74], 0.5, { len: 0.9, cut: 5000 });
    kick4(h + 0.5, 61.3, 1.05); clap24(h + 1.0, 61.3, 0.5); hats16(h + 0.5, 61.3, () => 0.1);
    grid(h, 61.3, 1.0, (t) => taiko(t + 0.5, 0.4));
    bassPulse(h, 61.3, () => 0.46, 0.25, 0);
    arpLayer(h, 61.5, () => 0.13, { dur: 1.5 });
    // exhale into the dip
    whoosh(S(5, 9.2), 62.6, 62.0, { f0: 3000, f1: 120, g: 0.08 });
    pitchRise(61.4, 62.0, 500, 60, 0.05, { cut: 1200 });
  }

  // ------------------------------------------------------------ s06 RICCI 62-70
  {
    const s0 = S(6, 0), h = heroes[6];
    // dip: low swell from black
    defer(s0, () => {
      const sw = mk(0); adsr(sw.gain, s0 + 0.1, 3.0, 0.22, 3.0, 0.8); bassBus.add(sw, s0 + 0.1, 68); osc('sine', midi(26), s0 + 0.1, 68).connect(sw);
      const sw2 = mk(1.0); osc('sine', midi(38), s0 + 0.1, 68).connect(sw2); sw2.connect(sw);   // octave-up sine (73 Hz): body that small speakers can play
      const s2 = noiseSrc(s0, 67, 'pink'), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const ne = mk(0); adsr(ne.gain, s0, 3.0, 0.16, 2.5, 1.0); s2.connect(lp); lp.connect(ne); fxBus.add(ne, s0, 67);
    });
    // dark tension drone (D + A + Eb)
    padLayer(s0, h, (a) => ({ g: 0.6, a: 2.2, r: 1.5, c0: 260, c1: 950, det: [-15, 0, 15], q: 1.5, g1: 0.8, bus: padRawBus }));
    // slow breathing noise
    defer(s0 + 1, () => {
      const bs = noiseSrc(s0 + 1, h, 'pink'), bl = ctx.createBiquadFilter(); bl.type = 'bandpass'; bl.Q.value = 3; bl.frequency.value = 500;
      const bl2 = osc('sine', 0.13, s0 + 1, h), bg = mk(280); bl2.connect(bg); bg.connect(bl.frequency);
      const be = mk(0); adsr(be.gain, s0 + 1, 3.0, 0.07, 2.0, 1.0); bs.connect(bl); bl.connect(be); fxBus.add(be, s0 + 1, h);
    });
    // two far bells
    bell(S(6, 2.4), midi(57), 0.09, { dur: 5, ratio: 2, pan: -0.4 }); bell(S(6, 3.3), midi(51 + 12), 0.05, { dur: 5, ratio: 3.5, pan: 0.5 });
    // build 63.5 -> 65.88 (quiet)
    pitchRise(S(6, 1.5), h - 0.12, 110, 440, 0.03, { type: 'sine', cut: 2000 });
    noiseRise(S(6, 1.5), h - 0.12, { g: 0.03, f0: 400, f1: 6000, q0: 1, q1: 3 });
    // HERO 66: warm release (exhale) - a soft boom + Bbmaj7 bloom
    impact(h, 0.8, { bright: 0.5, sub: 0.9, subF: 70, tail: 3.0 });
    [77, 81, 86, 89, 93].forEach((m, i) => bell(h + 0.03 + i * 0.09, midi(m), 0.1, { dur: 4.0, ratio: 2, pan: (i % 2 ? 1 : -1) * 0.5 }));
    subLayer(h, 70, (a) => ({ g: 0.4, a: 0.05, r: 0.5, harm: 0.9 }));
    padLayer(h, 70, (a) => (isHeroT(a) ? { g: 1.0, a: 0.06, r: 2.0, c0: 3200, c1: 1500, g1: 0.55 } : { g: 0.5, a: 1.5, c0: 700, c1: 1800, g1: 0.65 }));
    choir(h, 2.0, [62, 65, 69, 74], { g: 0.5, a: 0.3, r: 1.5, vowel: 'oo' });
    // calm sphere: sparse bells
    [[66.9, 81], [67.4, 77], [67.9, 74], [68.4, 81], [69.0, 76], [69.5, 73]].forEach(([t, m], i) => bell(t, midi(m), 0.045, { dur: 3.0, ratio: 2, pan: i % 2 ? 0.4 : -0.4 }));
    dust(h, 70, () => 4, 62, 'chord', () => 0.025, { lo: 0, hi: 1 });
    // dominant build into the flash
    riser(68.0, 70 - 0.12, 0.55, { f0: 500, f1: 7000, p0: 220, p1: 880 });
  }

  // ------------------------------------------------------------ s07 FINALE 70-84
  {
    const s0 = S(7, 0), h = heroes[7];
    // whiteout impact on the flash
    impact(s0, 1.0, { bright: 1.1 }); kick(s0, 1.0);
    [81, 85, 88, 93, 97, 100].forEach((m, i) => bell(s0 + 0.02 + i * 0.03, midi(m), 0.07 - 0.006 * i, { dur: 3.0, pan: (i % 2 ? 1 : -1) * 0.5 }));
    padLayer(s0, h, () => ({ g: 0.7, a: 0.4, r: 0.6, c0: 3500, c1: 1500, g1: 0.8 }));
    subLayer(s0, h, () => ({ g: 0.34, a: 0.05, r: 0.3 }));
    // montage: rising loops of A-major bells that transpose upward as the light streaks spiral in
    const run = (t0, t1, oct0, oct1, g0, g1) => grid(t0, t1, 0.125, (t, i) => { const x = (t - t0) / (t1 - t0); const s = segAt(t); bell(t, midi(s.c.arp[PAT[i % 16] % 6] + oct0 + (oct1 - oct0) * Math.floor(x * 3) / 2), g0 + (g1 - g0) * x, { dur: 1.0, pan: 0.7 * Math.sin(i * 1.3) }); });
    run(S(7, 0.6), S(7, 2.0), 0, 12, 0.08, 0.12);
    // 0.0625 (32nd) run
    const i0 = Math.ceil(S(7, 2.0) / 0.0625); grid(S(7, 2.0), h - 0.12, 0.0625, (t, ig) => { const i = ig - i0; const s = segAt(t); bell(t, midi(s.c.arp[i % 6] + 12 + 12 * Math.floor(i / 12)), 0.07 + 0.005 * i, { dur: 0.7, ratio: 2, pan: 0.8 * Math.sin(i * 1.9) }); });
    // light streaks: rising whooshes, accelerating, panned in a spiral
    [0.5, 1.15, 1.7, 2.1, 2.45, 2.7, 2.83].forEach((tt, i) => { const t = S(7, tt); whoosh(t, Math.min(t + 0.5, h - 0.12), Math.min(t + 0.4, h - 0.13), { f0: 500 + 100 * i, f1: 6500, g: 0.07 + 0.011 * i, pan0: i % 2 ? 0.8 : -0.8, pan1: i % 2 ? -0.8 : 0.8, q: 1.3 }); });
    // spiral-inward: sines glide to D6 (the ignition tone) with accelerating auto-pan
    const t0c = S(7, 0.5), t1c = h - 0.12, D6 = 1174.66;
    defer(t0c, () => [0.5, 1, 1, 2, 0.25, 4].forEach((mul, i) => {
      const f0 = D6 * mul * (i % 2 ? 0.5 : 2.4) * 0.7, eg = mk(0); eg.gain.setValueAtTime(0.0001, t0c); eg.gain.exponentialRampToValueAtTime(0.028, t1c - 0.02); eg.gain.linearRampToValueAtTime(0, t1c);
      const o1 = ctx.createOscillator(); o1.frequency.setValueAtTime(clamp(f0, 80, 6000), t0c); o1.frequency.exponentialRampToValueAtTime(clamp(D6 * mul, 80, 6000), t1c); o1.start(t0c); o1.stop(t1c + 0.05);
      const p = ctx.createStereoPanner(), N = Math.round((t1c - t0c) * 100), cv = new Float32Array(N); let ph = 0;
      for (let k = 0; k < N; k++) { const x = k / N; ph += (0.6 + 7 * x * x) / 100; cv[k] = 0.9 * Math.sin(2 * Math.PI * ph + i); }
      p.pan.setValueCurveAtTime(cv, t0c, t1c - t0c); o1.connect(eg); eg.connect(p); fxBus.add(p, t0c, t1c + 0.05);
    }));
    riser(S(7, 0.3), h - 0.12, 0.55, { f0: 500, f1: 9000, p0: 300, p1: 1200 });
    clapRoll(S(7, 1.0), h - 0.12, 0.5, 0.8, 0.06, 0.24);
    kick(S(7, 2.0), 0.4, { dk: null }); kick(S(7, 2.5), 0.45, { dk: null });

    // HERO 73: anthem
    impact(h, 1.45, { bright: 1.25, subF: 115, tail: 3.2 }); kick(h, 1.15); taiko(h + 0.003, 0.6);
    sineTone(h, 1174.66, 0.11, 4.0, 0.02, 1.2);    // the ignition tone returns, now inside the light
    [74, 81, 86, 89, 93, 98, 105].forEach((m, i) => bell(h + 0.02 + i * 0.05, midi(m), 0.1, { dur: 3.5, pan: (i % 2 ? 1 : -1) * 0.65 }));
    const R = S(7, 12.0); // 79 -> 80 dominant, resolution begins at 80
    const anthemEnd = S(7, 10.0);
    subLayer(h, 84, (a) => ({ g: a < anthemEnd ? 0.62 : 0.42, a: 0.05, r: 0.7 }));
    padLayer(h, 84, (a) => {
      if (isHeroT(a)) return { g: 1.15, a: 0.05, c0: 4500, c1: 2600, g1: 0.9, r: 2.0 };
      if (a >= anthemEnd) return { g: a < 82 - 1e-6 ? 0.85 : 0.75, a: 0.9, r: 2.5, c0: 1500, c1: 4200, g1: 0.75, det: [-14, -5, 5, 14], type: 'sawtooth' };
      return { g: 0.85, a: 0.4, r: 1.6, c0: 1800, c1: 3400, g1: 0.85 };
    });
    choirLayer(h, 84, (a, b) => ({ g: a < anthemEnd ? 0.8 : 0.5, a: a < anthemEnd ? 0.3 : 1.5, r: 3.2, vowel: 'ah', g1: a < anthemEnd ? 0.8 : 0.4 }));
    // drums + bass for the anthem 73 -> 79.5
    const dEnd = S(7, 9.5);
    kick4(h + 0.5, dEnd, 1.1, { dk: [0.8, 0.6, 0.3] }); clap24(h + 0.5, dEnd, 0.55); hats16(h + 0.5, dEnd, () => 0.12);
    grid(h, dEnd, 1.0, (t) => taiko(t + 0.5, 0.35));
    bassPulse(h, dEnd, () => 0.6);
    arpLayer(h, dEnd, () => 0.14, { dur: 1.2 });
    arpLayer(h, dEnd, () => 0.06, { step: 0.25, dur: 1.0, oct: 12, pat: [3, 4, 5, 4, 3, 5, 4, 2] });
    // THEME (D minor): [absolute time, midi, beats]
    const theme = [
      [73.0, 81, 2], [74.0, 79, 1.5], [74.75, 77, 0.5], [75.0, 74, 2],
      [76.0, 72, 1], [76.5, 77, 1], [77.0, 81, 1], [77.5, 84, 1],
      [78.0, 76, 1], [78.5, 79, 1], [79.0, 85, 2],
    ];
    theme.forEach(([t, m, b]) => { lead(t, b * BEAT, m, 0.26, { pan: 0.1 }); bell(t, midi(m + 12), 0.07, { dur: 2.4, ratio: 2, pan: -0.2 }); });
    // 79.9 -> 80: dominant swell; 80 luminous D major
    revCymbal(S(7, 8.4), R - 0.0, 0.11);
    // RESOLUTION 80 ->: serene D major shimmer + sparse bell melody (D6 = the ignition note)
    impact(R, 0.55, { bright: 0.6, sub: 0.8, tail: 3.0 }); kick(R, 0.6, { dk: null, f0: 120 });
    lead(R, 3.6 * BEAT * 2.2, 86, 0.15, { pan: 0.0, cut: 2600 });
    [[80.0, 86], [80.5, 90], [81.0, 81], [81.5, 88], [82.0, 86], [82.5, 93], [83.0, 81]].forEach(([t, m], i) => bell(t, midi(m), 0.075 - 0.004 * i, { dur: 4.5, ratio: 2, pan: (i % 2 ? 0.5 : -0.5) }));
    arpLayer(R + 0.25, 82.3, curve([[80, 0.05], [82.3, 0.03]]), { step: 0.25, dur: 2.0, ratio: 2, pat: [0, 2, 4, 5, 4, 2, 3, 1] });
    dust(R, 83, () => 7, 62, 'chord', () => 0.035, { lo: 0, hi: 1 });
  }

  // ------------------------------------------------------------ finalise automation
  prog(0.15, 'automation');
  // sidechain pump
  duckEv.sort((a, b) => a.t - b.t);
  const ev = [];
  for (const e of duckEv) { const l = ev[ev.length - 1]; if (l && e.t - l.t < 0.06) { l.b = Math.max(l.b, e.b); l.p = Math.max(l.p, e.p); l.a = Math.max(l.a, e.a); } else ev.push({ ...e }); }
  [[duckBass, 'b'], [duckPad, 'p'], [duckArp, 'a']].forEach(([node, k]) => {
    const p = node.gain; p.setValueAtTime(1, 0);
    ev.forEach((e, i) => {
      const nxt = ev[i + 1], rel = Math.min(0.32, (nxt ? nxt.t - e.t : 1) * 0.9), tt = e.t;
      p.setValueAtTime(1, Math.max(0.0005, tt - 0.001)); p.linearRampToValueAtTime(1 - e[k], tt + 0.004); p.linearRampToValueAtTime(1, tt + rel);
    });
  });
  // hero gaps: master duck (silence) 0.12 s before + breakdown dip of the music buses before each hero/climax
  const gaps = [
    { t: heroes[0], dip: 0.6 }, { t: heroes[1], dip: 0.55 }, { t: TL.scenes[2].start, dip: 1, only: 'duck' }, { t: heroes[2], dip: 0.5 },
    { t: S(2, TL.scenes[2].anchors.climax), dip: 0.6 }, { t: heroes[3], dip: 0.65 }, { t: heroes[4], dip: 0.5 }, { t: heroes[5], dip: 0.38 },
    { t: heroes[6], dip: 1, only: 'duck' }, { t: TL.scenes[7].start, dip: 1, only: 'duck' }, { t: heroes[7], dip: 0.5 },
  ].sort((a, b) => a.t - b.t);
  masterDuck.gain.setValueAtTime(1, 0); dip.gain.setValueAtTime(1, 0);
  for (const g of gaps) {
    const h = g.t, gap = 0.12;
    masterDuck.gain.setValueAtTime(1, h - gap - 0.003); masterDuck.gain.linearRampToValueAtTime(0.0, h - gap + 0.006);
    masterDuck.gain.setValueAtTime(0.0, h - 0.003); masterDuck.gain.linearRampToValueAtTime(1, h);
    if (g.dip < 1) {
      dip.gain.setValueAtTime(1, h - 1.5); dip.gain.linearRampToValueAtTime(g.dip, h - 1.1); dip.gain.setValueAtTime(g.dip, h - 0.02); dip.gain.setValueAtTime(1, h);
    }
  }
  // chapter trim (dB), smooth boundaries
  trim.gain.setValueAtTime(dbToLin(TRIM_PTS[0][1]), 0);
  for (let k = 1; k < TRIM_PTS.length; k++) {   // sample the dB curve at 10 Hz so the ramp is exponential-ish (linear in dB)
    const [ta, da] = TRIM_PTS[k - 1], [tb, db2] = TRIM_PTS[k], nSeg = Math.max(1, Math.round((tb - ta) * 10));
    for (let j = 1; j <= nSeg; j++) trim.gain.linearRampToValueAtTime(dbToLin(da + ((db2 - da) * j) / nSeg), ta + ((tb - ta) * j) / nSeg);
  }
  // fade to silence with the film's fade-out (log-linear: -60 dB over 1 s), true zero afterwards
  const fo = TOTAL - TL.FADE_OUT;  // 82.4
  fadeG.gain.setValueAtTime(1, fo); fadeG.gain.exponentialRampToValueAtTime(0.001, fo + 1.0); fadeG.gain.setValueAtTime(0, fo + 1.05);

  prog(0.2, 'rendering');
  Q.sort((a, b) => a.t - b.t || a.i - b.i);
  const W = 1.0, q = (x) => Math.ceil((x * SR) / 128) * 128 / SR, B = (k) => q(k * W - 0.03);
  let qi = 0; const flush = (upTo) => { while (qi < Q.length && Q[qi].t < upTo) Q[qi++].fn(); };
  const waits = []; for (let k = 1; k * W < TOTAL - 0.05; k++) waits.push(ctx.suspend(B(k)));
  flush(B(1));
  const rendering = ctx.startRendering();
  for (let k = 1; k <= waits.length; k++) { await waits[k - 1]; flush(B(k + 1)); ctx.resume(); if (k % 10 === 0) prog(0.2 + 0.7 * k / waits.length, 'rendering'); }
  const stems = await rendering;
  prog(0.9, 'reverb + mastering');
  const n = stems.length, st = (k) => stems.getChannelData(k);

  // ------------------------------------------------------------ deterministic JS mix-down: ping-pong -> reverbs -> master gain -> compressor
  const [ppL, ppR] = pingPong(st(6), SR, BEAT * 0.75, 0.42, 3400, 0.7);
  const dryL = st(0), dryR = st(1), lgL = st(2), lgR = st(3), shL = st(4), shR = st(5), env = st(7);
  for (let i = 0; i < n; i++) { dryL[i] += ppL[i]; dryR[i] += ppR[i]; lgL[i] += ppL[i]; lgR[i] += ppR[i]; }
  const hpc = biquadCoef('hp', 180, 1, SR); biquadRun(lgL, hpc); biquadRun(lgR, hpc);   // reverb-send high-pass (keeps the tail out of the mud)
  const [wlL, wlR] = convolveStereo(lgL, lgR, IR_LONG.L, IR_LONG.R, 8192, IR_LONG.scale * 0.85);
  prog(0.93, 'reverb');
  const [wsL, wsR] = convolveStereo(shL, shR, IR_SHORT.L, IR_SHORT.R, 4096, IR_SHORT.scale * 0.55);
  const L = new Float32Array(n), Rr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const g = env[i]; L[i] = (dryL[i] + wlL[i] + wsL[i]) * g; Rr[i] = (dryR[i] + wlR[i] + wsR[i]) * g; }
  compressor(L, Rr, SR);

  // ------------------------------------------------------------ mastering in JS (deterministic): DC block, loudness trim, true-peak look-ahead limiter
  for (const d of [L, Rr]) { let x1 = 0, y1 = 0; const R0 = 1 - 2 * Math.PI * 18 / SR; for (let i = 0; i < n; i++) { let x = d[i]; if (!Number.isFinite(x)) x = 0; const y = x - x1 + R0 * y1; x1 = x; y1 = y; d[i] = y; } }
  // trim so that whole-file mono RMS (excluding the silent tail) sits near the target before limiting
  let acc = 0; const nn = Math.round((TOTAL - 1.6) * SR); for (let i = 0; i < nn; i++) { const m = 0.5 * (L[i] + Rr[i]); acc += m * m; }
  const rms0 = Math.sqrt(acc / nn), TARGET = dbToLin(MASTER_RMS_DB), gain = TARGET / Math.max(rms0, 1e-6);
  const thr = dbToLin(CEILING_DB), la = Math.round(0.0045 * SR), relC = 1 - Math.exp(-1 / (0.16 * SR));
  const hw = [...heroes, TL.scenes[2].start + TL.scenes[2].anchors.climax].map((h) => [Math.round((h - 0.05) * SR), Math.round((h + 0.6) * SR), 1, 1]);   // [i0, i1, min limiter gain, min clip gain]
  // 1) linked soft clipper: shaves only the 2-5 ms tops of kick / hero transients (tanh knee), so the look-ahead limiter below hardly ever has to
  //    pull the whole mix down (which is what dulled the hero hits). Same gain on both channels = the stereo image is untouched.
  for (let i = 0; i < n; i++) {
    L[i] *= gain; Rr[i] *= gain;
    const pk = Math.max(Math.abs(L[i]), Math.abs(Rr[i]));
    if (pk > CLIP_KNEE) {
      const f = (CLIP_KNEE + CLIP_W * Math.tanh((pk - CLIP_KNEE) / CLIP_W)) / pk; L[i] *= f; Rr[i] *= f;
      for (const w of hw) if (i >= w[0] && i < w[1] && f < w[3]) w[3] = f;
    }
  }
  // 2) true-peak look-ahead limiter (4x oversampled detector)
  const tp = truePeak(L, Rr, 1, thr * 0.3), g = new Float32Array(n);
  for (let i = 0; i < n; i++) { const pk = tp[i]; g[i] = pk > thr ? thr / pk : 1; }
  const step = 1 / la;
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] + step * 1.5 * (1 - g[i + 1]));   // exponential look-ahead attack (~3 ms)
  let r = 1;
  for (let i = 0; i < n; i++) {
    r = Math.min(g[i], r + (1 - r) * relC); L[i] *= r; Rr[i] *= r;
    for (const w of hw) if (i >= w[0] && i < w[1] && r < w[2]) w[2] = r;
  }
  for (let i = 0; i < n; i++) { if (L[i] > thr) L[i] = thr; else if (L[i] < -thr) L[i] = -thr; if (Rr[i] > thr) Rr[i] = thr; else if (Rr[i] < -thr) Rr[i] = -thr; }
  let minR = 1; for (let i = 0; i < n; i += 64) if (g[i] < minR) minR = g[i];
  const out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR }); out.copyToChannel(L, 0); out.copyToChannel(Rr, 1);
  out.scoreStats = { rms0Db: 20 * Math.log10(rms0), trimDb: 20 * Math.log10(gain), minLimiterGainDb: 20 * Math.log10(minR), heroLimiterDb: hw.map((w) => +(20 * Math.log10(w[2])).toFixed(1)), heroClipDb: hw.map((w) => +(20 * Math.log10(w[3])).toFixed(1)), laneOverflow: [bassBus, padBus, padRawBus, arpBus, drumBus, fxBus].map((b) => b.overflow) };
  prog(1, 'done');
  return out;
}
