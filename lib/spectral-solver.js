// lib/spectral-solver.js
/**
 * Spectral Solver – 3×4 Mixing Matrix
 *
 * Solves A x ≈ y with x ≥ 0, where:
 *   - A: 3×4 matrix (bands rows: [Blue, Green, Red]; channels cols: [BlueCh, RedCh, WW, CW])
 *   - x: channel PPFD contributions [bl, rd, ww, cw] in µmol·m⁻²·s⁻¹ (NOT %)
 *   - y: target band PPFDs [B, G, R] in µmol·m⁻²·s⁻¹, s.t. sum(y)=targetPPFD
 *
 * Design choice: WW+CW must provide the GREEN target (after accounting for green "tails" from BL/RD),
 * while BL/RD fill Blue and Red. We iterate to convergence.
 */

// Default mixing matrix from your note (columns each ~1.0)
export const MIXING_MATRIX = [
  [0.98, 0.00, 0.17, 0.27], // Blue band    ← [BlueCh, RedCh, WW, CW]
  [0.02, 0.02, 0.45, 0.55], // Green band
  [0.00, 0.98, 0.38, 0.18], // Red band
];

export const CHANNELS = ['bl', 'rd', 'ww', 'cw'];
export const BANDS = ['blue', 'green', 'red'];

/** Normalize a recipe {blue, green, red} (percent) to band PPFDs that sum to targetPPFD */
function normalizeTarget(target, targetPPFD, minGreenFrac = null) {
  const b = Number(target.blue || 0);
  const g = Number(target.green || 0);
  const r = Number(target.red || 0);
  const s = b + g + r;
  if (s <= 0) return [0, 0, 0];
  let yB = b / s, yG = g / s, yR = r / s;

  // Optional minimum green fraction (e.g., 0.05 for 5%)
  if (minGreenFrac != null && yG < minGreenFrac) {
    const remain = Math.max(1 - minGreenFrac, 1e-9);
    const scaleBR = remain / (yB + yR);
    yG = minGreenFrac;
    yB *= scaleBR;
    yR *= scaleBR;
  }

  return [yB * targetPPFD, yG * targetPPFD, yR * targetPPFD];
}

/** Dot helpers */
const dot4 = (a,b,c,d, x,y,z,w) => a*x + b*y + c*z + d*w;
const clamp0 = v => (v < 0 ? 0 : v);

/** Solve the 2×2 for Blue/Red given residuals and A */
function solveBR(A, resB, resR) {
  const a = A[0][0], b = A[0][1]; // Blue row, (BlueCh, RedCh)
  const c = A[2][0], d = A[2][1]; // Red  row, (BlueCh, RedCh)
  const det = a*d - b*c;
  if (Math.abs(det) < 1e-9) {
    // Diagonal-ish default case: a≈0.98, d≈0.98, b≈c≈0
    return [clamp0(resB / Math.max(a,1e-9)), clamp0(resR / Math.max(d,1e-9))];
  }
  const bl = ( d*resB - b*resR) / det;
  const rd = (-c*resB + a*resR) / det;
  return [clamp0(bl), clamp0(rd)];
}

/**
 * Enumerative NNLS fallback: minimize ||A x - y|| with x ≥ 0 (no green-only constraint).
 * Small problem (4 vars), so we enumerate active sets.
 */
function nnlsEnumerate(A, y) {
  const cols = [0,1,2,3];
  let best = { x:[0,0,0,0], err: Infinity };
  // Enumerate non-empty active sets
  for (let mask = 1; mask < (1<<4); mask++) {
    const S = cols.filter(i => (mask & (1<<i)) !== 0);
    // Build A_S (3×|S|)
    const AS = A.map(row => S.map(i => row[i]));
    // Solve least squares AS*xs ≈ y
    const xs = ls(AS, y);
    if (!xs) continue;
    if (xs.some(v => v < -1e-9)) continue; // must be non-negative
    const x = [0,0,0,0];
    S.forEach((i,k) => x[i] = Math.max(0, xs[k]));
    const err = l2err(A, x, y);
    if (err < best.err) best = { x, err };
  }
  return best;
}

/** Least squares via normal equations (AS small). Returns xs or null. */
function ls(AS, y) {
  // AS: m×n with m=3, n≤4. Compute (AS^T AS) xs = AS^T y
  const m = AS.length, n = AS[0].length;
  const AT = Array.from({length:n}, (_,i)=> AS.map(row => row[i]));
  const ATA = Array.from({length:n}, ()=> Array(n).fill(0));
  const ATy = Array(n).fill(0);
  for (let i=0;i<n;i++) {
    for (let j=0;j<n;j++) {
      let s = 0; for (let k=0;k<m;k++) s += AT[i][k] * AS[k][j];
      ATA[i][j] = s;
    }
    let sy = 0; for (let k=0;k<m;k++) sy += AT[i][k] * y[k];
    ATy[i] = sy;
  }
  const xs = solveSymPosDef(ATA, ATy); // small system
  return xs;
}

/** Solve symmetric positive-definite system via naive Gaussian elim with pivot (n ≤ 4). */
function solveSymPosDef(A, b) {
  const n = A.length;
  // Augment
  const M = A.map((row,i)=> row.concat([b[i]]));
  // Gaussian elimination with partial pivoting
  for (let k=0;k<n;k++) {
    // pivot
    let piv = k;
    for (let i=k+1;i<n;i++) if (Math.abs(M[i][k]) > Math.abs(M[piv][k])) piv = i;
    if (Math.abs(M[piv][k]) < 1e-12) return null;
    if (piv !== k) [M[k],M[piv]] = [M[piv],M[k]];
    // eliminate
    for (let i=k+1;i<n;i++) {
      const f = M[i][k]/M[k][k];
      for (let j=k;j<=n;j++) M[i][j] -= f*M[k][j];
    }
  }
  // back-substitute
  const x = Array(n).fill(0);
  for (let i=n-1;i>=0;i--) {
    let s = M[i][n];
    for (let j=i+1;j<n;j++) s -= M[i][j]*x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function l2err(A, x, y) {
  const r0 = dot4(A[0][0],A[0][1],A[0][2],A[0][3], x[0],x[1],x[2],x[3]) - y[0];
  const r1 = dot4(A[1][0],A[1][1],A[1][2],A[1][3], x[0],x[1],x[2],x[3]) - y[1];
  const r2 = dot4(A[2][0],A[2][1],A[2][2],A[2][3], x[0],x[1],x[2],x[3]) - y[2];
  return Math.sqrt(r0*r0 + r1*r1 + r2*r2);
}

/**
 * Main solver.
 * @param {Object} target {blue, green, red} percentages (sum can be != 100; we normalize)
 * @param {number} targetPPFD µmol·m⁻²·s⁻¹
 * @param {Object} opts
 *  - mixingMatrix: 3×4 matrix (default MIXING_MATRIX)
 *  - minGreenFrac: number|null  e.g. 0.05 to enforce ≥5% green
 *  - splitMode: 'equal' | 'proportional'  (how WW/CW share green)
 *  - capacities: {bl, rd, ww, cw} max PPFD per channel (optional; to clamp & report saturation)
 *  - tol: convergence tolerance (default 1e-6)
 *  - maxIter: (default 12)
 * @returns {Object} {bl, rd, ww, cw, achieved:{blue,green,red,ppfd}, err, feasible, saturated:{...}}
 */
export function solveSpectrum(target, targetPPFD=100, opts={}) {
  const A = opts.mixingMatrix || MIXING_MATRIX;
  const tol = opts.tol ?? 1e-6;
  const maxIter = opts.maxIter ?? 12;
  const splitMode = opts.splitMode || 'equal'; // how to split green between WW and CW
  const capacities = opts.capacities || null;

  // Target band PPFDs
  const y = normalizeTarget(target, targetPPFD, opts.minGreenFrac ?? null);
  const [yB, yG, yR] = y;

  // Iterate WW/CW ↔ BL/RD until convergence
  let ww = 0, cw = 0, bl = 0, rd = 0;

  for (let it=0; it<maxIter; it++) {
    // Green already provided by blue/red tails
    const gFromBR = A[1][0]*bl + A[1][1]*rd;
    const greenNeeded = Math.max(0, yG - gFromBR);

    // Set WW/CW to deliver greenNeeded
    if (splitMode === 'equal') {
      ww = (0.5 * greenNeeded) / Math.max(A[1][2], 1e-9);
      cw = (0.5 * greenNeeded) / Math.max(A[1][3], 1e-9);
    } else { // 'proportional' to green capability
      const cww = A[1][2], ccw = A[1][3];
      const denom = (cww*cww/Math.max(ccw,1e-9)) + ccw;
      const beta  = greenNeeded / Math.max(denom, 1e-9);   // CW scale
      const alpha = (cww/Math.max(ccw,1e-9)) * beta;       // WW scale
      ww = alpha; cw = beta;
    }

    // Residual B/R after whites
    const bRes = Math.max(0, yB - (A[0][2]*ww + A[0][3]*cw));
    const rRes = Math.max(0, yR - (A[2][2]*ww + A[2][3]*cw));

    const [blNew, rdNew] = solveBR(A, bRes, rRes);

    const delta = Math.max(
      Math.abs(blNew - bl),
      Math.abs(rdNew - rd)
    );
    bl = blNew; rd = rdNew;

    if (delta < tol) break;
  }

  // Optional per-channel capacity clamp (report saturation)
  const saturated = { bl:false, rd:false, ww:false, cw:false };
  if (capacities) {
    for (const k of CHANNELS) {
      const cap = capacities[k];
      if (cap != null && cap > 0) {
        if (k==='bl' && bl > cap) { bl = cap; saturated.bl = true; }
        if (k==='rd' && rd > cap) { rd = cap; saturated.rd = true; }
        if (k==='ww' && ww > cap) { ww = cap; saturated.ww = true; }
        if (k==='cw' && cw > cap) { cw = cap; saturated.cw = true; }
      }
    }
  }

  // Achieved spectrum
  const B = dot4(A[0][0],A[0][1],A[0][2],A[0][3], bl,rd,ww,cw);
  const G = dot4(A[1][0],A[1][1],A[1][2],A[1][3], bl,rd,ww,cw);
  const R = dot4(A[2][0],A[2][1],A[2][2],A[2][3], bl,rd,ww,cw);
  const ppfd = B + G + R;
  const sum = Math.max(ppfd, 1e-12);

  const achieved = {
    blue:  100 * (B / sum),
    green: 100 * (G / sum),
    red:   100 * (R / sum),
    ppfd
  };

  // Spectral error (Euclidean distance in fraction space)
  const err = Math.hypot(
    (B/sum) - (yB/targetPPFD),
    (G/sum) - (yG/targetPPFD),
    (R/sum) - (yR/targetPPFD)
  );

  // If anything went negative or NaN, fall back to NNLS (rare with sane inputs)
  const bad = [bl,rd,ww,cw].some(v => !Number.isFinite(v) || v < -1e-9);
  let feasible = !bad;

  if (!feasible) {
    const { x, err: e2 } = nnlsEnumerate(A, y);
    [bl, rd, ww, cw] = x;
    const B2 = dot4(A[0][0],A[0][1],A[0][2],A[0][3], bl,rd,ww,cw);
    const G2 = dot4(A[1][0],A[1][1],A[1][2],A[1][3], bl,rd,ww,cw);
    const R2 = dot4(A[2][0],A[2][1],A[2][2],A[2][3], bl,rd,ww,cw);
    const s2 = Math.max(B2+G2+R2, 1e-12);
    achieved.blue  = 100*(B2/s2);
    achieved.green = 100*(G2/s2);
    achieved.red   = 100*(R2/s2);
    achieved.ppfd  = s2;
    feasible = true; // NNLS gave a nonnegative solution
  }

  return {
    bl: +bl.toFixed(3),
    rd: +rd.toFixed(3),
    ww: +ww.toFixed(3),
    cw: +cw.toFixed(3),
    achieved: {
      blue:  +achieved.blue.toFixed(3),
      green: +achieved.green.toFixed(3),
      red:   +achieved.red.toFixed(3),
      ppfd:  +achieved.ppfd.toFixed(3)
    },
    err: +err.toExponential(3),
    feasible,
    saturated
  };
}

/** Convert channel PPFD (µmol) to PWM % using per‑channel capacities (µmol at 100%) */
export function toPWM(channelsPPFD, capacities) {
  const out = {};
  for (const k of CHANNELS) {
    const cap = capacities?.[k];
    const val = channelsPPFD[k] ?? 0;
    out[k] = cap && cap > 0 ? Math.max(0, Math.min(100, 100 * (val / cap))) : 0;
  }
  return out;
}

/** Convenience: compute achieved spectrum (%) for arbitrary channel PPFD inputs */
export function calculateAchievedSpectrum(channelsPPFD, mixingMatrix=MIXING_MATRIX) {
  const [bl, rd, ww, cw] = [channelsPPFD.bl||0, channelsPPFD.rd||0, channelsPPFD.ww||0, channelsPPFD.cw||0];
  const B = dot4(mixingMatrix[0][0],mixingMatrix[0][1],mixingMatrix[0][2],mixingMatrix[0][3], bl,rd,ww,cw);
  const G = dot4(mixingMatrix[1][0],mixingMatrix[1][1],mixingMatrix[1][2],mixingMatrix[1][3], bl,rd,ww,cw);
  const R = dot4(mixingMatrix[2][0],mixingMatrix[2][1],mixingMatrix[2][2],mixingMatrix[2][3], bl,rd,ww,cw);
  const sum = Math.max(B+G+R, 1e-12);
  return {
    blue:  +(100*B/sum).toFixed(3),
    green: +(100*G/sum).toFixed(3),
    red:   +(100*R/sum).toFixed(3),
    ppfd:  +sum.toFixed(3)
  };
}

export default {
  solveSpectrum,
  calculateAchievedSpectrum,
  toPWM,
  MIXING_MATRIX,
  CHANNELS,
  BANDS
};
