/*
 * physics.js — kinematics + rubber-band statics for VEX parallelogram lifts.
 *
 * Conventions
 *   - Units: inches, pounds (lbf), radians internally (degrees in the UI).
 *   - World frame: +x forward (away from the tower), +y up. Origin = lower
 *     stage-1 pivot on the tower.
 *   - theta: angle of the stage-1 arms above horizontal. Every bar in the
 *     lift rotates by +theta (stage 1) or mirrors it (stage 2, pointing back),
 *     and every non-bar link (middle tower, 6-bar middle link, carriage)
 *     only translates — that's what parallelograms do.
 *
 * Each link carries a local frame  p = o + a*X + b*Y.
 *   - bars:  X points along the bar from its root pivot toward its far pivot,
 *            Y is the bar's "upper side" (perpendicular). (a,b) = (along, offset)
 *   - links: X = world +x, Y = world +y.            (a,b) = (forward, up)
 * For a bar, dX/dtheta = Y and dY/dtheta = -X (for both stage directions), so
 * the exact velocity of any post is  p' = o' + a*Y - b*X.
 *
 * Statics (virtual work, one degree of freedom):
 *   tau_drive(theta) = dU_gravity/dtheta + dU_bands/dtheta
 *   dU_gravity/dtheta = sum(W_i * dy_cg_i/dtheta)
 *   dU_band/dtheta    = sides * m * n * T(lambda) * dP/dtheta
 * where P is the post-to-post loop perimeter, n the number of wraps, m the
 * number of bands per side and T the strand tension. tau_drive is the torque
 * the motors must supply at the stage-1 pivot to hold the lift still. The goal
 * of the optimizer is to make it ~0 over the full range of motion.
 */
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const GRID = 0.5;
  const INLB_TO_NM = 0.112984829;

  const snap = (v) => Math.round(v / GRID) * GRID;

  // ------------------------------------------------------------------
  // Unit Conversions & VEX Hole Pitch Math
  // ------------------------------------------------------------------
  /**
   * Convert inches to VEX hole count:
   * holes = inches * 2 + 1
   * (0.0" -> 1 hole, 0.5" -> 2 holes, 1.0" -> 3 holes, 1.5" -> 4 holes)
   */
  function inToHoles(inches) {
    if (inches === null || inches === undefined || isNaN(inches)) return 1;
    return Math.round(inches * 2) + 1;
  }

  /**
   * Convert VEX hole count to inches:
   * inches = (holes - 1) * 0.5
   * (1 hole -> 0.0", 2 holes -> 0.5", 3 holes -> 1.0", 4 holes -> 1.5")
   */
  function holesToIn(holes) {
    if (holes === null || holes === undefined || isNaN(holes)) return 0;
    return Math.max(0, (holes - 1) * 0.5);
  }

  /**
   * Parse flexible gear reduction string:
   * Handles:
   *   - "1:5", "1:7", "3:7", "1:15"
   *   - "60/12", "84/12"
   *   - Compound: "12:60 * 12:36", "1:5 * 1:3", "12:84 x 12:36"
   *   - Decimal: "5.0", "7.5"
   */
  function parseReduction(str) {
    if (!str) return 5.0;
    str = String(str).trim();
    if (!str) return 5.0;

    // Check for compound stages separated by *, x, or comma
    const tokens = str.split(/[\*\,xX\s]+/).filter(Boolean);
    if (tokens.length > 1) {
      let prod = 1;
      for (const tok of tokens) {
        const sub = parseReduction(tok);
        if (sub > 0) prod *= sub;
      }
      return prod > 0 ? prod : 5.0;
    }

    if (str.includes(':')) {
      const parts = str.split(':').map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        return parts[1] / parts[0];
      }
    }
    if (str.includes('/')) {
      const parts = str.split('/').map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        return parts[0] / parts[1];
      }
    }
    const val = parseFloat(str);
    return isFinite(val) && val > 0 ? val : 5.0;
  }

  // ------------------------------------------------------------------
  // Linkage model
  // ------------------------------------------------------------------

  function linkFrame(ox, oy, dox, doy) {
    return { ox, oy, dox, doy, xx: 1, xy: 0, yx: 0, yy: 1, rot: 0 };
  }

  function barFrame(ox, oy, dox, doy, th, dir) {
    const c = Math.cos(th), s = Math.sin(th);
    return { ox, oy, dox, doy, xx: dir * c, xy: s, yx: -dir * s, yy: c, rot: 1 };
  }

  /**
   * Build a lift model.
   * cfg.stage1 = { type:'4bar', L, s }  or  { type:'6bar', L1, L2, s1, s2 }
   * cfg.stage2 = { type:'none' } | 4bar/6bar params + { h } (height of the
   *              stage-2 lower pivot above the middle tower's lower pivot)
   * cfg.mass   = { barDensity, overhang, sides, middleTower, midLink,
   *                endEffector, payload }
   */
  function buildModel(cfg) {
    const links = [];
    const m = cfg.mass;
    const add = (def) => {
      def.idx = links.length;
      def.pivots = def.pivots || [];
      def.mass = def.mass || 0;
      def.cg = def.cg || [0, 0];
      links.push(def);
      return def;
    };
    const barMass = (len) => m.barDensity * (len + 2 * m.overhang) * m.sides;

    const ground = add({
      id: 'ground', name: 'Tower (ground)', short: 'Tower', kind: 'ground', stage: 0,
      compute: () => linkFrame(0, 0, 0, 0),
    });

    function addStage(st, base, y0, dir, sNo, isLast) {
      const tag = 'S' + sNo;
      const nm = 'Stage ' + sNo;
      const P0 = (F) => { const f = F[base.idx]; return [f.ox, f.oy + y0, f.dox, f.doy]; };
      base.pivots.push([0, y0]);

      if (st.type === '4bar') {
        const { L, s } = st;
        base.pivots.push([0, y0 + s]);
        add({
          id: tag + 'bot', name: nm + ' bottom arm', short: tag + ' bot arm', kind: 'bar', stage: sNo, length: L, dir,
          pivots: [[0, 0], [L, 0]], mass: barMass(L), cg: [L / 2, 0],
          compute: (th, F) => { const p = P0(F); return barFrame(p[0], p[1], p[2], p[3], th, dir); },
        });
        add({
          id: tag + 'top', name: nm + ' top arm', short: tag + ' top arm', kind: 'bar', stage: sNo, length: L, dir,
          pivots: [[0, 0], [L, 0]], mass: barMass(L), cg: [L / 2, 0],
          compute: (th, F) => { const p = P0(F); return barFrame(p[0], p[1] + s, p[2], p[3], th, dir); },
        });
        const out = add({
          id: tag + 'out', kind: 'link', stage: sNo,
          name: isLast ? 'Carriage / intake' : 'Middle tower', short: isLast ? 'Carriage' : 'Mid tower',
          pivots: [[0, 0], [0, s]],
          compute: (th, F) => {
            const p = P0(F), c = Math.cos(th), sn = Math.sin(th);
            return linkFrame(p[0] + L * dir * c, p[1] + L * sn, p[2] - L * dir * sn, p[3] + L * c);
          },
        });
        return out;
      }

      if (st.type === '6bar') {
        const { L1, L2, s1, s2 } = st;
        base.pivots.push([0, y0 + s1]);
        add({
          id: tag + 'low', name: nm + ' lower short bar', short: tag + ' low bar', kind: 'bar', stage: sNo, length: L1, dir,
          pivots: [[0, 0], [L1, 0]], mass: barMass(L1), cg: [L1 / 2, 0],
          compute: (th, F) => { const p = P0(F); return barFrame(p[0], p[1], p[2], p[3], th, dir); },
        });
        add({
          id: tag + 'long', name: nm + ' long (crossing) bar', short: tag + ' long bar', kind: 'bar', stage: sNo,
          length: L1 + L2, dir, pivots: [[0, 0], [L1, 0], [L1 + L2, 0]], mass: barMass(L1 + L2), cg: [(L1 + L2) / 2, 0],
          compute: (th, F) => { const p = P0(F); return barFrame(p[0], p[1] + s1, p[2], p[3], th, dir); },
        });
        const mid = add({
          id: tag + 'mid', name: nm + ' 6-bar middle link', short: tag + ' mid link', kind: 'link', stage: sNo,
          pivots: [[0, 0], [0, s1], [0, s1 + s2]], mass: m.midLink,
          compute: (th, F) => {
            const p = P0(F), c = Math.cos(th), sn = Math.sin(th);
            return linkFrame(p[0] + L1 * dir * c, p[1] + L1 * sn, p[2] - L1 * dir * sn, p[3] + L1 * c);
          },
        });
        add({
          id: tag + 'up', name: nm + ' upper short bar', short: tag + ' up bar', kind: 'bar', stage: sNo, length: L2, dir,
          pivots: [[0, 0], [L2, 0]], mass: barMass(L2), cg: [L2 / 2, 0],
          compute: (th, F) => { const f = F[mid.idx]; return barFrame(f.ox, f.oy + s1 + s2, f.dox, f.doy, th, dir); },
        });
        const out = add({
          id: tag + 'out', kind: 'link', stage: sNo,
          name: isLast ? 'Carriage / intake' : 'Middle tower', short: isLast ? 'Carriage' : 'Mid tower',
          pivots: [[0, 0], [0, s2]],
          compute: (th, F) => {
            const f = F[mid.idx], c = Math.cos(th), sn = Math.sin(th);
            return linkFrame(f.ox + L2 * dir * c, f.oy + s1 + L2 * sn, f.dox - L2 * dir * sn, f.doy + L2 * c);
          },
        });
        return out;
      }
      throw new Error('Unknown stage type ' + st.type);
    }

    const hasS2 = cfg.stage2 && cfg.stage2.type !== 'none';
    const out1 = addStage(cfg.stage1, ground, 0, 1, 1, !hasS2);
    let end = out1;
    if (hasS2) {
      out1.mass = m.middleTower;
      end = addStage(cfg.stage2, out1, cfg.stage2.h, -1, 2, true);
    }
    end.mass = m.endEffector;
    end.isEnd = true;

    return { cfg, links, ground, end, hasS2 };
  }

  function framesAt(model, th) {
    const F = new Array(model.links.length);
    for (const l of model.links) F[l.idx] = l.compute(th, F);
    return F;
  }

  /** world position + d/dtheta of local point (a,b) */
  function pointAt(f, a, b) {
    const x = f.ox + a * f.xx + b * f.yx;
    const y = f.oy + a * f.xy + b * f.yy;
    let dx = f.dox, dy = f.doy;
    if (f.rot) {
      dx += a * f.yx - b * f.xx;
      dy += a * f.yy - b * f.xy;
    }
    return [x, y, dx, dy];
  }

  /** inverse: world -> local coords of link frame */
  function worldToLocal(f, x, y) {
    const dx = x - f.ox, dy = y - f.oy;
    return [dx * f.xx + dy * f.xy, dx * f.yx + dy * f.yy];
  }

  /** allowed post range (inches) on a link strictly ON the physical metal */
  function linkRange(link, opts) {
    const isHalfCut = opts && opts.halfCut !== undefined ? !!opts.halfCut : true;
    if (link.kind === 'bar') {
      // Along the bar: holes ONLY exist from hole 0 (a=0 at root pivot) to end hole (a=link.length at end pivot)
      // Any a < 0 is off the metal in thin air behind the pivot!
      // Any a > link.length is off the metal in thin air past the end of the bar!
      return {
        aMin: 0.0,
        aMax: link.length,
        bMin: isHalfCut ? 0.0 : -0.5,
        bMax: isHalfCut ? 0.0 : 0.5,
      };
    }
    // Uprights / Towers
    let lo = Infinity, hi = -Infinity;
    for (const p of link.pivots) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    if (!isFinite(lo)) { lo = 0; hi = 0; }
    // Transverse offset on upright: half-cut has ONLY the vertical centerline column (a=0)
    // There is NO metal floating in air to the left or right of the upright!
    return {
      aMin: isHalfCut ? 0.0 : -0.5,
      aMax: isHalfCut ? 0.0 : 0.5,
      bMin: Math.max(0.0, lo),
      bMax: snap(hi + 0.5), // at most 1 hole past the top pivot
    };
  }

  /**
   * true if coordinate (a,b) cannot be used for rubber band standoff posts:
   * 1. Axle / screwjoint pivot hole (dist == 0)
   * 2. 1 hole away (dist <= 0.5"), occupied by gear mounting bolts or bearing flat screws
   * 3. Middle tower synchronization gear mesh envelope
   */
  function isPivot(link, a, b, eps = 0.75) {
    if (!link) return false;
    if (link.pivots) {
      for (const p of link.pivots) {
        if (Math.hypot(a - p[0], b - p[1]) <= eps) return true;
      }
      // Middle tower synchronization gear envelope
      if (link.name === 'Middle tower' && link.pivots.length >= 4) {
        const y1 = link.pivots[1][1];
        const y2 = link.pivots[2][1];
        const dy = y2 - y1;
        if (dy > 0.4) {
          const rGear = dy / 2 + 0.15;
          if (b >= y1 - rGear - 1e-4 && b <= y2 + rGear + 1e-4) return true;
        }
      }
    }
    return false;
  }

  /** snap coordinate (a,b) to nearest hole strictly ON the metal that is NOT a pivot, 1 hole away, or gear mesh */
  function nearestNonPivot(link, a, b, opts) {
    const isHalfCut = opts && opts.halfCut !== undefined ? !!opts.halfCut : true;
    const r = linkRange(link, opts);
    let clA = Math.min(r.aMax, Math.max(r.aMin, snap(a)));
    let clB = Math.min(r.bMax, Math.max(r.bMin, snap(b)));
    if (isHalfCut) {
      if (link.kind === 'bar') clB = 0;
      else clA = 0;
    }
    if (!isPivot(link, clA, clB)) return [clA, clB];

    // Find nearest valid grid hole on the metal
    let bestDist = Infinity;
    let best = [clA, clB];
    const aStart = Math.round(r.aMin / GRID);
    const aEnd = Math.round(r.aMax / GRID);
    const bStart = Math.round(r.bMin / GRID);
    const bEnd = Math.round(r.bMax / GRID);

    if (isHalfCut && link.kind === 'bar') {
      for (let ia = aStart; ia <= aEnd; ia++) {
        const ha = ia * GRID;
        if (!isPivot(link, ha, 0)) {
          const d = Math.abs(ha - clA);
          if (d < bestDist) {
            bestDist = d;
            best = [ha, 0];
          }
        }
      }
    } else if (isHalfCut && link.kind !== 'bar') {
      for (let ib = bStart; ib <= bEnd; ib++) {
        const hb = ib * GRID;
        if (!isPivot(link, 0, hb)) {
          const d = Math.abs(hb - clB);
          if (d < bestDist) {
            bestDist = d;
            best = [0, hb];
          }
        }
      }
    } else {
      for (let ia = aStart; ia <= aEnd; ia++) {
        for (let ib = bStart; ib <= bEnd; ib++) {
          const ha = ia * GRID, hb = ib * GRID;
          if (!isPivot(link, ha, hb)) {
            const d = Math.hypot(ha - clA, hb - clB);
            if (d < bestDist) {
              bestDist = d;
              best = [ha, hb];
            }
          }
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // Gravity (virtual work)
  // ------------------------------------------------------------------

  /** returns {struct, payload} so tau_g = struct + f*payload (in*lbf) */
  function gravityTorque(model, F) {
    let struct = 0;
    for (const l of model.links) {
      if (!l.mass) continue;
      const p = pointAt(F[l.idx], l.cg[0], l.cg[1]);
      struct += l.mass * p[3];
    }
    const payload = model.cfg.mass.payload * F[model.end.idx].doy;
    return { struct, payload };
  }

  // ------------------------------------------------------------------
  // Rubber band model
  // ------------------------------------------------------------------

  const BAND_PRESETS = {
    '64': { label: '#64 (3.5" × 1/4")', C0: 7.0, k: 0.5, Jm: 40 },
    '32': { label: '#32 (3" × 1/8")', C0: 6.0, k: 0.25, Jm: 40 },
  };

  /**
   * Strand tension (lbf) vs stretch ratio lambda = loop length / rest loop
   * length. Gent hyperelastic law: soft-ish near rest, roughly linear in the
   * working range, stiffening hard as the chains approach their limit (Jm).
   */
  function makeTension(band) {
    if (band.model === 'table' && band.table && band.table.length >= 2) {
      const pts = band.table
        .map(([d, F]) => [(2 * d) / band.C0, F / 2])
        .filter((p) => isFinite(p[0]) && isFinite(p[1]))
        .sort((p, q) => p[0] - q[0]);
      if (pts[0][0] > 1) pts.unshift([1, 0]);
      return function (lam) {
        if (lam <= 1) return 0;
        let i = 1;
        while (i < pts.length - 1 && pts[i][0] < lam) i++;
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const t = (lam - x0) / (x1 - x0 || 1e-9);
        return Math.max(0, y0 + t * (y1 - y0));
      };
    }
    const k = band.k, Jm = band.Jm;
    return function (lam) {
      if (lam <= 1) return 0;
      const I = lam * lam + 2 / lam - 3;
      const den = Math.max(Jm - I, Jm * 0.02);
      return (k * (lam - 1 / (lam * lam)) * Jm) / den;
    };
  }

  /** perimeter, dP/dtheta and min post separation of a band at frames F */
  function bandGeom(group, F) {
    const pts = group.pts.map((p) => pointAt(F[p.link], p.a, p.b));
    const edges = group.type === 'line' ? [[0, 1]] : [[0, 1], [1, 2], [2, 0]];
    const mult = group.type === 'line' ? 2 : 1;
    let P = 0, dP = 0, minSep = Infinity;
    for (const [i, j] of edges) {
      const ex = pts[i][0] - pts[j][0], ey = pts[i][1] - pts[j][1];
      const d = Math.hypot(ex, ey);
      minSep = Math.min(minSep, d);
      P += d;
      if (d > 1e-9) dP += (ex * (pts[i][2] - pts[j][2]) + ey * (pts[i][3] - pts[j][3])) / d;
    }
    return { P: P * mult, dP: dP * mult, minSep, pts };
  }

  // ------------------------------------------------------------------
  // Band / structure interference
  // ------------------------------------------------------------------

  /** centerline segment of every link (pivot span) in world coords */
  function linkSegments(model, F) {
    const segs = [];
    for (const l of model.links) {
      if (!l.pivots.length) continue;
      let p0, p1;
      if (l.kind === 'bar') { p0 = [0, 0]; p1 = [l.length, 0]; }
      else {
        let lo = Infinity, hi = -Infinity;
        for (const p of l.pivots) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
        if (hi - lo < 1e-9) continue;
        p0 = [0, lo]; p1 = [0, hi];
      }
      const a = pointAt(F[l.idx], p0[0], p0[1]), b = pointAt(F[l.idx], p1[0], p1[1]);
      segs.push({ li: l.idx, x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
    }
    return segs;
  }

  /** strict segment intersection (touching near the ends doesn't count) */
  function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return false;
    const qx = cx - ax, qy = cy - ay;
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * ry - qy * rx) / den;
    const lr = Math.hypot(rx, ry) || 1, ls = Math.hypot(sx, sy) || 1;
    const et = 0.15 / lr, eu = 0.15 / ls;
    return t > et && t < 1 - et && u > eu && u < 1 - eu;
  }

  /** set of link indices whose centerline a band crosses at frames F */
  function bandCrossings(model, group, F, segs) {
    segs = segs || linkSegments(model, F);
    const pts = group.pts.map((p) => pointAt(F[p.link], p.a, p.b));
    const edges = group.type === 'line' ? [[0, 1]] : [[0, 1], [1, 2], [2, 0]];
    const hit = new Set();
    for (const [i, j] of edges) {
      const li = group.pts[i].link, lj = group.pts[j].link;
      for (const s of segs) {
        if (s.li === li || s.li === lj) continue;
        if (segCross(pts[i][0], pts[i][1], pts[j][0], pts[j][1], s.x0, s.y0, s.x1, s.y1)) hit.add(s.li);
      }
    }
    return hit;
  }

  // ------------------------------------------------------------------
  // Full evaluation over the range of motion (used for charts/stats)
  // ------------------------------------------------------------------

  function linspace(a, b, n) {
    const r = new Array(n);
    for (let i = 0; i < n; i++) r[i] = a + ((b - a) * i) / (n - 1);
    return r;
  }

  /**
   * evaluate(model, groups, band, opts, N)
   * groups: [{type, pts:[{link,a,b}], n, m}]
   * returns per-angle arrays.
   */
  function evaluate(model, groups, band, opts, N) {
    const cfg = model.cfg;
    const thetas = linspace(cfg.thetaMin * DEG, cfg.thetaMax * DEG, N || 121);
    const T = makeTension(band);
    const sides = cfg.mass.sides;
    const wrap = Math.PI * band.postD;
    const out = {
      thetas, deg: thetas.map((t) => t / DEG),
      gEmpty: [], gLoaded: [], gDesign: [], band: [], netEmpty: [], netLoaded: [], netDesign: [],
      height: [], dHeight: [],
      groups: groups.map(() => ({ P: [], lam: [], T: [], tau: [], minSep: [], crosses: new Set(), crossFrac: 0 })),
    };
    const f = opts.designFrac;
    for (const th of thetas) {
      const F = framesAt(model, th);
      const g = gravityTorque(model, F);
      const segs = linkSegments(model, F);
      let tb = 0;
      groups.forEach((grp, gi) => {
        const geo = bandGeom(grp, F);
        const lam = (grp.n * (geo.P + wrap)) / band.C0;
        const ten = T(lam);
        const tau = sides * grp.m * grp.n * ten * geo.dP;
        const o = out.groups[gi];
        o.P.push(geo.P); o.lam.push(lam); o.T.push(ten); o.tau.push(tau); o.minSep.push(geo.minSep);
        const cr = bandCrossings(model, grp, F, segs);
        if (cr.size) { o.crossFrac += 1 / thetas.length; cr.forEach((c) => o.crosses.add(c)); }
        tb += tau;
      });
      const ge = g.struct, gl = g.struct + g.payload, gd = g.struct + f * g.payload;
      out.gEmpty.push(ge); out.gLoaded.push(gl); out.gDesign.push(gd); out.band.push(tb);
      out.netEmpty.push(ge + tb); out.netLoaded.push(gl + tb); out.netDesign.push(gd + tb);
      const e = F[model.end.idx];
      out.height.push(e.oy); out.dHeight.push(e.doy);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Motors
  // ------------------------------------------------------------------
  const V5_STALL_NM = { 100: 2.1, 200: 1.05, 600: 0.35 };

  /** convert torque at theta to motor-shaft torque fraction of stall */
  function motorFraction(tauTheta, drive) {
    const stallInLb = (V5_STALL_NM[drive.rpm] || 1.05) / INLB_TO_NM;
    const tauDrive = tauTheta / (drive.location === 'middle' ? 2 : 1);
    const tauMotor = tauDrive / drive.ratio;
    return Math.abs(tauMotor) / (drive.motors * stallInLb);
  }

  root.LiftPhysics = {
    DEG, GRID, INLB_TO_NM, BAND_PRESETS, V5_STALL_NM,
    snap, inToHoles, holesToIn, parseReduction,
    buildModel, framesAt, pointAt, worldToLocal, linkRange, isPivot, nearestNonPivot,
    gravityTorque, makeTension, bandGeom, evaluate, linspace, motorFraction,
    linkSegments, segCross, bandCrossings,
  };
})(typeof window !== 'undefined' ? window : globalThis);
