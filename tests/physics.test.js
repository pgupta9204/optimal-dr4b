// Physics + optimizer sanity tests.  Run:  node tests/physics.test.js
require('../js/physics.js');
require('../js/optimizer.js');
const LP = globalThis.LiftPhysics;
const LO = globalThis.LiftOptimizer;

let fails = 0;
function check(name, cond, info) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : ''));
  if (!cond) fails++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const mass = { barDensity: 0, overhang: 0, sides: 1, middleTower: 0, midLink: 0, endEffector: 1, payload: 0 };
const cfgs = {
  '4bar': { stage1: { type: '4bar', L: 15, s: 3 }, stage2: { type: 'none' }, thetaMin: -30, thetaMax: 60, mass },
  '6bar': { stage1: { type: '6bar', L1: 8, L2: 7, s1: 2, s2: 2 }, stage2: { type: 'none' }, thetaMin: -30, thetaMax: 60, mass },
  'dr4b': { stage1: { type: '4bar', L: 12, s: 3 }, stage2: { type: '4bar', L: 12, s: 3, h: 4 }, thetaMin: -20, thetaMax: 70, mass },
  'dr64': { stage1: { type: '6bar', L1: 7, L2: 7, s1: 2, s2: 2 }, stage2: { type: '4bar', L: 14, s: 3, h: 4 }, thetaMin: -20, thetaMax: 70, mass },
};

// 1) gravity torque on a 1 lb end mass = dh/dθ.  4-bar: L cosθ ; 6-bar: (L1+L2) cosθ ; DR: (L1+L2) cosθ
for (const [name, cfg] of Object.entries(cfgs)) {
  const model = LP.buildModel(cfg);
  const reach = name === '4bar' ? 15 : name === '6bar' ? 15 : name === 'dr4b' ? 24 : 28;
  let ok = true, worst = 0;
  for (let d = -30; d <= 70; d += 5) {
    const th = d * LP.DEG;
    const g = LP.gravityTorque(model, LP.framesAt(model, th)).struct;
    worst = Math.max(worst, Math.abs(g - reach * Math.cos(th)));
    if (!near(g, reach * Math.cos(th), 1e-9)) ok = false;
  }
  check(`gravity torque = W·reach·cosθ (${name})`, ok, 'max err ' + worst.toExponential(2));

  // 2) DR4B carriage stays at x = const (vertical travel)
  if (cfg.stage2.type !== 'none') {
    const xs = [-20, 0, 30, 70].map((d) => LP.framesAt(model, d * LP.DEG)[model.end.idx].ox);
    check(`carriage x constant (${name})`, xs.every((x) => near(x, xs[0], 1e-9)), xs.map((x) => x.toFixed(4)).join(','));
  }

  // 3) analytic post velocity vs finite difference, all links, random posts
  let maxErr = 0;
  for (let trial = 0; trial < 200; trial++) {
    const th = (-20 + Math.random() * 90) * LP.DEG;
    const li = Math.floor(Math.random() * model.links.length);
    const a = (Math.random() - 0.3) * 20, b = (Math.random() - 0.5) * 4;
    const h = 1e-6;
    const p = LP.pointAt(LP.framesAt(model, th)[li], a, b);
    const p1 = LP.pointAt(LP.framesAt(model, th + h)[li], a, b);
    const p0 = LP.pointAt(LP.framesAt(model, th - h)[li], a, b);
    maxErr = Math.max(maxErr, Math.abs((p1[0] - p0[0]) / (2 * h) - p[2]), Math.abs((p1[1] - p0[1]) / (2 * h) - p[3]));
  }
  check(`post velocity analytic == finite diff (${name})`, maxErr < 1e-5, 'max err ' + maxErr.toExponential(2));

  // 4) linkage closure: every pivot shared by two links coincides
  const F = LP.framesAt(model, 37 * LP.DEG);
  const worldPivots = [];
  model.links.forEach((l) => l.pivots.forEach((pv) => worldPivots.push(LP.pointAt(F[l.idx], pv[0], pv[1]))));
  // each pivot location should appear at least twice (joint between two links), except none
  let unmatched = 0;
  worldPivots.forEach((p, i) => {
    if (!worldPivots.some((q, j) => j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9)) unmatched++;
  });
  check(`all pivots are shared joints (${name})`, unmatched === 0, unmatched + ' unmatched of ' + worldPivots.length);
}

// 5) band torque from energy: τ = dU/dθ with U = ∫T dℓ (numerical integration check)
{
  const cfg = { ...cfgs.dr4b, mass: { ...mass, sides: 2 } };
  const model = LP.buildModel(cfg);
  const band = { model: 'gent', C0: 7, k: 0.5, Jm: 40, postD: 0.25 };
  const grp = { type: 'tri', n: 2, m: 3, pts: [{ link: 0, a: 0.5, b: 4 }, { link: 1, a: 4, b: 0.5 }, { link: 2, a: 6, b: -0.5 }] };
  const T = LP.makeTension(band);
  const U = (th) => {
    const geo = LP.bandGeom(grp, LP.framesAt(model, th));
    const L = grp.n * (geo.P + Math.PI * band.postD);
    // ∫_{C0}^{L} T(ℓ/C0) dℓ
    let s = 0; const N = 4000; const lo = band.C0;
    if (L <= lo) return 0;
    for (let i = 0; i < N; i++) { const l = lo + ((i + 0.5) * (L - lo)) / N; s += T(l / band.C0); }
    return (s * (L - lo)) / N * cfg.mass.sides * grp.m;
  };
  const th = 25 * LP.DEG, h = 1e-4;
  const num = (U(th + h) - U(th - h)) / (2 * h);
  const ev = LP.evaluate({ ...model, cfg: { ...cfg, thetaMin: 25, thetaMax: 25.0000001 } }, [grp], band, { designFrac: 0 }, 2);
  check('band torque == dU/dθ (energy)', near(ev.band[0], num, 1e-3), `analytic ${ev.band[0].toFixed(4)} vs energy ${num.toFixed(4)}`);
}

// 6) optimizer reduces torque substantially on realistic DR4B / DR6-4B lifts
for (const s1 of [{ type: '4bar', L: 14, s: 3 }, { type: '6bar', L1: 7, L2: 7, s1: 2, s2: 2 }]) {
  const cfg = {
    stage1: s1, stage2: { type: '4bar', L: 14, s: 3, h: 4 },
    thetaMin: -20, thetaMax: 65,
    mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0.4, midLink: 0.1, endEffector: 2.5, payload: 0.6 },
  };
  const model = LP.buildModel(cfg);
  const band = { model: 'gent', C0: 7, k: 0.5, Jm: 40, postD: 0.25 };
  const opts = {
    K: 40, designFrac: 0.5, bias: 0, objective: 'balanced', lamMax: 4.5, lamMin: 1.15, requireTension: true,
    minSep: 0.5, maxBands: 12, barExt: 1, barOff: 1, linkReach: 2, linkExt: 1, maxWraps: 3, avoidCross: true,
  };
  const st1 = model.links.filter((l) => l.stage <= 1 || l.name === 'Middle tower').map((l) => l.idx);
  const st2 = model.links.filter((l) => l.stage === 2 || l.name === 'Middle tower').map((l) => l.idx);
  const groups = [
    { type: 'tri', locked: false, allowed: st1, n: 1, m: 1, pts: [] },
    { type: 'tri', locked: false, allowed: st2, n: 1, m: 1, pts: [] },
  ];
  const ctx = LO.createContext(model, groups, band, opts);
  const t0 = Date.now();
  const res = LO.runSync(ctx, { timeBudgetMs: 2500, seed: 7 });
  const best = res.results[0];
  const gs = best.groups.map((g) => ({ type: 'tri', ...g }));
  const ev = LP.evaluate(model, gs, band, opts, 91);
  const maxG = Math.max(...ev.gDesign.map(Math.abs));
  const maxNet = Math.max(...ev.netDesign.map(Math.abs));
  console.log(`   [${s1.type} bottom] ${res.restarts} restarts, ${res.evals} evals in ${Date.now() - t0} ms; cost ${best.cost.toFixed(4)}`);
  gs.forEach((g, i) => console.log(`   group ${i}: n=${g.n} m=${g.m} ` + g.pts.map((p) => `${model.links[p.link].short}(${p.a},${p.b})`).join(' | ') +
    `  λ ${Math.min(...ev.groups[i].lam).toFixed(2)}–${Math.max(...ev.groups[i].lam).toFixed(2)} cross ${(ev.groups[i].crossFrac * 100).toFixed(0)}%`));
  check(`optimizer cuts peak torque by >60% (${s1.type} bottom)`, maxNet < 0.4 * maxG, `unbanded ${maxG.toFixed(1)} in·lbf → ${maxNet.toFixed(1)} in·lbf`);
  check('all posts on 0.5" grid', gs.every((g) => g.pts.every((p) => Number.isInteger(p.a * 2) && Number.isInteger(p.b * 2))));
}

// Test halfCut skeleton mode: posts must have b=0 on bars and a=0 on uprights/towers, strictly ON THE METAL
{
  const cfg = {
    stage1: { type: '6bar', L1: 7, L2: 7, s1: 2.5, s2: 2.5 },
    stage2: { type: '4bar', L: 14, s: 3.0, h: 4.5 },
    thetaMin: -25, thetaMax: 65,
    mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0.45, midLink: 0.12, endEffector: 2.2, payload: 0.5 },
  };
  const model = LP.buildModel(cfg);
  const band = { model: 'gent', C0: 7, k: 0.5, Jm: 40, postD: 0.25 };
  const opts = {
    K: 40, designFrac: 0.5, bias: 0, objective: 'balanced', lamMax: 4.0, lamMin: 1.15, requireTension: true,
    minSep: 0.5, maxBands: 12, maxWraps: 2, avoidCross: true,
    halfCut: true,
  };
  const st1 = model.links.filter((l) => l.stage <= 1 || l.name === 'Middle tower').map((l) => l.idx);
  const st2 = model.links.filter((l) => l.stage === 2 || l.name === 'Middle tower').map((l) => l.idx);
  const groups = [
    { type: 'tri', locked: false, allowed: st1, n: 1, m: 1, pts: [] },
    { type: 'tri', locked: false, allowed: st2, n: 1, m: 1, pts: [] },
  ];
  const ctx = LO.createContext(model, groups, band, opts);
  const res = LO.runSync(ctx, { timeBudgetMs: 2000, seed: 42 });
  const best = res.results[0];
  const gs = best.groups.map((g) => ({ type: 'tri', ...g }));
  const ev = LP.evaluate(model, gs, band, opts, 91);
  const maxG = Math.max(...ev.gDesign.map(Math.abs));
  const maxNet = Math.max(...ev.netDesign.map(Math.abs));

  const allOnMetal = gs.every((g) =>
    g.pts.every((p) => {
      const l = model.links[p.link];
      if (l.kind === 'bar') {
        return p.a >= 0 && p.a <= l.length && Math.abs(p.b) < 1e-6;
      }
      let hi = -Infinity;
      for (const piv of l.pivots) hi = Math.max(hi, piv[1]);
      return Math.abs(p.a) < 1e-6 && p.b >= 0 && p.b <= hi + 0.5;
    })
  );

  // Check that every post is at least 2 holes away (>= 1.0") from any pivot on that link
  // (never on a pivot joint 0.0", and never 1 hole away 0.5" due to gear mounting / bearing flats)
  const allClearOfPivots = gs.every((g) =>
    g.pts.every((p) => {
      const l = model.links[p.link];
      return l.pivots.every((piv) => Math.hypot(p.a - piv[0], p.b - piv[1]) >= 0.9);
    })
  );

  const noneOnPivotsOrGears = gs.every((g) =>
    g.pts.every((p) => !LP.isPivot(model.links[p.link], p.a, p.b))
  );

  check('halfCut posts are strictly ON THE METAL (a in [0, L] and b=0 for bars; a=0 and b in [0, hi+0.5] for uprights)', allOnMetal);
  check('no posts on pivots or 1 hole away (dist >= 1.0" / 2 holes for gear/bearing clearance)', allClearOfPivots);
  check('no posts in forbidden pivot/gear envelope (isPivot returns false)', noneOnPivotsOrGears);
  check('halfCut optimizer achieves >60% torque reduction on DR6-4B', maxNet < 0.4 * maxG, `unbanded ${maxG.toFixed(1)} in·lbf → ${maxNet.toFixed(1)} in·lbf`);

  // Exhaustive nearestNonPivot test across all links and hole ranges
  let nearestFailures = 0;
  for (const link of model.links) {
    const r = LP.linkRange(link, { halfCut: true });
    for (let testVal = 0; testVal <= (link.kind === 'bar' ? link.length : 8); testVal += 0.5) {
      const a = link.kind === 'bar' ? testVal : 0;
      const b = link.kind === 'bar' ? 0 : testVal;
      const [na, nb] = LP.nearestNonPivot(link, a, b, { halfCut: true });
      if (LP.isPivot(link, na, nb)) nearestFailures++;
    }
  }
  check('nearestNonPivot always snaps to valid, compliant hole on metal', nearestFailures === 0, `failures: ${nearestFailures}`);
}

// 7) Unit conversion math: holes = inches * 2 + 1 (e.g. 0.5" -> 2 holes, 1.0" -> 3 holes)
{
  check('inToHoles(0.0) == 1', LP.inToHoles(0.0) === 1);
  check('inToHoles(0.5) == 2', LP.inToHoles(0.5) === 2);
  check('inToHoles(1.0) == 3', LP.inToHoles(1.0) === 3);
  check('inToHoles(1.5) == 4', LP.inToHoles(1.5) === 4);
  check('inToHoles(14.0) == 29', LP.inToHoles(14.0) === 29);
  check('holesToIn(1) == 0.0"', LP.holesToIn(1) === 0.0);
  check('holesToIn(2) == 0.5"', LP.holesToIn(2) === 0.5);
  check('holesToIn(3) == 1.0"', LP.holesToIn(3) === 1.0);
  check('holesToIn(4) == 1.5"', LP.holesToIn(4) === 1.5);
  check('holesToIn(29) == 14.0"', LP.holesToIn(29) === 14.0);

  let roundTripOk = true;
  for (let d = 0; d <= 35; d += 0.5) {
    if (Math.abs(LP.holesToIn(LP.inToHoles(d)) - d) > 1e-9) roundTripOk = false;
  }
  check('inToHoles <-> holesToIn exact round-trip up to 35"', roundTripOk);
}

// 8) Custom Gear Reduction parsing
{
  check('parseReduction("1:5") == 5', near(LP.parseReduction('1:5'), 5.0, 1e-4));
  check('parseReduction("1:7") == 7', near(LP.parseReduction('1:7'), 7.0, 1e-4));
  check('parseReduction("3:7") == 2.333', near(LP.parseReduction('3:7'), 7 / 3, 1e-4));
  check('parseReduction("1:15") == 15', near(LP.parseReduction('1:15'), 15.0, 1e-4));
  check('parseReduction("60/12") == 5', near(LP.parseReduction('60/12'), 5.0, 1e-4));
  check('parseReduction("12:60 * 12:36") == 15 (compound)', near(LP.parseReduction('12:60 * 12:36'), 15.0, 1e-4));
  check('parseReduction("12:84 x 12:36") == 21 (compound)', near(LP.parseReduction('12:84 x 12:36'), 21.0, 1e-4));
  check('parseReduction("8.5") == 8.5', near(LP.parseReduction('8.5'), 8.5, 1e-4));
}

console.log(fails ? `\n${fails} FAILED` : '\nall tests passed');
process.exit(fails ? 1 : 0);
