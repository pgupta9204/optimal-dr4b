/*
 * app.js — Main application logic for VEX DR4B & 6-Bar Banding Optimizer.
 */
(function () {
  'use strict';
  const LP = window.LiftPhysics;
  const LO = window.LiftOptimizer;

  function trackEvent(name, props) {
    if (window.VexAnalytics && typeof window.VexAnalytics.track === 'function') {
      window.VexAnalytics.track(name, props);
    }
  }

  // Preset Linkage Configurations
  const PRESETS = {
    'dr64': {
      name: 'Compact DR6-4B (Bottom 6-Bar + Top 4-Bar)',
      stage1: { type: '6bar', L1: 7, L2: 7, s1: 2.5, s2: 2.5 },
      stage2: { type: '4bar', L: 14, s: 3.0, h: 4.5 },
      thetaMin: -25, thetaMax: 65,
      mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0.45, midLink: 0.12, endEffector: 2.2, payload: 0.5 },
      bands: [
        {
          type: 'tri', locked: false, n: 2, m: 10,
          pts: [{ link: 4, a: 6.0, b: 0.0 }, { link: 4, a: 4.0, b: 0.0 }, { link: 5, a: 0.0, b: 1.0 }]
        },
        {
          type: 'tri', locked: false, n: 1, m: 2,
          pts: [{ link: 7, a: 6.5, b: 0.0 }, { link: 7, a: 1.5, b: 0.0 }, { link: 5, a: 0.0, b: 6.0 }]
        }
      ]
    },
    'dr4b': {
      name: 'Standard DR4B (Double Reverse 4-Bar - 14")',
      stage1: { type: '4bar', L: 14, s: 3.0 },
      stage2: { type: '4bar', L: 14, s: 3.0, h: 4.5 },
      thetaMin: -25, thetaMax: 65,
      mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0.4, midLink: 0.1, endEffector: 2.0, payload: 0.5 },
      bands: [
        {
          type: 'tri', locked: false, n: 2, m: 9,
          pts: [{ link: 3, a: 0.0, b: 2.0 }, { link: 2, a: 11.5, b: 0.0 }, { link: 3, a: 0.0, b: 1.0 }]
        },
        {
          type: 'tri', locked: false, n: 1, m: 4,
          pts: [{ link: 3, a: 0.0, b: 6.0 }, { link: 5, a: 4.5, b: 0.0 }, { link: 4, a: 1.5, b: 0.0 }]
        }
      ]
    },
    'dr6b': {
      name: 'Full DR6B (Double Reverse 6-Bar - 7+7" / 7+7")',
      stage1: { type: '6bar', L1: 7, L2: 7, s1: 2.5, s2: 2.5 },
      stage2: { type: '6bar', L1: 7, L2: 7, s1: 2.5, s2: 2.5, h: 4.5 },
      thetaMin: -25, thetaMax: 65,
      mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0.5, midLink: 0.12, endEffector: 2.2, payload: 0.5 },
      bands: [
        {
          type: 'tri', locked: false, n: 2, m: 1,
          pts: [{ link: 2, a: 5.5, b: 0.0 }, { link: 3, a: 0.0, b: 4.0 }, { link: 2, a: 5.0, b: 0.0 }]
        },
        {
          type: 'tri', locked: false, n: 2, m: 10,
          pts: [{ link: 8, a: 0.0, b: 4.0 }, { link: 7, a: 10.0, b: 0.0 }, { link: 7, a: 8.0, b: 0.0 }]
        }
      ]
    },
    'single4b': {
      name: 'Single 4-Bar (15" Arm)',
      stage1: { type: '4bar', L: 15, s: 3.5 },
      stage2: { type: 'none' },
      thetaMin: -30, thetaMax: 65,
      mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0, midLink: 0, endEffector: 1.5, payload: 0.5 },
      bands: [
        {
          type: 'tri', locked: false, n: 1, m: 3,
          pts: [{ link: 3, a: 0.0, b: 2.5 }, { link: 2, a: 10.5, b: 0.0 }, { link: 2, a: 2.5, b: 0.0 }]
        }
      ]
    },
    'single6b': {
      name: 'Single 6-Bar (8" + 7" Arms)',
      stage1: { type: '6bar', L1: 8, L2: 7, s1: 2.5, s2: 2.5 },
      stage2: { type: 'none' },
      thetaMin: -30, thetaMax: 65,
      mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0, midLink: 0.12, endEffector: 1.6, payload: 0.5 },
      bands: [
        {
          type: 'tri', locked: false, n: 1, m: 8,
          pts: [{ link: 4, a: 5.0, b: 0.0 }, { link: 2, a: 13.5, b: 0.0 }, { link: 4, a: 1.0, b: 0.0 }]
        }
      ]
    },
    'high_dr4b': {
      name: 'High-Reach DR4B (17.5" / 35-Hole Arms)',
      stage1: { type: '4bar', L: 17.5, s: 3.5 },
      stage2: { type: '4bar', L: 17.5, s: 3.5, h: 5.0 },
      thetaMin: -25, thetaMax: 65,
      mass: { barDensity: 0.0075, overhang: 0.5, sides: 2, middleTower: 0.45, midLink: 0.1, endEffector: 2.4, payload: 0.5 },
      bands: [
        {
          type: 'tri', locked: false, n: 2, m: 5,
          pts: [{ link: 3, a: 0.0, b: 1.0 }, { link: 2, a: 16.0, b: 0.0 }, { link: 1, a: 16.5, b: 0.0 }]
        },
        {
          type: 'tri', locked: false, n: 2, m: 12,
          pts: [{ link: 4, a: 1.0, b: 0.0 }, { link: 3, a: 0.0, b: 7.5 }, { link: 4, a: 1.5, b: 0.0 }]
        }
      ]
    }
  };

  // State
  let currentConfig = JSON.parse(JSON.stringify(PRESETS['dr64']));
  let model = null;
  let bandGroups = JSON.parse(JSON.stringify(PRESETS['dr64'].bands));
  let bandPreset = LP.BAND_PRESETS['64'];
  let currentTheta = 15 * LP.DEG;
  let isPlaying = false;
  let playDirection = 1;
  let animFrameId = null;
  let optimizerTask = null;

  // Unit mode: 'in' (inches) or 'holes' (VEX hole count, holes = in * 2 + 1)
  let currentUnit = 'in';

  // Motor drive state
  let motorConfig = {
    motors: 2,
    rpm: 200,
    ratio: 5.0, // 1:5 external
    ratioStr: '1:5',
    isCustom: false,
    location: 'middle', // 'base' or 'middle'
  };

  // Unit conversion helpers
  function inToHoles(inches) {
    return LP.inToHoles ? LP.inToHoles(inches) : Math.round(inches * 2 + 1);
  }

  function holesToIn(holes) {
    return LP.holesToIn ? LP.holesToIn(holes) : Math.max(0, (holes - 1) * 0.5);
  }

  function getDimValue(id, defInches) {
    const el = document.getElementById(id);
    if (!el) return defInches;
    const raw = parseFloat(el.value);
    if (isNaN(raw)) return defInches;
    return currentUnit === 'holes' ? holesToIn(raw) : raw;
  }

  function setDimValue(id, inches) {
    const el = document.getElementById(id);
    if (!el) return;
    if (currentUnit === 'holes') {
      el.value = inToHoles(inches);
      el.step = '1';
      el.min = '1';
    } else {
      el.value = inches;
      el.step = '0.5';
      el.min = '0';
    }
  }

  function setUnit(newUnit) {
    if (newUnit !== 'in' && newUnit !== 'holes') return;
    if (currentUnit === newUnit) return;
    currentUnit = newUnit;
    renderer.options.unit = currentUnit;
    trackEvent('unit_toggled', { unit: newUnit });

    // Update switcher buttons
    document.querySelectorAll('#unitToggle .unit-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-unit') === currentUnit);
    });

    // Update label text
    document.querySelectorAll('.dim-unit').forEach((el) => {
      el.textContent = currentUnit === 'holes' ? '(holes)' : '(in)';
    });

    // Re-sync input fields with current dimensions
    syncInputsFromConfig();
    renderBandGroups();
    updateBuildGuide();
    renderer.render();
  }

  // DOM Elements
  const canvas = document.getElementById('liftCanvas');
  const renderer = new window.LiftRenderer(canvas, { unit: currentUnit });

  const angleSlider = document.getElementById('angleSlider');
  const angleDisplay = document.getElementById('angleDisplay');
  const btnPlay = document.getElementById('btnPlay');
  const btnStepFwd = document.getElementById('btnStepFwd');
  const btnStepBack = document.getElementById('btnStepBack');
  const btnResetView = document.getElementById('btnResetView');
  const presetSelect = document.getElementById('presetSelect');

  // Chart canvases
  const chartTorqueCv = document.getElementById('chartTorque');
  const chartMotorCv = document.getElementById('chartMotor');
  const chartStretchCv = document.getElementById('chartStretch');
  const chartHeightCv = document.getElementById('chartHeight');

  // Optimizer elements
  const btnRunOptimizer = document.getElementById('btnRunOptimizer');
  const optimizerProgress = document.getElementById('optimizerProgress');
  const optimizerProgressBar = document.getElementById('optimizerProgressBar');
  const optimizerStatus = document.getElementById('optimizerStatus');
  const candidateList = document.getElementById('candidateList');

  // Initialize
  function init() {
    loadPreset('dr64');
    setupEventListeners();
    setupTabs();
    window.addEventListener('resize', () => {
      renderer.resize();
      updateChartsAndMetrics();
    });

    // Check URL Hash for shared config
    if (window.location.hash.length > 2) {
      loadFromHash();
    }
  }

  function loadPreset(key) {
    if (!PRESETS[key]) return;
    const p = PRESETS[key];
    currentConfig = JSON.parse(JSON.stringify(p));
    bandGroups = JSON.parse(JSON.stringify(p.bands));
    trackEvent('preset_selected', { preset: key, name: p.name });

    // Update Form Inputs
    syncInputsFromConfig();
    rebuildModel();
  }

  function syncInputsFromConfig() {
    // Stage 1
    document.getElementById('s1_type').value = currentConfig.stage1.type;
    toggleStage1Inputs();
    if (currentConfig.stage1.type === '4bar') {
      setDimValue('s1_4b_L', currentConfig.stage1.L);
      setDimValue('s1_4b_s', currentConfig.stage1.s);
    } else {
      setDimValue('s1_6b_L1', currentConfig.stage1.L1);
      setDimValue('s1_6b_L2', currentConfig.stage1.L2);
      setDimValue('s1_6b_s1', currentConfig.stage1.s1);
      setDimValue('s1_6b_s2', currentConfig.stage1.s2);
    }

    // Stage 2
    document.getElementById('s2_type').value = currentConfig.stage2.type;
    toggleStage2Inputs();
    if (currentConfig.stage2.type !== 'none') {
      setDimValue('s2_L', currentConfig.stage2.L || currentConfig.stage2.L1 || 14);
      setDimValue('s2_s', currentConfig.stage2.s || currentConfig.stage2.s1 || 3.0);
      setDimValue('s2_h', currentConfig.stage2.h || 4.5);
    }

    // Angles
    document.getElementById('thetaMin').value = currentConfig.thetaMin;
    document.getElementById('thetaMax').value = currentConfig.thetaMax;
    angleSlider.min = currentConfig.thetaMin;
    angleSlider.max = currentConfig.thetaMax;
    angleSlider.value = Math.max(currentConfig.thetaMin, Math.min(currentConfig.thetaMax, 15));
    currentTheta = parseFloat(angleSlider.value) * LP.DEG;

    // Masses
    document.getElementById('mass_endEffector').value = currentConfig.mass.endEffector;
    document.getElementById('mass_payload').value = currentConfig.mass.payload;
    document.getElementById('mass_middleTower').value = currentConfig.mass.middleTower;
  }

  function readConfigFromInputs() {
    const s1Type = document.getElementById('s1_type').value;
    if (s1Type === '4bar') {
      currentConfig.stage1 = {
        type: '4bar',
        L: getDimValue('s1_4b_L', 14),
        s: getDimValue('s1_4b_s', 3.0),
      };
    } else {
      currentConfig.stage1 = {
        type: '6bar',
        L1: getDimValue('s1_6b_L1', 7),
        L2: getDimValue('s1_6b_L2', 7),
        s1: getDimValue('s1_6b_s1', 2.5),
        s2: getDimValue('s1_6b_s2', 2.5),
      };
    }

    const s2Type = document.getElementById('s2_type').value;
    if (s2Type === 'none') {
      currentConfig.stage2 = { type: 'none' };
    } else if (s2Type === '4bar') {
      currentConfig.stage2 = {
        type: '4bar',
        L: getDimValue('s2_L', 14),
        s: getDimValue('s2_s', 3.0),
        h: getDimValue('s2_h', 4.5),
      };
    } else {
      currentConfig.stage2 = {
        type: '6bar',
        L1: getDimValue('s2_L', 14) / 2 || 7,
        L2: getDimValue('s2_L', 14) / 2 || 7,
        s1: getDimValue('s2_s', 2.5),
        s2: getDimValue('s2_s', 2.5),
        h: getDimValue('s2_h', 4.5),
      };
    }

    currentConfig.thetaMin = parseFloat(document.getElementById('thetaMin').value) || -25;
    currentConfig.thetaMax = parseFloat(document.getElementById('thetaMax').value) || 65;

    currentConfig.mass.endEffector = parseFloat(document.getElementById('mass_endEffector').value) || 2.0;
    currentConfig.mass.payload = parseFloat(document.getElementById('mass_payload').value) || 0.5;
    currentConfig.mass.middleTower = parseFloat(document.getElementById('mass_middleTower').value) || 0.4;
    currentConfig.mass.sides = parseInt(document.getElementById('mass_sides').value) || 2;
    currentConfig.mass.barDensity = parseFloat(document.getElementById('mat_density').value) || 0.0075;

    // Motor config
    motorConfig.motors = parseInt(document.getElementById('motor_count').value) || 2;
    motorConfig.rpm = parseInt(document.getElementById('motor_cartridge').value) || 200;
    motorConfig.location = document.getElementById('motor_location').value;

    const ratioSelect = document.getElementById('motor_ratio');
    const customRatioContainer = document.getElementById('custom_ratio_container');
    const customInput = document.getElementById('custom_motor_ratio');
    const customDisplay = document.getElementById('custom_ratio_display');

    if (ratioSelect.value === 'custom') {
      customRatioContainer.style.display = 'block';
      motorConfig.isCustom = true;
      const str = customInput.value.trim() || '1:5';
      const parsed = LP.parseReduction(str);
      motorConfig.ratio = parsed;
      motorConfig.ratioStr = str;
      if (customDisplay) customDisplay.textContent = `1:${parsed.toFixed(1)} (${parsed.toFixed(1)}×)`;
    } else {
      customRatioContainer.style.display = 'none';
      motorConfig.isCustom = false;
      const val = parseFloat(ratioSelect.value) || 5.0;
      motorConfig.ratio = val;
      motorConfig.ratioStr = `1:${val}`;
      if (customInput) customInput.value = `1:${val}`;
    }

    // Band preset
    const bType = document.getElementById('band_type').value;
    bandPreset = { ...LP.BAND_PRESETS[bType] };
    bandPreset.postD = parseFloat(document.getElementById('standoff_dia').value) || 0.25;

    // Slider bounds
    angleSlider.min = currentConfig.thetaMin;
    angleSlider.max = currentConfig.thetaMax;
  }

  function rebuildModel() {
    readConfigFromInputs();
    model = LP.buildModel(currentConfig);

    // Validate band group link indices
    validateBandGroups();

    renderer.setModel(model, bandGroups, bandPreset);
    renderer.setTheta(currentTheta);
    renderer.fitView();

    renderBandGroupsUI();
    updateChartsAndMetrics();
    updateBuildGuide();
  }

  function validateBandGroups() {
    const numLinks = model.links.length;
    const isHalfCut = renderer.options.halfCut !== false;
    bandGroups.forEach((g) => {
      g.pts.forEach((p) => {
        if (p.link >= numLinks) {
          p.link = 1; // reset to safe link
        }
        const link = model.links[p.link];
        const [clA, clB] = LP.nearestNonPivot(link, p.a, p.b, { halfCut: isHalfCut });
        p.a = clA;
        p.b = clB;
      });
    });
  }

  function toggleStage1Inputs() {
    const type = document.getElementById('s1_type').value;
    document.getElementById('s1_4bar_inputs').style.display = type === '4bar' ? 'grid' : 'none';
    document.getElementById('s1_6bar_inputs').style.display = type === '6bar' ? 'grid' : 'none';
  }

  function toggleStage2Inputs() {
    const type = document.getElementById('s2_type').value;
    document.getElementById('s2_inputs').style.display = type !== 'none' ? 'grid' : 'none';
  }

  function setupEventListeners() {
    // Unit Switcher (Inches vs Holes)
    document.querySelectorAll('#unitToggle .unit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const u = e.currentTarget.getAttribute('data-unit');
        setUnit(u);
      });
    });

    // Custom Gear Reduction
    const motorRatioSelect = document.getElementById('motor_ratio');
    const customRatioContainer = document.getElementById('custom_ratio_container');
    const customMotorRatio = document.getElementById('custom_motor_ratio');
    const customRatioDisplay = document.getElementById('custom_ratio_display');

    if (motorRatioSelect) {
      motorRatioSelect.addEventListener('change', () => {
        if (motorRatioSelect.value === 'custom') {
          customRatioContainer.style.display = 'block';
          motorConfig.isCustom = true;
          const str = customMotorRatio.value.trim() || '1:5';
          const parsed = LP.parseReduction(str);
          motorConfig.ratio = parsed;
          motorConfig.ratioStr = str;
          if (customRatioDisplay) customRatioDisplay.textContent = `1:${parsed.toFixed(1)} (${parsed.toFixed(1)}×)`;
        } else {
          customRatioContainer.style.display = 'none';
          motorConfig.isCustom = false;
          const val = parseFloat(motorRatioSelect.value) || 5.0;
          motorConfig.ratio = val;
          motorConfig.ratioStr = `1:${val}`;
          if (customMotorRatio) customMotorRatio.value = `1:${val}`;
        }
        rebuildModel();
      });
    }

    if (customMotorRatio) {
      customMotorRatio.addEventListener('input', () => {
        const str = customMotorRatio.value.trim();
        const parsed = LP.parseReduction(str);
        motorConfig.ratio = parsed;
        motorConfig.ratioStr = str;
        if (customRatioDisplay) customRatioDisplay.textContent = `1:${parsed.toFixed(1)} (${parsed.toFixed(1)}×)`;
        updateChartsAndMetrics();
      });
    }

    // Presets
    presetSelect.addEventListener('change', (e) => {
      loadPreset(e.target.value);
    });

    // Form inputs triggers
    const triggerInputs = [
      's1_type', 's1_4b_L', 's1_4b_s', 's1_6b_L1', 's1_6b_L2', 's1_6b_s1', 's1_6b_s2',
      's2_type', 's2_L', 's2_s', 's2_h', 'thetaMin', 'thetaMax',
      'mass_endEffector', 'mass_payload', 'mass_middleTower', 'mass_sides', 'mat_density',
      'motor_count', 'motor_cartridge', 'motor_ratio', 'motor_location',
      'band_type', 'standoff_dia'
    ];

    triggerInputs.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          if (id === 's1_type') toggleStage1Inputs();
          if (id === 's2_type') toggleStage2Inputs();
          rebuildModel();
        });
      }
    });

    // Scrubber
    angleSlider.addEventListener('input', (e) => {
      currentTheta = parseFloat(e.target.value) * LP.DEG;
      angleDisplay.textContent = Math.round(e.target.value) + '°';
      renderer.setTheta(currentTheta);
      updateChartsAndMetrics();
    });

    // Playback
    btnPlay.addEventListener('click', togglePlay);
    btnStepFwd.addEventListener('click', () => stepAngle(2));
    btnStepBack.addEventListener('click', () => stepAngle(-2));
    btnResetView.addEventListener('click', () => renderer.fitView());

    // Toolbar overlay chips
    document.querySelectorAll('.tool-chip[data-opt]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const opt = chip.getAttribute('data-opt');
        renderer.options[opt] = !renderer.options[opt];
        chip.classList.toggle('active', renderer.options[opt]);
        if (opt === 'halfCut') {
          if (renderer.options.halfCut) {
            // enforce skeleton line constraint: b=0 on bars, a=0 on uprights/towers
            bandGroups.forEach((g) => {
              g.pts.forEach((p) => {
                const link = model.links[p.link];
                if (link && link.kind === 'bar') p.b = 0;
                else if (link) p.a = 0;
              });
            });
          }
          renderBandGroupsUI();
          updateChartsAndMetrics();
          updateBuildGuide();
        }
        renderer.render();
      });
    });

    // Renderer post drag hook
    renderer.onPostChanged = () => {
      renderBandGroupsUI();
      updateChartsAndMetrics();
      updateBuildGuide();
    };

    // Auto-optimizer button
    btnRunOptimizer.addEventListener('click', runOptimizer);

    // Add group button
    document.getElementById('btnAddGroup').addEventListener('click', () => {
      if (bandGroups.length >= 4) return;
      const s1Links = model.links.filter((l) => l.stage <= 1).map((l) => l.idx);
      bandGroups.push({
        type: 'tri',
        locked: false,
        n: 1,
        m: 3,
        pts: [
          { link: s1Links[0] || 0, a: 2.0, b: 0.0 },
          { link: s1Links[1] || 1, a: 5.0, b: 0.0 },
          { link: s1Links[2] || 2, a: 8.0, b: 0.0 },
        ]
      });
      rebuildModel();
    });

    // Theory & Guide Modal
    document.getElementById('btnTheoryModal').addEventListener('click', () => {
      document.getElementById('theoryModal').classList.add('open');
      trackEvent('theory_modal_opened');
    });
    document.getElementById('btnCloseTheory').addEventListener('click', () => {
      document.getElementById('theoryModal').classList.remove('open');
    });

    // Privacy & Disclaimers Modal
    const btnPrivacy = document.getElementById('btnPrivacyModal');
    const privacyModal = document.getElementById('privacyModal');
    const btnClosePrivacy = document.getElementById('btnClosePrivacy');
    if (btnPrivacy && privacyModal) {
      btnPrivacy.addEventListener('click', () => {
        privacyModal.classList.add('open');
        trackEvent('privacy_modal_opened');
      });
    }
    if (btnClosePrivacy && privacyModal) {
      btnClosePrivacy.addEventListener('click', () => {
        privacyModal.classList.remove('open');
      });
    }

    // Copy Build Sheet
    document.getElementById('btnCopyBuildSheet').addEventListener('click', copyBuildSheet);
    document.getElementById('btnCopyNotebook').addEventListener('click', copyNotebookReport);
    document.getElementById('btnShareURL').addEventListener('click', shareURL);
  }

  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById(btn.getAttribute('data-tab'));
        if (target) target.classList.add('active');
      });
    });
  }

  // Animation Playback
  function togglePlay() {
    isPlaying = !isPlaying;
    btnPlay.innerHTML = isPlaying ? '⏸' : '▶';
    btnPlay.classList.toggle('btn-accent', isPlaying);
    if (isPlaying) {
      animLoop();
    } else {
      cancelAnimationFrame(animFrameId);
    }
  }

  function animLoop() {
    if (!isPlaying) return;
    const minDeg = currentConfig.thetaMin;
    const maxDeg = currentConfig.thetaMax;
    let deg = currentTheta / LP.DEG + playDirection * 0.75;

    if (deg >= maxDeg) {
      deg = maxDeg;
      playDirection = -1;
    } else if (deg <= minDeg) {
      deg = minDeg;
      playDirection = 1;
    }

    currentTheta = deg * LP.DEG;
    angleSlider.value = deg;
    angleDisplay.textContent = Math.round(deg) + '°';
    renderer.setTheta(currentTheta);
    updateChartsAndMetrics();

    animFrameId = requestAnimationFrame(animLoop);
  }

  function stepAngle(deltaDeg) {
    const minDeg = currentConfig.thetaMin;
    const maxDeg = currentConfig.thetaMax;
    let deg = Math.max(minDeg, Math.min(maxDeg, currentTheta / LP.DEG + deltaDeg));
    currentTheta = deg * LP.DEG;
    angleSlider.value = deg;
    angleDisplay.textContent = Math.round(deg) + '°';
    renderer.setTheta(currentTheta);
    updateChartsAndMetrics();
  }

  // Render Band Groups UI Editor
  function renderBandGroupsUI() {
    const container = document.getElementById('bandGroupsContainer');
    container.innerHTML = '';

    bandGroups.forEach((grp, gi) => {
      const card = document.createElement('div');
      card.className = 'group-card';

      const header = document.createElement('div');
      header.className = 'group-card-header';
      header.innerHTML = `
        <span class="group-badge" style="background:${['#0284c7', '#f97316', '#a855f7', '#ec4899'][gi % 4]}">
          Band Group ${gi + 1} (${grp.type.toUpperCase()})
        </span>
        <div style="display:flex;gap:6px;align-items:center;">
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;margin:0;cursor:pointer;">
            <input type="checkbox" ${grp.locked ? 'checked' : ''} data-lock="${gi}"> Lock
          </label>
          ${bandGroups.length > 1 ? `<button class="btn btn-outline btn-sm" style="padding:2px 6px;color:#f87171;" data-del="${gi}">✕</button>` : ''}
        </div>
      `;
      card.appendChild(header);

      // Group Controls: Count m, Wrap n, Type
      const row = document.createElement('div');
      row.className = 'form-row-3';
      row.innerHTML = `
        <div>
          <label>Bands <span class="unit">(per side)</span></label>
          <input type="number" min="1" max="16" value="${grp.m}" data-grp="${gi}" data-field="m">
        </div>
        <div>
          <label>Wraps <span class="unit">(loops)</span></label>
          <select data-grp="${gi}" data-field="n">
            <option value="1" ${grp.n === 1 ? 'selected' : ''}>1× Single</option>
            <option value="2" ${grp.n === 2 ? 'selected' : ''}>2× Doubled</option>
            <option value="3" ${grp.n === 3 ? 'selected' : ''}>3× Tripled</option>
          </select>
        </div>
        <div>
          <label>Geometry</label>
          <select data-grp="${gi}" data-field="type">
            <option value="tri" ${grp.type === 'tri' ? 'selected' : ''}>Triangle</option>
            <option value="line" ${grp.type === 'line' ? 'selected' : ''}>Line (2-pt)</option>
          </select>
        </div>
      `;
      card.appendChild(row);

      // Posts list
      const postLabels = ['A', 'B', 'C'];
      const isHalfCut = !!renderer.options.halfCut;

      grp.pts.forEach((pt, pi) => {
        const pRow = document.createElement('div');
        pRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px;font-size:11px;';

        const linkOptions = model.links.map((l) => `<option value="${l.idx}" ${l.idx === pt.link ? 'selected' : ''}>${l.short || l.name}</option>`).join('');

        const link = model.links[pt.link];
        const isBar = link && link.kind === 'bar';
        const r = LP.linkRange(link, { halfCut: isHalfCut });

        // When halfCut is active:
        // bars have b locked to 0 (no Y-offset)
        // towers/uprights have a locked to 0 (no X-offset)
        const aDisabled = isHalfCut && !isBar;
        const bDisabled = isHalfCut && isBar;

        const isHoles = currentUnit === 'holes';
        const valA = isHoles ? inToHoles(pt.a) : pt.a;
        const minA = isHoles ? inToHoles(r.aMin) : r.aMin;
        const maxA = isHoles ? inToHoles(r.aMax) : r.aMax;
        const stepA = isHoles ? '1' : '0.5';

        const valB = isHoles ? inToHoles(pt.b) : pt.b;
        const minB = isHoles ? inToHoles(r.bMin) : r.bMin;
        const maxB = isHoles ? inToHoles(r.bMax) : r.bMax;
        const stepB = isHoles ? '1' : '0.5';

        const titleA = aDisabled ? 'Locked to tower centerline' : (isHoles ? `Hole #${valA} (${pt.a.toFixed(1)}")` : `${pt.a.toFixed(1)}" (Hole #${inToHoles(pt.a)})`);
        const titleB = bDisabled ? 'Locked to bar centerline' : (isHoles ? `Hole #${valB} (${pt.b.toFixed(1)}")` : `${pt.b.toFixed(1)}" (Hole #${inToHoles(pt.b)})`);

        pRow.innerHTML = `
          <strong style="color:#38bdf8;width:14px;">${postLabels[pi]}</strong>
          <select style="flex:1;" data-post="${gi}-${pi}" data-field="link">${linkOptions}</select>
          <div style="position:relative;display:inline-block;" title="${titleA}">
            <input type="number" step="${stepA}" min="${minA}" max="${maxA}" style="width:58px;${aDisabled ? 'opacity:0.6;background:rgba(15,23,42,0.6);' : ''}" ${aDisabled ? 'disabled' : ''} value="${valA}" data-post="${gi}-${pi}" data-field="a">
          </div>
          <div style="position:relative;display:inline-block;" title="${titleB}">
            <input type="number" step="${stepB}" min="${minB}" max="${maxB}" style="width:58px;${bDisabled ? 'opacity:0.6;background:rgba(15,23,42,0.6);' : ''}" ${bDisabled ? 'disabled' : ''} value="${valB}" data-post="${gi}-${pi}" data-field="b">
          </div>
        `;
        card.appendChild(pRow);
      });

      container.appendChild(card);
    });

    // Wire up events
    container.querySelectorAll('input[data-field], select[data-field]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const gi = parseInt(e.target.getAttribute('data-grp'));
        const field = e.target.getAttribute('data-field');
        if (field === 'm') bandGroups[gi].m = Math.max(1, parseInt(e.target.value) || 1);
        if (field === 'n') bandGroups[gi].n = parseInt(e.target.value) || 1;
        if (field === 'type') {
          bandGroups[gi].type = e.target.value;
          if (bandGroups[gi].type === 'tri' && bandGroups[gi].pts.length < 3) {
            bandGroups[gi].pts.push({ link: 0, a: 0, b: 2 });
          } else if (bandGroups[gi].type === 'line' && bandGroups[gi].pts.length > 2) {
            bandGroups[gi].pts = bandGroups[gi].pts.slice(0, 2);
          }
        }
        rebuildModel();
      });
    });

    container.querySelectorAll('input[data-lock]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const gi = parseInt(e.target.getAttribute('data-lock'));
        bandGroups[gi].locked = e.target.checked;
      });
    });

    container.querySelectorAll('button[data-del]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const gi = parseInt(e.target.getAttribute('data-del'));
        bandGroups.splice(gi, 1);
        rebuildModel();
      });
    });

    container.querySelectorAll('[data-post]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const [gi, pi] = e.target.getAttribute('data-post').split('-').map(Number);
        const field = e.target.getAttribute('data-field');
        if (field === 'link') {
          bandGroups[gi].pts[pi].link = parseInt(e.target.value);
        }
        const link = model.links[bandGroups[gi].pts[pi].link];
        let rawA = bandGroups[gi].pts[pi].a;
        let rawB = bandGroups[gi].pts[pi].b;
        if (field === 'a') {
          const rawVal = parseFloat(e.target.value) || 0;
          rawA = currentUnit === 'holes' ? holesToIn(rawVal) : rawVal;
        }
        if (field === 'b') {
          const rawVal = parseFloat(e.target.value) || 0;
          rawB = currentUnit === 'holes' ? holesToIn(rawVal) : rawVal;
        }
        const [clA, clB] = LP.nearestNonPivot(link, rawA, rawB, { halfCut: renderer.options.halfCut });
        bandGroups[gi].pts[pi].a = clA;
        bandGroups[gi].pts[pi].b = clB;
        rebuildModel();
      });
    });
  }

  // Update Charts & Real-time Metrics
  function updateChartsAndMetrics() {
    if (!model) return;

    const opts = { designFrac: 0.5 };
    const ev = LP.evaluate(model, bandGroups, bandPreset, opts, 121);

    // Compute peak torques and reductions
    const maxG = Math.max(...ev.gDesign.map(Math.abs));
    const maxNet = Math.max(...ev.netDesign.map(Math.abs));
    const reductionPct = maxG > 0 ? Math.max(0, (1 - maxNet / maxG) * 100) : 0;

    // Motor load at current angle and max across motion
    const curDeg = currentTheta / LP.DEG;
    const curIdx = Math.max(0, Math.min(ev.deg.length - 1, Math.round(((curDeg - currentConfig.thetaMin) / (currentConfig.thetaMax - currentConfig.thetaMin)) * (ev.deg.length - 1))));
    const curNetTorque = ev.netDesign[curIdx];
    const curMotorLoad = LP.motorFraction(curNetTorque, motorConfig) * 100;

    const maxMotorLoad = Math.max(...ev.netDesign.map((tau) => LP.motorFraction(tau, motorConfig) * 100));

    // Stretch range across all groups
    let globalLamMin = Infinity, globalLamMax = -Infinity;
    ev.groups.forEach((g) => {
      g.lam.forEach((l) => {
        globalLamMin = Math.min(globalLamMin, l);
        globalLamMax = Math.max(globalLamMax, l);
      });
    });

    // Update metric cards
    document.getElementById('valPeakTorque').innerHTML = `${maxNet.toFixed(1)} <span class="unit">in·lbf</span>`;
    document.getElementById('valPeakTorqueSub').textContent = `Unbanded: ${maxG.toFixed(1)} in·lbf (${reductionPct.toFixed(0)}% assist)`;

    const motorBadge = maxMotorLoad < 20 ? '<span class="metric-badge badge-success">Optimal</span>' : maxMotorLoad < 40 ? '<span class="metric-badge badge-warning">Moderate</span>' : '<span class="metric-badge badge-danger">High Load</span>';
    document.getElementById('valMotorLoad').innerHTML = `${curMotorLoad.toFixed(0)}% <span class="unit">stall</span> ${motorBadge}`;
    document.getElementById('valMotorLoadSub').textContent = `Peak motion: ${maxMotorLoad.toFixed(0)}% stall`;

    document.getElementById('valStretch').textContent = isFinite(globalLamMin) ? `${globalLamMin.toFixed(2)}× – ${globalLamMax.toFixed(2)}×` : '—';
    const stretchSub = globalLamMax > 4.0 ? '⚠️ High risk of snap' : globalLamMin < 1.05 ? '⚠️ Band goes slack' : '✓ Safe elastic range';
    document.getElementById('valStretchSub').textContent = stretchSub;

    let totalBandsPerSide = 0;
    bandGroups.forEach((g) => (totalBandsPerSide += g.m));
    const totalBandsRobot = totalBandsPerSide * currentConfig.mass.sides;
    document.getElementById('valTotalBands').textContent = `${totalBandsRobot} bands`;
    document.getElementById('valTotalBandsSub').textContent = `(${totalBandsPerSide} per side across ${bandGroups.length} groups)`;

    // Draw Chart 1: Torque
    window.Charts.lineChart(chartTorqueCv, {
      x: ev.deg,
      series: [
        { y: ev.gDesign, color: '#f59e0b', width: 1.5, dash: [4, 3], label: 'Gravity' },
        { y: ev.band, color: '#06b6d4', width: 1.5, dash: [4, 3], label: 'Band Assist' },
        { y: ev.netDesign, color: '#38bdf8', width: 2.2, label: 'Net Torque' },
      ],
      cursorX: curDeg,
      yLabel: 'Torque (in·lbf)',
      includeZero: true,
      fmtY: (v) => v.toFixed(0),
    });

    // Draw Chart 2: Motor Stall %
    const motorLoads = ev.netDesign.map((tau) => LP.motorFraction(tau, motorConfig) * 100);
    window.Charts.lineChart(chartMotorCv, {
      x: ev.deg,
      series: [
        { y: motorLoads, color: maxMotorLoad > 35 ? '#f87171' : '#34d399', width: 2.0, fill: 'rgba(52, 211, 153, 0.12)', label: 'Motor Load %' },
      ],
      hlines: [
        { y: 15, color: '#38bdf8', dash: [4, 4], label: '15% Continuous' },
        { y: 50, color: '#ef4444', dash: [4, 4], label: '50% Stall Limit' },
      ],
      cursorX: curDeg,
      yLabel: 'Stall %',
      includeZero: true,
      yMin: 0,
      yMax: Math.max(60, maxMotorLoad * 1.15),
      fmtY: (v) => v.toFixed(0) + '%',
    });

    // Draw Chart 3: Stretch Ratio Lambda
    const stretchSeries = ev.groups.map((g, i) => ({
      y: g.lam,
      color: ['#0284c7', '#f97316', '#a855f7', '#ec4899'][i % 4],
      width: 1.8,
      label: `Group ${i + 1}`,
    }));
    window.Charts.lineChart(chartStretchCv, {
      x: ev.deg,
      series: stretchSeries,
      hlines: [
        { y: 1.0, color: '#94a3b8', dash: [4, 4], label: 'Slack (1.0×)' },
        { y: 3.8, color: '#ef4444', dash: [4, 4], label: 'Snap Limit (3.8×)' },
      ],
      cursorX: curDeg,
      yLabel: 'Stretch (λ)',
      yMin: 0.8,
      yMax: Math.max(4.2, globalLamMax * 1.1),
      fmtY: (v) => v.toFixed(1) + '×',
    });

    // Draw Chart 4: End Effector Height
    window.Charts.lineChart(chartHeightCv, {
      x: ev.deg,
      series: [
        { y: ev.height, color: '#a855f7', width: 2.0, label: 'Carriage Height' },
      ],
      cursorX: curDeg,
      yLabel: 'Height (in)',
      fmtY: (v) => v.toFixed(1) + '"',
    });
  }

  // Auto-Optimizer Execution
  function runOptimizer() {
    if (optimizerTask) {
      optimizerTask.cancel();
      optimizerTask = null;
      btnRunOptimizer.textContent = '🚀 RUN OPTIMIZER';
      optimizerStatus.textContent = 'Cancelled.';
      return;
    }

    readConfigFromInputs();
    const timeBudgetMs = parseInt(document.getElementById('opt_time').value) || 2500;
    const objective = document.getElementById('opt_objective').value;
    const avoidCross = document.getElementById('opt_avoidCross').checked;
    const maxBands = parseInt(document.getElementById('opt_maxBands').value) || 12;
    const maxWraps = parseInt(document.getElementById('opt_maxWraps').value) || 2;

    const isHalfCut = renderer.options.halfCut !== false;
    const opts = {
      K: 40,
      designFrac: 0.5,
      bias: objective === 'bottom' ? 0.25 : objective === 'top' ? -0.2 : 0.0,
      objective: 'balanced',
      lamMax: 4.0,
      lamMin: 1.15,
      requireTension: true,
      minSep: 0.5,
      maxBands,
      maxWraps,
      avoidCross,
      halfCut: isHalfCut,
    };

    // Partition allowed links for stages to keep banding localized
    bandGroups.forEach((g, gi) => {
      if (model.hasS2) {
        if (gi === 0) {
          g.allowed = model.links.filter((l) => l.stage <= 1 || l.name === 'Middle tower').map((l) => l.idx);
        } else {
          g.allowed = model.links.filter((l) => l.stage === 2 || l.name === 'Middle tower').map((l) => l.idx);
        }
      } else {
        g.allowed = model.links.map((l) => l.idx);
      }
    });

    const ctx = LO.createContext(model, bandGroups, bandPreset, opts);

    trackEvent('optimizer_started', {
      stage1: currentConfig.stage1.type,
      stage2: currentConfig.stage2.type,
      halfCut: isHalfCut,
      budgetMs: timeBudgetMs,
      objective: objective
    });

    btnRunOptimizer.textContent = '⏹ CANCEL OPTIMIZER';
    optimizerProgress.style.display = 'block';
    optimizerProgressBar.style.width = '0%';
    optimizerStatus.textContent = 'Exploring VEX 0.5" grid configurations...';
    candidateList.innerHTML = '';

    const initial = bandGroups.filter((g) => !g.locked).map((g) => ({
      n: g.n,
      pts: g.pts.map((p) => ({ li: p.link, ia: Math.round(p.a / LP.GRID), ib: Math.round(p.b / LP.GRID) }))
    }));

    optimizerTask = LO.run(ctx, {
      timeBudgetMs,
      seed: Date.now() & 0xffff,
      topN: 6,
      initial,
      onProgress: (p) => {
        optimizerProgressBar.style.width = Math.round(p.frac * 100) + '%';
        optimizerStatus.textContent = `${p.restarts} restarts, ${p.evals.toLocaleString()} evals...`;
      },
      onDone: (res) => {
        optimizerTask = null;
        btnRunOptimizer.textContent = '🚀 RUN OPTIMIZER';
        optimizerProgressBar.style.width = '100%';
        optimizerStatus.textContent = `Completed! ${res.restarts} restarts, ${res.evals.toLocaleString()} evals.`;

        if (res.results && res.results.length > 0) {
          const best = res.results[0];
          const maxG = Math.max(...best.ev.gDesign.map(Math.abs));
          const maxNet = Math.max(...best.ev.netDesign.map(Math.abs));
          const redPct = maxG > 0 ? ((1 - maxNet / maxG) * 100) : 0;
          trackEvent('optimizer_completed', {
            stage1: currentConfig.stage1.type,
            stage2: currentConfig.stage2.type,
            reduction_pct: Number(redPct.toFixed(1)),
            restarts: res.restarts,
            evals: res.evals,
            candidates_found: res.results.length
          });
          displayCandidates(res.results);
          // Apply best
          applyCandidate(res.results[0]);
        } else {
          optimizerStatus.textContent = 'No feasible solution found with current constraints.';
          trackEvent('optimizer_completed', {
            stage1: currentConfig.stage1.type,
            stage2: currentConfig.stage2.type,
            reduction_pct: 0,
            restarts: res.restarts,
            evals: res.evals,
            candidates_found: 0
          });
        }
      }
    });
  }

  function displayCandidates(results) {
    candidateList.innerHTML = '<div style="font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:6px;">TOP GRID-SNAPPED DESIGNS:</div>';

    results.forEach((cand, idx) => {
      const card = document.createElement('div');
      card.className = 'candidate-card' + (idx === 0 ? ' selected' : '');

      let bandSummary = '';
      cand.groups.forEach((g) => {
        bandSummary += `G: ${g.m}× (#64) ${g.n > 1 ? `${g.n}w ` : ''}`;
      });

      card.innerHTML = `
        <div>
          <div style="font-weight:700;color:#fff;font-size:12px;">#${idx + 1} Best Fit <span style="color:#38bdf8;font-size:10px;">(Score: ${(1 - cand.fit).toFixed(2)})</span></div>
          <div style="font-size:10px;color:#94a3b8;">${bandSummary} | λ: ${cand.lamMin.toFixed(2)}–${cand.lamMax.toFixed(2)}</div>
        </div>
        <button class="btn btn-outline btn-sm">Apply</button>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.candidate-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        applyCandidate(cand);
      });

      candidateList.appendChild(card);
    });
  }

  function applyCandidate(cand) {
    trackEvent('candidate_applied', {
      peak_torque: cand.peakTorque ? Number(cand.peakTorque.toFixed(1)) : 0
    });
    cand.groups.forEach((cg) => {
      const grp = bandGroups[cg.gi];
      grp.n = cg.n;
      grp.m = cg.m;
      grp.pts = cg.pts.map((p) => ({ link: p.link, a: p.a, b: p.b }));
    });
    rebuildModel();
  }

  // Update VEX Pit Build Guide
  function updateBuildGuide() {
    const list = document.getElementById('buildSheetList');
    if (!list || !model) return;
    list.innerHTML = '';

    const labels = ['A', 'B', 'C', 'D'];
    const isHalfCut = !!renderer.options.halfCut;

    bandGroups.forEach((grp, gi) => {
      const groupEl = document.createElement('div');
      groupEl.style.marginBottom = '12px';

      const groupHeader = document.createElement('div');
      groupHeader.style.cssText = 'font-weight:700;font-size:12px;color:#fff;margin-bottom:6px;display:flex;align-items:center;gap:6px;';
      groupHeader.innerHTML = `
        <span class="group-badge" style="background:${['#0284c7', '#f97316', '#a855f7', '#ec4899'][gi % 4]}">Group ${gi + 1}</span>
        <span>${grp.m}× ${bandPreset.label} bands (${grp.n === 1 ? 'Single loop' : grp.n === 2 ? 'Double looped' : `${grp.n}x looped`})</span>
      `;
      groupEl.appendChild(groupHeader);

      grp.pts.forEach((pt, pi) => {
        const link = model.links[pt.link];
        const step = document.createElement('div');
        step.className = 'build-step';

        const holeIdx = inToHoles(pt.a);
        let locDesc = '';
        if (link.kind === 'bar') {
          if (isHalfCut || pt.b === 0) {
            locDesc = `Hole <code>#${holeIdx}</code> (<code>${pt.a.toFixed(1)}"</code> along bar centerline / skeleton line, no Y-offset)`;
          } else {
            const rowText = pt.b > 0 ? `top hole row (+${pt.b.toFixed(1)}")` : `bottom hole row (${pt.b.toFixed(1)}")`;
            locDesc = `Hole <code>#${holeIdx}</code> from root pivot (distance: <code>${pt.a.toFixed(1)}"</code>), ${rowText}`;
          }
        } else {
          const towerHole = inToHoles(pt.b);
          if (isHalfCut || pt.a === 0) {
            locDesc = `Hole <code>#${towerHole}</code> (<code>${pt.b.toFixed(1)}"</code> along tower vertical centerline / skeleton line, no X-offset)`;
          } else {
            const rowText = pt.a > 0 ? `forward column (+${pt.a.toFixed(1)}")` : `rear column (${pt.a.toFixed(1)}")`;
            locDesc = `Height <code>${pt.b.toFixed(1)}"</code> (Hole #${towerHole} above datum), ${rowText}`;
          }
        }

        step.innerHTML = `
          <strong>Post ${labels[pi]} on ${link.name}</strong>
          <div>Mount a <code>${bandPreset.postD}" OD standoff</code> at: ${locDesc} <span style="color:#34d399;font-size:10px;">✓ Non-pivot hole (≥ 1.0" joint/gear clearance)</span></div>
        `;
        groupEl.appendChild(step);
      });

      list.appendChild(groupEl);
    });
  }

  // Copy build sheet text
  function copyBuildSheet() {
    const isHalfCut = !!renderer.options.halfCut;
    trackEvent('build_sheet_copied', {
      stage1: currentConfig.stage1.type,
      stage2: currentConfig.stage2.type,
      groups: bandGroups.length,
      halfCut: isHalfCut
    });
    let text = `=== VEX TEAM 10015Z ZERO TOLERANCE - BANDING BUILD SHEET ===\n`;
    text += `Linkage: ${currentConfig.stage1.type.toUpperCase()}${currentConfig.stage2.type !== 'none' ? ` + ${currentConfig.stage2.type.toUpperCase()}` : ''}\n`;
    text += `Channel Style: ${isHalfCut ? 'Half-Cut 1x1 C-Channel (Single Hole Centerline Skeleton)' : 'Standard 1x2 C-Channel'}\n`;
    text += `VEX Hole Pitch: holes = in * 2 + 1 (e.g. 0.5" -> 2 holes, 1.0" -> 3 holes, 14" -> 29 holes)\n`;
    text += `External Reduction: 1:${motorConfig.ratio.toFixed(2)} (${motorConfig.ratio.toFixed(1)}x torque multiplication)\n`;
    text += `Band Type: ${bandPreset.label}\n`;
    text += `Pivot Safety: All posts are mounted >= 1.0" (2+ holes) from pivots & clear of gear meshes\n\n`;

    const labels = ['A', 'B', 'C'];
    bandGroups.forEach((grp, gi) => {
      text += `--- BAND GROUP ${gi + 1} ---\n`;
      text += `Bands: ${grp.m}x per side (${grp.n} wrap)\n`;
      grp.pts.forEach((pt, pi) => {
        const link = model.links[pt.link];
        if (link.kind === 'bar') {
          const bNote = (isHalfCut || pt.b === 0) ? '(centerline, no Y-offset)' : `(b=${pt.b.toFixed(1)}")`;
          text += `  Post ${labels[pi]} [${link.name}]: Hole #${inToHoles(pt.a)} (a=${pt.a.toFixed(1)}" ${bNote}, non-pivot)\n`;
        } else {
          const aNote = (isHalfCut || pt.a === 0) ? '(centerline, no X-offset)' : `(a=${pt.a.toFixed(1)}")`;
          text += `  Post ${labels[pi]} [${link.name}]: Hole #${inToHoles(pt.b)} (b=${pt.b.toFixed(1)}" ${aNote}, non-pivot)\n`;
        }
      });
      text += `\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
      alert('Build Sheet copied to clipboard!');
    });
  }

  function copyNotebookReport() {
    const isHalfCut = !!renderer.options.halfCut;
    const opts = { designFrac: 0.5 };
    const ev = LP.evaluate(model, bandGroups, bandPreset, opts, 61);
    const maxG = Math.max(...ev.gDesign.map(Math.abs));
    const maxNet = Math.max(...ev.netDesign.map(Math.abs));
    const reduction = ((1 - maxNet / maxG) * 100).toFixed(1);

    trackEvent('notebook_exported', {
      stage1: currentConfig.stage1.type,
      stage2: currentConfig.stage2.type,
      reduction_pct: Number(reduction),
      motors: motorConfig.motors,
      rpm: motorConfig.rpm,
      halfCut: isHalfCut
    });

    let md = `## Linkage Rubber Band Optimization Report\n`;
    md += `*Engineered by VEX Team 10015Z Zero Tolerance*\n\n`;
    md += `**Mechanism Architecture**: ${currentConfig.stage1.type.toUpperCase()} Stage 1`;
    if (currentConfig.stage2.type !== 'none') md += ` with ${currentConfig.stage2.type.toUpperCase()} Stage 2 (Reverse)`;
    md += `\n**Channel Style**: ${isHalfCut ? 'Half-Cut 1x1 C-Channel (Skeleton Lines, b=0 on bars, a=0 on towers)' : 'Standard 1x2 C-Channel'}\n`;
    md += `\n\n### Kinematic & Torque Performance\n`;
    md += `- **Peak Unassisted Torque**: \`${maxG.toFixed(1)} in·lbf\`\n`;
    md += `- **Peak Net Motor Torque**: \`${maxNet.toFixed(1)} in·lbf\`\n`;
    md += `- **Torque Reduction**: **${reduction}%**\n`;
    md += `- **V5 Motor Configuration**: ${motorConfig.motors}x ${motorConfig.rpm} RPM, 1:${motorConfig.ratio.toFixed(2)} gear ratio (${motorConfig.ratio.toFixed(1)}× reduction)\n`;
    md += `- **Peak Motor Stall Utilization**: \`${Math.max(...ev.netDesign.map((t) => LP.motorFraction(t, motorConfig) * 100)).toFixed(0)}%\`\n\n`;

    md += `### Physical Standoff Coordinates (0.5" VEX Grid: holes = in × 2 + 1)\n`;
    bandGroups.forEach((grp, gi) => {
      md += `#### Band Group ${gi + 1} (${grp.m}x ${bandPreset.label}, ${grp.n}x wrap)\n`;
      grp.pts.forEach((pt, pi) => {
        const link = model.links[pt.link];
        if (link.kind === 'bar') {
          const bDesc = (isHalfCut || pt.b === 0) ? 'centerline (skeleton line, no Y-offset)' : `offset ${pt.b.toFixed(1)}"`;
          md += `- **Post ${['A', 'B', 'C'][pi]}** on *${link.name}*: Hole \`#${inToHoles(pt.a)}\` along bar (\`${pt.a.toFixed(1)}"\`), ${bDesc}\n`;
        } else {
          const aDesc = (isHalfCut || pt.a === 0) ? 'tower vertical centerline (no X-offset)' : `offset ${pt.a.toFixed(1)}"`;
          md += `- **Post ${['A', 'B', 'C'][pi]}** on *${link.name}*: Hole \`#${inToHoles(pt.b)}\` on tower (\`${pt.b.toFixed(1)}"\`), ${aDesc}\n`;
        }
      });
    });

    navigator.clipboard.writeText(md).then(() => {
      alert('Engineering Notebook Markdown copied to clipboard!');
    });
  }

  function shareURL() {
    trackEvent('config_shared', {
      stage1: currentConfig.stage1.type,
      stage2: currentConfig.stage2.type
    });
    const payload = {
      cfg: currentConfig,
      bands: bandGroups,
      motors: motorConfig,
      unit: currentUnit,
    };
    const b64 = btoa(JSON.stringify(payload));
    window.location.hash = b64;
    navigator.clipboard.writeText(window.location.href).then(() => {
      alert('Shareable URL copied to clipboard!');
    });
  }

  function loadFromHash() {
    try {
      const b64 = window.location.hash.substring(1);
      if (b64.startsWith('unit=')) {
        const u = b64.split('=')[1];
        if (u === 'holes' || u === 'in') setUnit(u);
        return;
      }
      const data = JSON.parse(atob(b64));
      if (data.cfg) currentConfig = data.cfg;
      if (data.bands) bandGroups = data.bands;
      if (data.motors) motorConfig = data.motors;
      if (data.unit) {
        currentUnit = data.unit;
        renderer.options.unit = currentUnit;
        document.querySelectorAll('#unitToggle .unit-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-unit') === currentUnit);
        });
        document.querySelectorAll('.dim-unit').forEach((el) => {
          el.textContent = currentUnit === 'holes' ? '(holes)' : '(in)';
        });
      }
      if (motorConfig.isCustom) {
        const ratioSelect = document.getElementById('motor_ratio');
        const customContainer = document.getElementById('custom_ratio_container');
        const customInput = document.getElementById('custom_motor_ratio');
        if (ratioSelect) ratioSelect.value = 'custom';
        if (customContainer) customContainer.style.display = 'block';
        if (customInput) customInput.value = motorConfig.ratioStr || '1:5';
      }
      syncInputsFromConfig();
      rebuildModel();
    } catch (e) {
      console.warn('Failed to parse URL config', e);
    }
  }

  // Run on startup
  window.addEventListener('DOMContentLoaded', init);
})();
