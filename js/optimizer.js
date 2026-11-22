/*
 * optimizer.js — finds rubber-band post locations on the 0.5" VEX grid.
 *
 * Search space (per un-locked band group):
 *   - every post: which link it is on + (a, b) local coordinates, both
 *     integer multiples of 0.5"
 *   - wraps n (1..maxWraps)
 *   - band count m per side (solved for directly — torque is linear in m)
 *
 * Method: iterated local search with random restarts. Each climb moves one
 * post by one hole (±0.5" along/perpendicular), hops a post onto another
 * link at the same physical spot, or changes the wrap count; after converging,
 * random "kicks" try to escape the local optimum. Exhaustive search is
 * infeasible (~10^7–10^9 combos), but this reliably lands on the same best
 * designs from many seeds.
 *
 * Cost (normalized by RMS of the gravity torque so it's unitless):
 *   e(θ)  = τ_gravity,design(θ) + τ_bands(θ) − bias·τ_gravity,design(θ)
 *   cost  = RMS(e) | max|e| | ½(RMS+max)   + penalties + tiny tie-breakers
 * Penalties: stretch above λmax, stretch below λmin (band would go slack /
 * fall off), posts closer than the minimum separation.
 */
(function (root) {
  'use strict';
  const LP = root.LiftPhysics;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createContext(model, groups, band, opts) {
    opts = opts || {};
    const K = opts.K || 48;
    const obj = opts.objective || 'balanced';
    const maxTotalBands = Math.max(1, parseInt(opts.maxBands) || 10);
    const maxW = Math.max(1, Math.min(3, parseInt(opts.maxWraps) || 2));
    const avoidCross = opts.avoidCross !== false;
    const designFrac = opts.designFrac !== undefined ? opts.designFrac : 0.5;
    const bias = Number.isFinite(opts.bias) ? opts.bias : 0.0;

    const cfg = model.cfg;
    const thetas = LP.linspace(cfg.thetaMin * LP.DEG, cfg.thetaMax * LP.DEG, K);
    const NL = model.links.length;
    // flat frames: [k][link] -> 9 numbers
    const FR = new Float64Array(K * NL * 9);
    const tg = new Float64Array(K);
    const SEGS = []; // per k: flat [li, x0, y0, x1, y1, ...]
    thetas.forEach((th, k) => {
      const F = LP.framesAt(model, th);
      F.forEach((f, li) => {
        const o = (k * NL + li) * 9;
        FR[o] = f.ox; FR[o + 1] = f.oy; FR[o + 2] = f.dox; FR[o + 3] = f.doy;
        FR[o + 4] = f.xx; FR[o + 5] = f.xy; FR[o + 6] = f.yx; FR[o + 7] = f.yy; FR[o + 8] = f.rot;
      });
      const g = LP.gravityTorque(model, F);
      tg[k] = g.struct + designFrac * g.payload;
      const flat = [];
      for (const s of LP.linkSegments(model, F)) flat.push(s.li, s.x0, s.y0, s.x1, s.y1, Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1);
      SEGS.push(Float64Array.from(flat));
    });
    const midF = LP.framesAt(model, 0.5 * (thetas[0] + thetas[K - 1]));
    let S = 0;
    for (let k = 0; k < K; k++) S += tg[k] * tg[k];
    S = Math.sqrt(S / K) || 1;

    // Angle weighting based on optimization objective
    const angleWeights = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const alpha = k / (K - 1 || 1); // 0 at bottom/pickup (thetaMin), 1 at scoring/top (thetaMax)
      if (obj === 'bottom') {
        // Quadradic emphasis on lower 40% of stroke (pickup)
        angleWeights[k] = 1.0 + 3.0 * (1 - alpha) * (1 - alpha);
      } else if (obj === 'top') {
        // Quadradic emphasis on upper 40% of stroke (scoring)
        angleWeights[k] = 1.0 + 3.0 * alpha * alpha;
      } else {
        // Balanced: uniform weighting across full stroke
        angleWeights[k] = 1.0;
      }
    }
    let sumW = 0;
    for (let k = 0; k < K; k++) sumW += angleWeights[k];

    const T = LP.makeTension(band);
    const sides = cfg.mass.sides;
    const wrap = Math.PI * (band.postD || 0.25);
    const G = LP.GRID;

    // grid ranges (integer half-inch indices) per link
    const ranges = model.links.map((l) => {
      const r = LP.linkRange(l, opts);
      return {
        aMin: Math.ceil(r.aMin / G - 1e-9), aMax: Math.floor(r.aMax / G + 1e-9),
        bMin: Math.ceil(r.bMin / G - 1e-9), bMax: Math.floor(r.bMax / G + 1e-9),
      };
    });

    const px = new Float64Array(3), py = new Float64Array(3), pdx = new Float64Array(3), pdy = new Float64Array(3);

    /** per-band torque vector + penalties for a group geometry */
    function groupVec(type, pts, n, outVec) {
      const np = type === 'line' ? 2 : 3;
      const mult = type === 'line' ? 2 : 1;
      let over = 0, under = 0, sepV = 0, lamMax = 0, lamMin = Infinity, crossN = 0;
      if (n > maxW) over += 20.0 * (n - maxW);

      for (let k = 0; k < K; k++) {
        for (let i = 0; i < np; i++) {
          const p = pts[i];
          const o = (k * NL + p.li) * 9;
          const a = p.ia * G, b = p.ib * G;
          const xx = FR[o + 4], xy = FR[o + 5], yx = FR[o + 6], yy = FR[o + 7];
          px[i] = FR[o] + a * xx + b * yx;
          py[i] = FR[o + 1] + a * xy + b * yy;
          if (FR[o + 8]) {
            pdx[i] = FR[o + 2] + a * yx - b * xx;
            pdy[i] = FR[o + 3] + a * yy - b * xy;
          } else { pdx[i] = FR[o + 2]; pdy[i] = FR[o + 3]; }
        }
        let P = 0, dP = 0, ms = Infinity;
        const ne = np === 2 ? 1 : 3;
        for (let e = 0; e < ne; e++) {
          const i = e, j = (e + 1) % np;
          const ex = px[i] - px[j], ey = py[i] - py[j];
          const d = Math.sqrt(ex * ex + ey * ey);
          if (d < ms) ms = d;
          P += d;
          if (d > 1e-9) dP += (ex * (pdx[i] - pdx[j]) + ey * (pdy[i] - pdy[j])) / d;
        }
        P *= mult; dP *= mult;
        if (avoidCross) {
          const sg = SEGS[k];
          let hit = false;
          for (let e = 0; e < ne && !hit; e++) {
            const i = e, j = (e + 1) % np;
            const li = pts[i].li, lj = pts[j].li;
            const ax = px[i], ay = py[i], rx = px[j] - ax, ry = py[j] - ay;
            const lr = Math.sqrt(rx * rx + ry * ry) || 1;
            const exMinX = Math.min(ax, px[j]), exMaxX = Math.max(ax, px[j]);
            const exMinY = Math.min(ay, py[j]), exMaxY = Math.max(ay, py[j]);
            for (let q = 0; q < sg.length; q += 6) {
              if (sg[q] === li || sg[q] === lj) continue;
              const cx = sg[q + 1], cy = sg[q + 2], dx2 = sg[q + 3], dy2 = sg[q + 4];
              if (Math.max(cx, dx2) < exMinX || Math.min(cx, dx2) > exMaxX ||
                  Math.max(cy, dy2) < exMinY || Math.min(cy, dy2) > exMaxY) continue;
              const sx = dx2 - cx, sy = dy2 - cy;
              const den = rx * sy - ry * sx;
              if (den > -1e-12 && den < 1e-12) continue;
              const qx = cx - ax, qy = cy - ay;
              const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
              const et = 0.15 / lr, eu = 0.15 / sg[q + 5];
              if (t > et && t < 1 - et && u > eu && u < 1 - eu) { hit = true; break; }
            }
          }
          if (hit) crossN++;
        }
        const lam = (n * (P + wrap)) / band.C0;
        if (lam > lamMax) lamMax = lam;
        if (lam < lamMin) lamMin = lam;
        if (lam > opts.lamMax) over = Math.max(over, lam - opts.lamMax);
        if (opts.requireTension && lam < opts.lamMin) under = Math.max(under, opts.lamMin - lam);
        if (ms < opts.minSep) sepV = Math.max(sepV, opts.minSep - ms);
        outVec[k] = sides * n * T(lam) * dP;
      }
      const crossPen = avoidCross && crossN > 0 ? 30.0 * (crossN / K) : 0;
      return { pen: 2 * over + 2 * under + 2 * sepV + crossPen, lamMax, lamMin, crossFrac: crossN / K };
    }

    // locked groups contribute a fixed torque
    const base = new Float64Array(K); // e = base + sum m_g b_g
    const lockedIdx = [], freeIdx = [];
    groups.forEach((g, gi) => (g.locked ? lockedIdx : freeIdx).push(gi));
    let lockedPen = 0, lockedCross = 0;
    for (let k = 0; k < K; k++) base[k] = (1 - bias) * tg[k];
    const tmp = new Float64Array(K);
    let lockedBands = 0;
    for (const gi of lockedIdx) {
      const g = groups[gi];
      lockedBands += (g.m || 1);
      const pts = g.pts.map((p) => ({ li: p.link, ia: Math.round(p.a / G), ib: Math.round(p.b / G) }));
      const r = groupVec(g.type, pts, g.n, tmp);
      lockedPen += r.pen;
      lockedCross = Math.max(lockedCross, r.crossFrac || 0);
      for (let k = 0; k < K; k++) base[k] += g.m * tmp[k];
    }
    const freeBandBudget = Math.max(freeIdx.length, maxTotalBands - lockedBands);

    function metric(e) {
      let ss = 0, mx = 0;
      for (let k = 0; k < K; k++) {
        const w = angleWeights[k];
        let v = e[k];
        if (obj === 'bottom') {
          const alpha = k / (K - 1 || 1);
          if (alpha < 0.4 && v > 0) v *= 1.5; // penalize under-assist at bottom
        } else if (obj === 'top') {
          const alpha = k / (K - 1 || 1);
          if (alpha > 0.6 && v > 0) v *= 1.5; // penalize under-assist at top
        }
        ss += w * v * v;
        const a = Math.abs(v);
        if (a > mx) mx = a;
      }
      const rms = Math.sqrt(ss / sumW);
      if (obj === 'rms') return rms / S;
      if (obj === 'max') return mx / S;
      return (0.6 * rms + 0.4 * mx) / S;
    }

    const vecs = freeIdx.map(() => new Float64Array(K));
    const ework = new Float64Array(K);

    function costFor(ms) {
      for (let k = 0; k < K; k++) {
        let v = base[k];
        for (let j = 0; j < ms.length; j++) v += ms[j] * vecs[j][k];
        ework[k] = v;
      }
      return metric(ework);
    }

    function solveCounts() {
      const nG = vecs.length;
      if (nG === 0) return { ms: [], c: metric(base) };
      const budget = freeBandBudget;
      const maxPerGroup = Math.max(1, budget - (nG - 1));

      if (nG === 1) {
        let best = Infinity, bm = 1;
        for (let m = 1; m <= budget; m++) {
          const c = costFor([m]);
          if (c < best) { best = c; bm = m; }
        }
        return { ms: [bm], c: best };
      }

      // least-squares seed, then integer coordinate descent respecting total budget
      const A = [], rhs = [];
      for (let i = 0; i < nG; i++) {
        A.push(new Array(nG).fill(0)); rhs.push(0);
        for (let k = 0; k < K; k++) rhs[i] -= vecs[i][k] * base[k];
        for (let j = 0; j < nG; j++) for (let k = 0; k < K; k++) A[i][j] += vecs[i][k] * vecs[j][k];
        A[i][i] += 1e-9 + 1e-6 * A[i][i];
      }
      const x = gauss(A, rhs);
      let ms = x.map((v) => Math.max(1, Math.min(maxPerGroup, Math.round(isFinite(v) ? v : 1))));
      let sumM = ms.reduce((a, b) => a + b, 0);
      while (sumM > budget) {
        let maxJ = 0;
        for (let j = 1; j < nG; j++) if (ms[j] > ms[maxJ]) maxJ = j;
        if (ms[maxJ] <= 1) break;
        ms[maxJ]--;
        sumM--;
      }

      let c = costFor(ms);
      for (let pass = 0; pass < 8; pass++) {
        let improved = false;
        // Step +/- 1 or 2 on individual groups while respecting sum <= budget
        for (let j = 0; j < nG; j++) {
          for (const d of [-1, 1, -2, 2]) {
            const v = ms[j] + d;
            if (v < 1 || v > maxPerGroup) continue;
            const newSum = sumM - ms[j] + v;
            if (newSum > budget) continue;
            const t = ms.slice();
            t[j] = v;
            const ct = costFor(t);
            if (ct < c - 1e-12) {
              c = ct;
              ms = t;
              sumM = newSum;
              improved = true;
            }
          }
        }
        // Balance / shift bands between groups
        for (let i = 0; i < nG; i++) {
          for (let j = 0; j < nG; j++) {
            if (i === j || ms[i] <= 1 || ms[j] >= maxPerGroup) continue;
            const t = ms.slice();
            t[i]--;
            t[j]++;
            const ct = costFor(t);
            if (ct < c - 1e-12) {
              c = ct;
              ms = t;
              improved = true;
            }
          }
        }
        if (!improved) break;
      }
      return { ms, c };
    }

    /** state: [{pts:[{li,ia,ib}], n}] aligned with freeIdx */
    function evalState(state) {
      let pen = lockedPen, lamMax = 0, lamMin = Infinity, maxCross = lockedCross;
      for (let j = 0; j < state.length; j++) {
        const g = groups[freeIdx[j]];
        const r = groupVec(g.type, state[j].pts, state[j].n, vecs[j]);
        pen += r.pen; lamMax = Math.max(lamMax, r.lamMax); lamMin = Math.min(lamMin, r.lamMin);
        maxCross = Math.max(maxCross, r.crossFrac || 0);
      }
      const { ms, c } = solveCounts();
      let tie = 0;
      for (let j = 0; j < state.length; j++) tie += 0.0015 * ms[j] + 0.001 * (state[j].n - 1);
      // tiny preference for posts that are not at the extreme of the allowed range
      return { cost: c + pen + tie, fit: c, pen, ms, lamMax, lamMin, crossFrac: maxCross };
    }

    return {
      K, thetas, S, ranges, freeIdx, lockedIdx, midF, groups, model, evalState, metric, base, opts,
      maxW, maxTotalBands, freeBandBudget,
    };
  }

  function gauss(A, b) {
    const n = b.length;
    const M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c] || 1e-12;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / d;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / (r[i] || 1e-12));
  }

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------

  function cloneState(s) {
    return s.map((g) => ({ n: g.n, pts: g.pts.map((p) => ({ li: p.li, ia: p.ia, ib: p.ib })) }));
  }
  function stateKey(s, ms) {
    return s.map((g, j) => g.n + ':' + (ms ? ms[j] : '') + ':' + g.pts.map((p) => p.li + ',' + p.ia + ',' + p.ib).join('|')).join('/');
  }

  function run(ctx, { onProgress, onDone, timeBudgetMs = 3000, seed = 1, topN = 8, initial = null }) {
    const rnd = mulberry32(seed);
    const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const { groups, freeIdx, ranges, opts } = ctx;
    const maxW = Math.max(1, Math.min(3, parseInt(opts.maxWraps) || ctx.maxW || 2));
    let evals = 0, restarts = 0, cancelled = false;
    const top = [];

    const allowedOf = (j) => {
      const al = groups[freeIdx[j]].allowed;
      return al && al.length ? al : ctx.model.links.map((l) => l.idx);
    };
    const npOf = (j) => (groups[freeIdx[j]].type === 'line' ? 2 : 3);

    function randPoint(li) {
      const r = ranges[li];
      const l = ctx.model.links[li];
      for (let tries = 0; tries < 60; tries++) {
        const ia = ri(r.aMin, r.aMax), ib = ri(r.bMin, r.bMax);
        if (!LP.isPivot(l, ia * LP.GRID, ib * LP.GRID)) {
          return { li, ia, ib };
        }
      }
      return { li, ia: ri(r.aMin, r.aMax), ib: ri(r.bMin, r.bMax) };
    }
    function validGroup(g) {
      if (!g || g.n < 1 || g.n > maxW) return false;
      const set = new Set(g.pts.map((p) => p.li));
      if (set.size < 2) return false;
      const keys = new Set(g.pts.map((p) => p.li + ',' + p.ia + ',' + p.ib));
      if (keys.size !== g.pts.length) return false;
      // Do not allow banding to axle / screwjoint pivot holes (causes friction and mechanical binding)
      for (const p of g.pts) {
        const l = ctx.model.links[p.li];
        if (LP.isPivot(l, p.ia * LP.GRID, p.ib * LP.GRID)) return false;
      }
      return true;
    }
    function randomState() {
      return freeIdx.map((gi, j) => {
        const al = allowedOf(j);
        let g;
        for (let tries = 0; tries < 50; tries++) {
          g = { n: ri(1, maxW), pts: [] };
          for (let i = 0; i < npOf(j); i++) g.pts.push(randPoint(al[ri(0, al.length - 1)]));
          if (validGroup(g)) break;
        }
        return g;
      });
    }

    function evalS(s) {
      evals++;
      for (const g of s) if (!validGroup(g)) return { cost: Infinity };
      return ctx.evalState(s);
    }

    function relink(p, li) {
      // put the post on link li at the same physical spot (at mid-range angle), avoiding pivots
      const f0 = ctx.midF[p.li], f1 = ctx.midF[li];
      const w = LP.pointAt(f0, p.ia * LP.GRID, p.ib * LP.GRID);
      const loc = LP.worldToLocal(f1, w[0], w[1]);
      const l1 = ctx.model.links[li];
      const [clA, clB] = LP.nearestNonPivot(l1, loc[0], loc[1], opts);
      return { li, ia: Math.round(clA / LP.GRID), ib: Math.round(clB / LP.GRID) };
    }

    function neighbors(s) {
      const out = [];
      s.forEach((g, j) => {
        const al = allowedOf(j);
        g.pts.forEach((p, i) => {
          const r = ranges[p.li];
          const l = ctx.model.links[p.li];
          for (const [da, db] of [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [2, 0], [-2, 0], [0, 2], [0, -2],
            [1, 1], [-1, -1], [1, -1], [-1, 1]
          ]) {
            const ia = p.ia + da, ib = p.ib + db;
            if (ia < r.aMin || ia > r.aMax || ib < r.bMin || ib > r.bMax) continue;
            // Never propose a pivot hole, 1 hole away from a pivot, or gear mesh zone
            if (LP.isPivot(l, ia * LP.GRID, ib * LP.GRID)) continue;
            out.push([j, i, { li: p.li, ia, ib }]);
          }
          for (const li of al) if (li !== p.li) out.push([j, i, relink(p, li)]);
        });
        if (g.n > 1) out.push([j, -1, g.n - 1]);
        if (g.n < maxW) out.push([j, -1, g.n + 1]);
      });
      return out;
    }
    function apply(s, mv) {
      const t = cloneState(s);
      const [j, i, v] = mv;
      if (i < 0) t[j].n = Math.min(maxW, Math.max(1, v)); else t[j].pts[i] = v;
      return t;
    }
    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    }

    function climb(s, cur) {
      for (let it = 0; it < 400; it++) {
        const nb = shuffle(neighbors(s));
        let moved = false;
        for (const mv of nb) {
          const t = apply(s, mv);
          const r = evalS(t);
          if (r.cost < cur.cost - 1e-9) { s = t; cur = r; moved = true; break; }
        }
        if (!moved) break;
      }
      return [s, cur];
    }

    function kick(s) {
      const t = cloneState(s);
      const j = ri(0, t.length - 1);
      const g = t[j];
      const i = ri(0, g.pts.length - 1);
      if (rnd() < 0.4) {
        const al = allowedOf(j);
        g.pts[i] = randPoint(al[ri(0, al.length - 1)]);
      } else {
        const p = g.pts[i], r = ranges[p.li];
        p.ia = Math.min(r.aMax, Math.max(r.aMin, p.ia + ri(-4, 4)));
        p.ib = Math.min(r.bMax, Math.max(r.bMin, p.ib + ri(-2, 2)));
      }
      if (rnd() < 0.2) g.n = ri(1, maxW);
      return t;
    }

    function record(s, r) {
      if (!isFinite(r.cost)) return;
      const key = stateKey(s, r.ms);
      if (top.some((t) => t.key === key)) return;
      if (top.length >= topN && r.cost >= top[top.length - 1].cost) return;
      top.push({ key, state: cloneState(s), ...r });
      top.sort((a, b) => a.cost - b.cost);
      if (top.length > topN) top.pop();
    }

    function oneRestart() {
      let s = initial && restarts === 0
        ? cloneState(initial).map((g) => ({ ...g, n: Math.min(maxW, Math.max(1, g.n)) }))
        : randomState();
      let cur = evalS(s);
      [s, cur] = climb(s, cur);
      record(s, cur);
      for (let kk = 0; kk < 8; kk++) {
        const t0 = kick(s);
        let [t, rt] = climb(t0, evalS(t0));
        if (rt.cost < cur.cost - 1e-9) { s = t; cur = rt; }
        record(t, rt);
      }
      restarts++;
    }

    const tStart = performance.now();
    function step() {
      if (cancelled) return;
      const sliceEnd = performance.now() + 30;
      while (performance.now() < sliceEnd) {
        oneRestart();
        if (performance.now() - tStart > timeBudgetMs) break;
      }
      const elapsed = performance.now() - tStart;
      if (onProgress) onProgress({ frac: Math.min(1, elapsed / timeBudgetMs), evals, restarts, best: top[0] });
      if (elapsed > timeBudgetMs) {
        if (onDone) onDone(finish());
      } else setTimeout(step, 0);
    }
    function finish() {
      return {
        evals, restarts,
        results: top.map((t) => ({
          cost: t.cost, fit: t.fit, pen: t.pen, lamMax: t.lamMax, lamMin: t.lamMin,
          crossFrac: t.crossFrac || 0,
          groups: t.state.map((g, j) => ({
            gi: freeIdx[j],
            type: groups[freeIdx[j]].type,
            n: g.n,
            m: t.ms[j],
            pts: g.pts.map((p) => ({ link: p.li, a: p.ia * LP.GRID, b: p.ib * LP.GRID })),
            allowed: groups[freeIdx[j]].allowed,
          })),
        })),
      };
    }

    if (freeIdx.length === 0) {
      setTimeout(() => onDone && onDone({ evals: 0, restarts: 0, results: [] }), 0);
      return { cancel() {} };
    }
    setTimeout(step, 0);
    return { cancel() { cancelled = true; } };
  }

  /** synchronous version (tests / node) */
  function runSync(ctx, params) {
    let result = null;
    const realSetTimeout = root.setTimeout;
    const queue = [];
    root.setTimeout = (fn) => queue.push(fn);
    try {
      run(ctx, { ...params, onDone: (r) => (result = r) });
      while (queue.length) queue.shift()();
    } finally {
      root.setTimeout = realSetTimeout;
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Multi-Scenario Explorer (Approach A: Tournament + Successive Halving)
  // ------------------------------------------------------------------

  function buildScenarioCatalog(model, opts) {
    const maxTotalBands = Math.max(1, parseInt(opts && opts.maxBands) || 10);
    const cloneGroup = (type, allowed) => ({ type, locked: false, n: 1, m: 1, pts: [], allowed });
    const scenarios = [];

    if (model.hasS2) {
      const s1Links = model.links.filter((l) => l.stage <= 1 || l.name === 'Middle tower').map((l) => l.idx);
      const s2Links = model.links.filter((l) => l.stage === 2 || l.name === 'Middle tower').map((l) => l.idx);

      scenarios.push(
        { id: 's1_line', name: '1-Grp: S1 Line (2-pt)', short: 'S1 Line', groupCount: 1, postCount: 2, exact: true, groups: [cloneGroup('line', s1Links)] },
        { id: 's1_tri', name: '1-Grp: S1 Triangle (3-pt)', short: 'S1 Tri', groupCount: 1, postCount: 3, exact: false, groups: [cloneGroup('tri', s1Links)] },
        { id: 's2_line', name: '1-Grp: S2 Line (2-pt)', short: 'S2 Line', groupCount: 1, postCount: 2, exact: true, groups: [cloneGroup('line', s2Links)] },
        { id: 's2_tri', name: '1-Grp: S2 Triangle (3-pt)', short: 'S2 Tri', groupCount: 1, postCount: 3, exact: false, groups: [cloneGroup('tri', s2Links)] }
      );

      if (maxTotalBands >= 2) {
        scenarios.push(
          { id: 's1_line_s2_line', name: '2-Grp: S1 Line + S2 Line', short: 'S1 Line + S2 Line', groupCount: 2, postCount: 4, exact: false, groups: [cloneGroup('line', s1Links), cloneGroup('line', s2Links)] },
          { id: 's1_tri_s2_line', name: '2-Grp: S1 Tri + S2 Line', short: 'S1 Tri + S2 Line', groupCount: 2, postCount: 5, exact: false, groups: [cloneGroup('tri', s1Links), cloneGroup('line', s2Links)] },
          { id: 's1_line_s2_tri', name: '2-Grp: S1 Line + S2 Tri', short: 'S1 Line + S2 Tri', groupCount: 2, postCount: 5, exact: false, groups: [cloneGroup('line', s1Links), cloneGroup('tri', s2Links)] },
          { id: 's1_tri_s2_tri', name: '2-Grp: S1 Tri + S2 Tri', short: 'S1 Tri + S2 Tri', groupCount: 2, postCount: 6, exact: false, groups: [cloneGroup('tri', s1Links), cloneGroup('tri', s2Links)] },
          { id: 's1_dual_tri', name: '2-Grp: Dual S1 Triangles', short: 'Dual S1 Tri', groupCount: 2, postCount: 6, exact: false, groups: [cloneGroup('tri', s1Links), cloneGroup('tri', s1Links)] },
          { id: 's2_dual_tri', name: '2-Grp: Dual S2 Triangles', short: 'Dual S2 Tri', groupCount: 2, postCount: 6, exact: false, groups: [cloneGroup('tri', s2Links), cloneGroup('tri', s2Links)] }
        );
      }
    } else {
      const allLinks = model.links.map((l) => l.idx);
      scenarios.push(
        { id: 's1_line', name: '1-Grp: Linear (2-pt)', short: 'Linear', groupCount: 1, postCount: 2, exact: true, groups: [cloneGroup('line', allLinks)] },
        { id: 's1_tri', name: '1-Grp: Triangle (3-pt)', short: 'Triangle', groupCount: 1, postCount: 3, exact: false, groups: [cloneGroup('tri', allLinks)] }
      );

      if (maxTotalBands >= 2) {
        scenarios.push(
          { id: 'dual_line', name: '2-Grp: Dual Linear', short: 'Dual Linear', groupCount: 2, postCount: 4, exact: false, groups: [cloneGroup('line', allLinks), cloneGroup('line', allLinks)] },
          { id: 'tri_line', name: '2-Grp: Triangle + Linear', short: 'Tri + Linear', groupCount: 2, postCount: 5, exact: false, groups: [cloneGroup('tri', allLinks), cloneGroup('line', allLinks)] },
          { id: 'dual_tri', name: '2-Grp: Dual Triangles', short: 'Dual Tri', groupCount: 2, postCount: 6, exact: false, groups: [cloneGroup('tri', allLinks), cloneGroup('tri', allLinks)] }
        );
      }
    }

    return scenarios;
  }

  /** Exhaustive exact grid search for 1-group 2-pt line scenarios */
  function runExactLine(ctx, { onProgress, onDone, topN = 6 }) {
    const { groups, freeIdx, ranges, opts, model } = ctx;
    const g = groups[freeIdx[0]];
    const maxW = Math.max(1, Math.min(3, parseInt(opts.maxWraps) || ctx.maxW || 2));
    const allowed = g && g.allowed && g.allowed.length ? g.allowed : model.links.map((l) => l.idx);

    const holes = [];
    for (const li of allowed) {
      const r = ranges[li];
      const l = model.links[li];
      for (let ia = r.aMin; ia <= r.aMax; ia++) {
        for (let ib = r.bMin; ib <= r.bMax; ib++) {
          if (!LP.isPivot(l, ia * LP.GRID, ib * LP.GRID)) {
            holes.push({ li, ia, ib });
          }
        }
      }
    }

    let cancelled = false;
    let evals = 0;
    const top = [];

    function record(state, r) {
      if (!isFinite(r.cost)) return;
      const key = stateKey(state, r.ms);
      if (top.some((t) => t.key === key)) return;
      if (top.length >= topN && r.cost >= top[top.length - 1].cost) return;
      top.push({ key, state: cloneState(state), ...r });
      top.sort((a, b) => a.cost - b.cost);
      if (top.length > topN) top.pop();
    }

    function finish() {
      return {
        evals,
        restarts: 1,
        results: top.map((t) => ({
          cost: t.cost, fit: t.fit, pen: t.pen, lamMax: t.lamMax, lamMin: t.lamMin,
          crossFrac: t.crossFrac || 0,
          groups: t.state.map((sg, j) => ({
            gi: freeIdx[j],
            type: groups[freeIdx[j]].type,
            n: sg.n,
            m: t.ms[j],
            pts: sg.pts.map((p) => ({ link: p.li, a: p.ia * LP.GRID, b: p.ib * LP.GRID })),
            allowed: groups[freeIdx[j]].allowed,
          })),
        })),
      };
    }

    if (holes.length < 2) {
      setTimeout(() => { if (!cancelled && onDone) onDone(finish()); }, 0);
      return { cancel() { cancelled = true; } };
    }

    let idx1 = 0, idx2 = 1;
    const nHoles = holes.length;

    function step() {
      if (cancelled) return;
      const sliceEnd = performance.now() + 25;
      while (idx1 < nHoles - 1) {
        const p1 = holes[idx1];
        const p2 = holes[idx2];
        if (p1.li !== p2.li) {
          for (let n = 1; n <= maxW; n++) {
            const state = [{ n, pts: [p1, p2] }];
            evals++;
            const r = ctx.evalState(state);
            record(state, r);
          }
        }
        idx2++;
        if (idx2 >= nHoles) {
          idx1++;
          idx2 = idx1 + 1;
        }
        if (performance.now() >= sliceEnd) break;
      }

      const frac = nHoles > 1 ? Math.min(1, idx1 / (nHoles - 1)) : 1;
      if (onProgress) onProgress({ frac, evals, restarts: 1, best: top[0] });
      if (idx1 >= nHoles - 1) {
        if (onDone) onDone(finish());
      } else {
        setTimeout(step, 0);
      }
    }

    setTimeout(step, 0);
    return { cancel() { cancelled = true; } };
  }

  /** Two-round Multi-Scenario Tournament (Round 1 Broad Screening + Round 2 Successive Halving) */
  function exploreScenarios(model, band, opts, params) {
    params = params || {};
    const onProgress = params.onProgress;
    const onDone = params.onDone;
    const timeBudgetMs = Math.max(400, parseInt(params.timeBudgetMs) || 5000);
    const seed = params.seed || 1;
    const catalog = buildScenarioCatalog(model, opts);

    // Order Round 1: run fast exact 1-group line searches first, then stochastic ILS searches
    const exactCatalog = catalog.filter((s) => s.exact);
    const searchCatalog = catalog.filter((s) => !s.exact);
    const r1Order = exactCatalog.concat(searchCatalog);

    const entries = catalog.map((def) => ({
      def,
      ctx: null,
      evals: 0,
      restarts: 0,
      best: null,
      polished: false,
    }));
    const entryById = new Map(entries.map((e) => [e.def.id, e]));

    let cancelled = false;
    let activeTask = null;
    let totalEvals = 0;
    let totalRestarts = 0;
    const tStart = performance.now();
    const r1TargetEnd = tStart + timeBudgetMs * 0.55;

    let r1Idx = 0;
    let perSearchMs = Math.max(150, Math.floor((timeBudgetMs * 0.50) / Math.max(1, searchCatalog.length)));
    let exactDoneCount = 0;

    let finalists = [];
    let r2Idx = 0;
    let perFinalistMs = 400;

    function emitProgress(phase, scIdx, scCount, scName, subFrac, subEvals, subRestarts) {
      if (!onProgress || cancelled) return;
      const doneFrac = phase === 1
        ? 0.55 * ((scIdx + subFrac) / Math.max(1, scCount))
        : 0.55 + 0.45 * ((scIdx + subFrac) / Math.max(1, scCount));
      onProgress({
        phase,
        totalPhases: 2,
        scenarioIndex: Math.min(scCount, scIdx + 1),
        scenarioCount: scCount,
        scenarioName: scName,
        frac: Math.min(0.99, doneFrac),
        totalEvals: totalEvals + (subEvals || 0),
        totalRestarts: totalRestarts + (subRestarts || 0),
      });
    }

    function finishTournament() {
      if (cancelled) return;
      const results = [];
      for (const e of entries) {
        if (!e.best || !e.best.groups || e.best.groups.length === 0) continue;
        const totalBands = e.best.groups.reduce((sum, g) => sum + (g.m || 1), 0);
        results.push({
          isScenario: true,
          scenarioId: e.def.id,
          scenarioName: e.def.name,
          scenarioShort: e.def.short,
          groupCount: e.def.groupCount,
          postCount: e.def.postCount,
          exact: e.def.exact,
          restarts: e.restarts,
          evals: e.evals,
          polished: e.polished,
          cost: e.best.cost,
          fit: e.best.fit,
          pen: e.best.pen,
          lamMax: e.best.lamMax,
          lamMin: e.best.lamMin,
          crossFrac: e.best.crossFrac || 0,
          totalBands,
          groups: e.best.groups.map((g, gi) => ({
            gi,
            type: g.type || e.def.groups[gi].type,
            n: g.n,
            m: g.m,
            pts: g.pts.map((p) => ({ ...p })),
            allowed: g.allowed || e.def.groups[gi].allowed,
          })),
        });
      }
      results.sort((a, b) => a.cost - b.cost);
      if (onDone) {
        onDone({
          evals: totalEvals,
          restarts: totalRestarts,
          scenariosTested: catalog.length,
          results,
        });
      }
    }

    function runNextRound2() {
      if (cancelled) return;
      if (r2Idx >= finalists.length) {
        finishTournament();
        return;
      }
      const fin = finalists[r2Idx];
      const initial = fin.best.groups.map((g) => ({
        n: g.n,
        pts: g.pts.map((p) => ({ li: p.link, ia: Math.round(p.a / LP.GRID), ib: Math.round(p.b / LP.GRID) })),
      }));
      activeTask = run(fin.ctx, {
        timeBudgetMs: perFinalistMs,
        seed: seed + 1000 + r2Idx * 97,
        topN: 6,
        initial,
        onProgress: (p) => emitProgress(2, r2Idx, finalists.length, fin.def.name, p.frac, p.evals, p.restarts),
        onDone: (res) => {
          activeTask = null;
          if (cancelled) return;
          fin.evals += res.evals;
          fin.restarts += res.restarts;
          totalEvals += res.evals;
          totalRestarts += res.restarts;
          fin.polished = true;
          if (res.results && res.results.length > 0 && res.results[0].cost < fin.best.cost) {
            fin.best = res.results[0];
          }
          r2Idx++;
          runNextRound2();
        },
      });
    }

    function startRound2() {
      if (cancelled) return;
      const nonExactValid = entries
        .filter((e) => !e.def.exact && e.best && isFinite(e.best.cost))
        .sort((a, b) => a.best.cost - b.best.cost);

      finalists = nonExactValid.slice(0, 3);
      if (finalists.length > 0 && !finalists.some((f) => f.def.groupCount === 1)) {
        const bestSingle = nonExactValid.find((e) => e.def.groupCount === 1);
        if (bestSingle) finalists.push(bestSingle);
      }

      if (finalists.length === 0) {
        finishTournament();
        return;
      }

      const remaining = Math.max(400, timeBudgetMs - (performance.now() - tStart));
      perFinalistMs = Math.max(150, Math.floor(remaining / finalists.length));
      r2Idx = 0;
      runNextRound2();
    }

    function runNextRound1() {
      if (cancelled) return;
      if (r1Idx >= r1Order.length) {
        startRound2();
        return;
      }

      const def = r1Order[r1Idx];
      const entry = entryById.get(def.id);
      const groupsClone = def.groups.map((g) => ({ ...g, pts: [] }));
      entry.ctx = createContext(model, groupsClone, band, opts);

      if (def.exact) {
        activeTask = runExactLine(entry.ctx, {
          topN: 6,
          onProgress: (p) => emitProgress(1, r1Idx, r1Order.length, def.name, p.frac, p.evals, p.restarts),
          onDone: (res) => {
            activeTask = null;
            if (cancelled) return;
            entry.evals += res.evals;
            entry.restarts += res.restarts;
            totalEvals += res.evals;
            totalRestarts += res.restarts;
            if (res.results && res.results.length > 0) entry.best = res.results[0];
            exactDoneCount++;
            if (exactDoneCount === exactCatalog.length && searchCatalog.length > 0) {
              const remR1 = Math.max(0, r1TargetEnd - performance.now());
              perSearchMs = Math.max(150, Math.floor(remR1 / searchCatalog.length));
            }
            r1Idx++;
            runNextRound1();
          },
        });
      } else {
        activeTask = run(entry.ctx, {
          timeBudgetMs: perSearchMs,
          seed: seed + r1Idx * 37,
          topN: 6,
          onProgress: (p) => emitProgress(1, r1Idx, r1Order.length, def.name, p.frac, p.evals, p.restarts),
          onDone: (res) => {
            activeTask = null;
            if (cancelled) return;
            entry.evals += res.evals;
            entry.restarts += res.restarts;
            totalEvals += res.evals;
            totalRestarts += res.restarts;
            if (res.results && res.results.length > 0) entry.best = res.results[0];
            r1Idx++;
            runNextRound1();
          },
        });
      }
    }

    setTimeout(runNextRound1, 0);
    return {
      cancel() {
        cancelled = true;
        if (activeTask) activeTask.cancel();
      },
    };
  }

  /** synchronous multi-scenario explorer (tests / node) */
  function exploreScenariosSync(model, band, opts, params) {
    let result = null;
    const realSetTimeout = root.setTimeout;
    const queue = [];
    root.setTimeout = (fn) => queue.push(fn);
    try {
      exploreScenarios(model, band, opts, { ...params, onDone: (r) => (result = r) });
      while (queue.length) queue.shift()();
    } finally {
      root.setTimeout = realSetTimeout;
    }
    return result;
  }

  root.LiftOptimizer = {
    createContext, run, runSync, mulberry32,
    buildScenarioCatalog, exploreScenarios, exploreScenariosSync,
  };
})(typeof window !== 'undefined' ? window : globalThis);
