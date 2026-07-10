// --- CUSTOM WELL: form -> auto-calibration -> preset ---
//
// Lets an operator enter well data (the same fields as the "Wellsite plunger
// sim candidates" spreadsheet) and turns it into a calibrated packer-mode
// preset in the Well dropdown, like Well A / Well B.
//
// Pipeline:
//   1. deriveInitialKnobs(inputs)  — analytic first-guesses from the physics
//   2. calibrateCustomWellSync()   — coordinate-descent refinement: run fast
//      headless sims (same updatePhysics/checkLogic as the live loop) and
//      nudge each knob until the model matches the entered targets
//   3. gradeMetrics()              — MATCH / CLOSE / OFF validation table
//   4. saveCustomWell()            — localStorage persistence + dropdown entry
//
// The calibration adjusts knobs within physical bounds only — it never clamps
// or caps simulator behavior. See plan: memory/packer-plunger-model.md.

// === SECTION 0: CONSTANTS ===

const CW_TUBING_GEOMETRY = {
    '2-3/8': { TUBING_AREA_FT2: 0.0217, TUBING_ID_FT: 0.166,  FT_PER_BBL: 259,   LIQUID_PSI_PER_BBL: 118 },
    '2-7/8': { TUBING_AREA_FT2: 0.0325, TUBING_ID_FT: 0.2034, FT_PER_BBL: 172.8, LIQUID_PSI_PER_BBL: 78.6 }
};
const CW_LS_KEY = 'plsim.customWells.v1';
const CW_GAS_GRADIENT = 0.025;   // psi/ft — matches GAS_GRADIENT_PSI_PER_FT (packer transforms)
const CW_CAL_DAYS = 3;           // headless run length; metrics use day 2+ (cold start excluded)

// Controller input ids a custom preset writes (mirrors the wellA preset block)
const CW_CTRL_IDS = [
    'inMaxAft','inMinAft','inCloseDly','inPlgDrop','inMandatory','inMaxShutIn','inMaxWait',
    'chkOpenCsg','inOpenCsgVal','chkOpenLoad','chkOpenDiff',
    'chkOpenOffTime','inOpenOffTimeVal','chkOpenArmedTime','chkOpenTubing','chkOpenTbgLine',
    'chkCloseFlow','inCloseFlowVal','chkCloseDP','chkCloseOnTime',
    'chkCloseCasing','chkCloseTubing','chkCloseCsgTbg','chkCloseCsgLine'
];

// NOTE: the preset-settable globals are top-level `let` bindings, which are NOT
// reachable via globalThis — snapshot/restore must reference them by name
// (see cwTakeSnapshot / cwRestoreSnapshot).

// === SECTION 1: FORM READ + VALIDATION ===

function cwNum(id) {
    const el = document.getElementById(id);
    if (!el || el.value === '') return NaN;
    return parseFloat(el.value);
}

function readCustomWellForm() {
    const tubingSize = document.getElementById('cwTubingSize').value;
    return {
        name: (document.getElementById('cwName').value || '').trim(),
        tubingSize: tubingSize,
        customTubingIdIn: cwNum('cwCustomId'),
        depthFt: cwNum('cwDepth'),
        linePsi: cwNum('cwLine'),
        flowingTbgPsi: cwNum('cwFlowingTbg'),
        siPeakPsi: cwNum('cwSiPeak'),
        siPeakAfterMin: cwNum('cwSiPeakAfter'),
        prodMcfd: cwNum('cwProd'),
        waterBblD: cwNum('cwWater'),
        cyclesPerDay: cwNum('cwCycles'),
        riseMin: cwNum('cwRise'),
        dropMin: cwNum('cwDrop'),
        stabilizedSiPsi: isNaN(cwNum('cwStabilizedSi')) ? null : cwNum('cwStabilizedSi'),
        ctrl: {
            offTimeMin: cwNum('cwCtrlOffTime'),
            closeFlowMcfd: cwNum('cwCtrlCloseFlow'),
            closeDelayMin: cwNum('cwCtrlCloseDelay'),
            dropTimerMin: cwNum('cwCtrlDropTimer'),
            maxAfterflowMin: cwNum('cwCtrlMaxAft'),
            maxShutInMin: cwNum('cwCtrlMaxShutIn')
        }
    };
}

function validateCustomWellInputs(inputs) {
    const errs = [];
    const err = (field, message) => errs.push({ field, message, severity: 'error' });
    const warn = (field, message) => errs.push({ field, message, severity: 'warn' });

    if (!inputs.name) err('cwName', 'Well name is required.');
    const required = [
        ['depthFt','cwDepth','BSA depth'], ['linePsi','cwLine','Line pressure'],
        ['flowingTbgPsi','cwFlowingTbg','Flowing tubing pressure'], ['siPeakPsi','cwSiPeak','Shut-in tubing peak'],
        ['siPeakAfterMin','cwSiPeakAfter','Shut-in duration'], ['prodMcfd','cwProd','Daily production'],
        ['waterBblD','cwWater','Water rate'], ['cyclesPerDay','cwCycles','Cycles per day'],
        ['riseMin','cwRise','Rise time'], ['dropMin','cwDrop','Drop time']
    ];
    for (const [key, field, label] of required) {
        const v = inputs[key];
        if (isNaN(v) || v < 0 || (v <= 0 && key !== 'waterBblD')) err(field, label + ' is required and must be positive.');
    }
    for (const [key, field, label] of [
        ['offTimeMin','cwCtrlOffTime','Off time'], ['closeFlowMcfd','cwCtrlCloseFlow','Close flow trigger'],
        ['closeDelayMin','cwCtrlCloseDelay','Close delay'], ['dropTimerMin','cwCtrlDropTimer','Drop timer'],
        ['maxAfterflowMin','cwCtrlMaxAft','Max afterflow'], ['maxShutInMin','cwCtrlMaxShutIn','Max shut-in']
    ]) {
        const v = inputs.ctrl[key];
        if (isNaN(v) || v < 0) err(field, label + ' is required (0 allowed only for close delay).');
    }
    if (inputs.tubingSize === 'custom' && (isNaN(inputs.customTubingIdIn) || inputs.customTubingIdIn <= 0.5 || inputs.customTubingIdIn > 4.5)) {
        err('cwCustomId', 'Custom tubing ID must be between 0.5 and 4.5 inches.');
    }
    if (errs.some(e => e.severity === 'error')) return errs;  // don't cross-check garbage

    if (inputs.flowingTbgPsi <= inputs.linePsi) err('cwFlowingTbg', 'Flowing tubing pressure must exceed line pressure (or the well cannot flow).');
    if (inputs.siPeakPsi <= inputs.flowingTbgPsi) err('cwSiPeak', 'Shut-in peak must exceed flowing tubing pressure.');
    if (inputs.stabilizedSiPsi !== null && inputs.stabilizedSiPsi < inputs.siPeakPsi) err('cwStabilizedSi', 'Stabilized shut-in pressure cannot be below the short shut-in peak.');
    if (inputs.depthFt < 1000 || inputs.depthFt > 15000) err('cwDepth', 'Depth outside 1,000–15,000 ft.');
    if (inputs.cyclesPerDay < 0.5 || inputs.cyclesPerDay > 30) err('cwCycles', 'Cycles/day outside 0.5–30.');
    const label = inputs.name + ' — Packer (custom)';
    for (const k of Object.keys(WELL_PRESETS)) {
        if (k === cwSlugKey(inputs.name) || WELL_PRESETS[k].label === label) {
            err('cwName', 'A well with this name already exists — pick another name or delete the existing one.');
        }
    }

    const fallSpeed = inputs.depthFt / inputs.dropMin;
    if (fallSpeed < 50 || fallSpeed > 400) warn('cwDrop', 'Implied fall speed ' + fallSpeed.toFixed(0) + ' ft/min is unusual (typical 50–400). Double-check depth and drop time.');
    const riseSpeed = inputs.depthFt / inputs.riseMin;
    if (riseSpeed < 200 || riseSpeed > 2000) warn('cwRise', 'Implied rise velocity ' + riseSpeed.toFixed(0) + ' ft/min is unusual (typical 200–2,000).');
    if (inputs.ctrl.dropTimerMin < inputs.dropMin) warn('cwCtrlDropTimer', 'Controller drop timer is shorter than the observed drop time — the well may arm before the plunger lands.');
    if (inputs.stabilizedSiPsi === null) warn('cwStabilizedSi', 'No stabilized shut-in pressure — reservoir pressure will be estimated from the short shut-in peak (less certain fit).');
    if (Math.abs(inputs.siPeakAfterMin - inputs.ctrl.offTimeMin) > 0.25 * inputs.siPeakAfterMin) {
        warn('cwSiPeakAfter', 'SI peak was observed after ' + inputs.siPeakAfterMin + ' min of shut-in, but the off-time setpoint is ' +
            inputs.ctrl.offTimeMin + ' min — the model shuts in for the off-time, so the modeled SI peak may not be directly comparable to your reading.');
    }
    if ((inputs.flowingTbgPsi - inputs.linePsi) > Math.max(50, 0.2 * inputs.linePsi)) {
        warn('cwFlowingTbg', 'Flowing tubing is far above line pressure — if this well is choked at surface, the model (wide-open valve) will read low on flowing tubing.');
    }
    return errs;
}

function cwSlugKey(name) {
    return 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cwGeometryFor(inputs) {
    if (inputs.tubingSize !== 'custom') return CW_TUBING_GEOMETRY[inputs.tubingSize];
    const idFt = inputs.customTubingIdIn / 12;
    const area = Math.PI * Math.pow(idFt / 2, 2);
    const ftPerBbl = 5.615 / area;
    return {
        TUBING_AREA_FT2: area,
        TUBING_ID_FT: idFt,
        FT_PER_BBL: ftPerBbl,
        LIQUID_PSI_PER_BBL: 0.4547 * ftPerBbl   // 0.433 psi/ft × SG 1.05 — verified vs both known pairs
    };
}

// === SECTION 2: ANALYTIC FIRST-GUESSES ===

function deriveInitialKnobs(inputs) {
    const geo = cwGeometryFor(inputs);
    const gasCol = CW_GAS_GRADIENT * inputs.depthFt;
    const notes = [];

    // Plunger fall: Well A anchor — V_FALL_REF 800 gives ~177 ft/min at its pressures
    const targetFallSpeed = inputs.depthFt / inputs.dropMin;
    const vFallRef = cwClamp(800 * targetFallSpeed / 177, 200, 3000);

    // Reservoir pressure
    let Pr, prPinned;
    if (inputs.stabilizedSiPsi !== null) {
        Pr = inputs.stabilizedSiPsi + gasCol;
        prPinned = true;
        notes.push('Reservoir pressure pinned at ' + Pr.toFixed(0) + ' psi from the stabilized shut-in pressure.');
    } else {
        // 1.2 × (SI peak + gas column): exact for Well A (650), within refine range for Well B
        Pr = 1.2 * (inputs.siPeakPsi + gasCol);
        prPinned = false;
        notes.push('Reservoir pressure estimated (no stabilized shut-in given) — Pr / IPR_C / V_STORE are not uniquely determined without it.');
    }
    const prBounds = [inputs.siPeakPsi + gasCol + 25, 2.2 * (inputs.siPeakPsi + gasCol)];

    // IPR from backpressure equation q = C (Pr² − Pwf²)^n, n = 0.8 fixed
    const pwfFlow = inputs.flowingTbgPsi + gasCol + 20;  // + friction margin
    const iprC = cwIprCFor(inputs.prodMcfd, Pr, pwfFlow);

    const knobs = {
        completionType: 'packer',
        WELL_DEPTH: inputs.depthFt,
        TUBING_AREA_FT2: geo.TUBING_AREA_FT2, TUBING_ID_FT: geo.TUBING_ID_FT,
        FT_PER_BBL: geo.FT_PER_BBL, LIQUID_PSI_PER_BBL: geo.LIQUID_PSI_PER_BBL,
        RESERVOIR_PRESSURE: Pr, P_LINE_BASE: inputs.linePsi,
        WELL_CHARACTERISTICS: {
            liquidGasRatio: Math.max(0.1, inputs.waterBblD / (inputs.prodMcfd / 1000)),
            IPR_C: cwClamp(iprC, 1e-4, 0.5),
            IPR_n: 0.8
        },
        V_FALL_REF: vFallRef,
        VALVE_CV: 10, AFTERFLOW_INFLOW_FACTOR: 1.0,
        V_STORE_FT3: cwClamp(6000 * inputs.depthFt / 6893, 500, 50000),
        plungerGasDrag: 1.0e-3,
        INITIAL: { P_casing: inputs.linePsi, P_tubing: inputs.flowingTbgPsi, liquidInTubing: 0.3 }
    };
    const bounds = {
        V_FALL_REF: [200, 3000],
        RESERVOIR_PRESSURE: prBounds,
        IPR_C: [1e-4, 0.5],
        V_STORE_FT3: [500, 50000],
        plungerGasDrag: [1e-4, 2e-2]
    };
    return { knobs, bounds, prPinned, notes };
}

function cwIprCFor(prodMcfd, Pr, pwfFlow) {
    const dp2 = Pr * Pr - pwfFlow * pwfFlow;
    if (dp2 <= 0) return 0.05;  // inconsistent inputs — refine loop will surface it
    return prodMcfd / Math.pow(dp2, 0.8);
}

function cwClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// === SECTION 3: HEADLESS RUNNER + METRICS TRACKER ===

// UI / capture functions proven safe to stub by the Node cal-test harness
const CW_STUB_FNS = [
    'logEvent','renderStatus','updateArrivalsTable','logCycleSummary','updateUI',
    'drawChart','updateChart','drawWellbore','captureOpeningData','captureClosingData',
    'updateCycleTable','updateDailySummary','showInstructions'
];
let _cwSavedFns = null;
let _cwSavedConsoleLog = null;

function cwStubUI() {
    if (_cwSavedFns) return;  // already stubbed
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    _cwSavedFns = {};
    for (const name of CW_STUB_FNS) {
        _cwSavedFns[name] = g[name];
        g[name] = function () {};
    }
    _cwSavedConsoleLog = console.log;
    console.log = function () {};
}

function cwRestoreUI() {
    if (!_cwSavedFns) return;
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    for (const name of CW_STUB_FNS) g[name] = _cwSavedFns[name];
    console.log = _cwSavedConsoleLog;
    _cwSavedFns = null;
    _cwSavedConsoleLog = null;
}

function withHeadlessEnv(fn) {
    if (typeof running !== 'undefined' && running && typeof toggleSimulation === 'function') {
        toggleSimulation();  // belt-and-braces: never calibrate under a live timer
    }
    cwStubUI();
    try { return fn(); }
    finally { cwRestoreUI(); }
}

// applyWellPreset minus DOM / label / reset — just the physics globals
function applyKnobsToGlobals(knobs) {
    COMPLETION_TYPE = knobs.completionType;
    WELL_DEPTH = knobs.WELL_DEPTH;
    TUBING_AREA_FT2 = knobs.TUBING_AREA_FT2;
    TUBING_ID_FT = knobs.TUBING_ID_FT;
    FT_PER_BBL = knobs.FT_PER_BBL;
    LIQUID_PSI_PER_BBL = knobs.LIQUID_PSI_PER_BBL;
    RESERVOIR_PRESSURE = knobs.RESERVOIR_PRESSURE;
    P_LINE_BASE = knobs.P_LINE_BASE;
    WELL_CHARACTERISTICS = {
        liquidGasRatio: knobs.WELL_CHARACTERISTICS.liquidGasRatio,
        IPR_C: knobs.WELL_CHARACTERISTICS.IPR_C,
        IPR_n: knobs.WELL_CHARACTERISTICS.IPR_n
    };
    V_FALL_REF = knobs.V_FALL_REF;
    VALVE_CV = knobs.VALVE_CV;
    AFTERFLOW_INFLOW_FACTOR = knobs.AFTERFLOW_INFLOW_FACTOR;
    V_STORE_FT3 = knobs.V_STORE_FT3;
    PLUNGER_GAS_DRAG_ACTIVE = (USE_PER_WELL_DRAG && knobs.plungerGasDrag) ? knobs.plungerGasDrag : PLUNGER_GAS_DRAG;
    TUBING_VOLUME_FT3 = TUBING_AREA_FT2 * WELL_DEPTH;
    INITIAL_CONDITIONS.P_casing = knobs.INITIAL.P_casing;
    INITIAL_CONDITIONS.P_tubing = knobs.INITIAL.P_tubing;
    INITIAL_CONDITIONS.liquidInTubing = knobs.INITIAL.liquidInTubing;
}

// Write controller settings to the live inputs (checkLogic reads the DOM each tick).
// Works against the browser DOM and the Node test's mock getElementById alike.
function cwApplyCtrlToDom(ctrl) {
    const block = cwControllerBlock(ctrl);
    for (const [id, val] of Object.entries(block)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (typeof val === 'boolean') el.checked = val;
        else el.value = val;
    }
}

function cwControllerBlock(ctrl) {
    return {
        inMaxAft: ctrl.maxAfterflowMin, inMinAft: 5, inCloseDly: ctrl.closeDelayMin,
        inPlgDrop: ctrl.dropTimerMin, inMandatory: 0, inMaxShutIn: ctrl.maxShutInMin, inMaxWait: 30,
        chkOpenCsg: false, inOpenCsgVal: 520,
        chkOpenLoad: false, chkOpenDiff: false,
        chkOpenOffTime: true, inOpenOffTimeVal: ctrl.offTimeMin,
        chkOpenArmedTime: false, chkOpenTubing: false, chkOpenTbgLine: false,
        chkCloseFlow: true, inCloseFlowVal: ctrl.closeFlowMcfd,
        chkCloseDP: false, chkCloseOnTime: false,
        chkCloseCasing: false, chkCloseTubing: false,
        chkCloseCsgTbg: false, chkCloseCsgLine: false
    };
}

function createMetricsTracker() {
    const cycles = [];
    let current = null;
    let siPeak = 0;                 // tracked across shut-in states, assigned at next lift start
    let pendingFall = null;         // {startT, landed, maxDepth, lastT}
    let nonArrivals = 0;
    let liftAttempts = 0;           // every ARMED->LIFTING, incl. failures (distinguishes "never opened" from "never arrived")
    const prodByDay = [];
    const liqAtDayEnd = [];

    // steady afterflow sampling (skip 10-min arrival transient)
    let tbgSum = 0, tbgN = 0, flowMin = Infinity, flowMax = 0;

    function tick(prevState, i) {
        // SI peak across all shut-in states
        if ((state === 'UNARMED_SHUTIN' || state === 'ARMED_SHUTIN' || state === 'MANDATORY_SHUTIN')
            && P_tubing > siPeak) siPeak = P_tubing;

        if (state !== prevState) {
            if (prevState === 'ARMED_SHUTIN' && state === 'LIFTING') {
                liftAttempts++;
                current = { liftStartT: simTime, SIpeakP_tbg: siPeak, liftMin: null, arrivalT: null, fallToBottomMin: null };
                siPeak = 0;
            }
            if (prevState === 'LIFTING') {
                if (state === 'AFTERFLOW' && current) {
                    current.arrivalT = simTime;
                    current.liftMin = simTime - current.liftStartT;
                } else {
                    nonArrivals++;   // lift ended without an arrival (max-wait / failure path)
                }
            }
            if (prevState === 'AFTERFLOW' && state === 'UNARMED_SHUTIN' && current) {
                if (current.arrivalT !== null) current.afterflowMin = simTime - current.arrivalT;
                pendingFall = { startT: simTime, landed: false, maxDepth: PlungerDepth, cycle: current };
                cycles.push(current);
                current = null;
            }
        }

        // Physical fall-to-bottom time (NOT the controller drop timer)
        if (pendingFall && !pendingFall.landed) {
            if (PlungerDepth > pendingFall.maxDepth) pendingFall.maxDepth = PlungerDepth;
            if (PlungerDepth >= WELL_DEPTH - 0.5) {
                pendingFall.cycle.fallToBottomMin = simTime - pendingFall.startT;
                pendingFall.landed = true;
            } else if (state === 'LIFTING') {
                // Re-opened mid-fall: extrapolate from the distance actually fallen
                const elapsed = simTime - pendingFall.startT;
                const fallen = pendingFall.maxDepth;
                if (fallen > 100) pendingFall.cycle.fallToBottomMin = elapsed * WELL_DEPTH / fallen;
                pendingFall.landed = true;
            }
        }

        // Steady afterflow sampling (current is non-null during AFTERFLOW)
        if (state === 'AFTERFLOW') {
            const ref = current ? current.arrivalT : null;
            if (ref !== null && simTime - ref > 10 && simTime > 1440) {
                tbgSum += P_tubing; tbgN++;
                if (FlowRate < flowMin) flowMin = FlowRate;
                if (FlowRate > flowMax) flowMax = FlowRate;
            }
        }

        // Per-day production (all open-valve flow) + liquid snapshots
        const day = Math.floor(i / 1440);
        if (prodByDay[day] === undefined) prodByDay[day] = 0;
        if (FlowRate > 0) prodByDay[day] += FlowRate * (1.0 / 1440);
        if ((i + 1) % 1440 === 0) liqAtDayEnd[day] = (typeof totalLiquidProducedBbl !== 'undefined') ? totalLiquidProducedBbl : 0;
    }

    function finalize(days) {
        const steady = cycles.filter(c => c.liftStartT > 1440);
        const withArrival = steady.filter(c => c.arrivalT !== null);
        const withFall = steady.filter(c => c.fallToBottomMin !== null);
        const avg = (arr, f) => arr.length ? arr.reduce((a, c) => a + f(c), 0) / arr.length : NaN;

        let dailyMcf = NaN;
        if (days >= 2) {
            const steadyDays = prodByDay.slice(1, days);
            dailyMcf = steadyDays.length ? steadyDays.reduce((a, b) => a + b, 0) / steadyDays.length : NaN;
        }
        let waterBblD = NaN;
        if (days >= 2 && liqAtDayEnd[0] !== undefined && liqAtDayEnd[days - 1] !== undefined) {
            waterBblD = (liqAtDayEnd[days - 1] - liqAtDayEnd[0]) / (days - 1);
        }
        const withAfterflow = steady.filter(c => c.afterflowMin !== undefined);
        return {
            cyclesPerDay: steady.length / Math.max(1, days - 1),
            avgAfterflowMin: avg(withAfterflow, c => c.afterflowMin),
            siPeakPsi: avg(withArrival, c => c.SIpeakP_tbg),
            riseMin: avg(withArrival, c => c.liftMin),
            dropMin: avg(withFall, c => c.fallToBottomMin),
            dailyMcf: dailyMcf,
            flowingTbgAvg: tbgN ? tbgSum / tbgN : NaN,
            flowBand: [flowMin === Infinity ? NaN : flowMin, flowMax || NaN],
            waterBblD: waterBblD,
            nonArrivals: nonArrivals,
            liftAttempts: liftAttempts,
            sampleCycles: steady.length,
            converged: withArrival.length > 0
        };
    }

    return { tick, finalize };
}

// Run one headless sim. Must be called with UI stubs active (cwStubUI / withHeadlessEnv).
function runHeadlessSim(knobs, days) {
    applyKnobsToGlobals(knobs);
    resetSimulation();               // full state reseed from globals (showInstructions is stubbed)
    const trk = createMetricsTracker();
    const steps = days * 1440;
    for (let i = 0; i < steps; i++) {
        const prev = state;
        simTime += 1.0;
        stateTimer += 1.0;
        updatePhysics(1.0);
        checkLogic();
        trk.tick(prev, i);
    }
    return trk.finalize(days);
}

// === SECTION 4: COORDINATE-DESCENT REFINEMENT ===

// One bounded secant solve on a single knob against a single metric.
// dir: +1 if metric increases with knob, -1 otherwise. Keeps best-seen on non-convergence.
function refineKnob(knobs, spec, log) {
    const { name, inChar, metric, target, tol, iters, logSpace, dir } = spec;
    const get = () => inChar ? knobs.WELL_CHARACTERISTICS[name] : knobs[name];
    const set = (v) => { if (inChar) knobs.WELL_CHARACTERISTICS[name] = v; else knobs[name] = v; };
    const [lo, hi] = spec.bounds;
    const xOf = (k) => logSpace ? Math.log(k) : k;
    const kOf = (x) => logSpace ? Math.exp(x) : x;
    let sims = 0;
    const sim = () => { sims++; return runHeadlessSim(knobs, CW_CAL_DAYS)[metric]; };

    let k0 = get();
    let m0 = sim();
    if (!isFinite(m0)) { log(name + ': sim produced no valid ' + metric + ' — keeping first guess'); return { converged: false, sims }; }
    if (Math.abs(m0 - target) <= tol) { log(name + ': already in tolerance (' + cwFmt(m0) + ' vs ' + cwFmt(target) + ')'); return { converged: true, sims }; }
    let best = { k: k0, err: Math.abs(m0 - target) };

    // Proportional first step in the correct direction
    let ratio = target / m0;
    if (dir < 0) ratio = 1 / ratio;
    ratio = cwClamp(ratio, 0.25, 4);
    let k1 = cwClamp(k0 * ratio, lo, hi);
    if (k1 === k0) k1 = cwClamp(k0 * (ratio > 1 ? 1.5 : 0.67), lo, hi);

    for (let it = 0; it < iters; it++) {
        set(k1);
        const m1 = sim();
        if (!isFinite(m1)) break;
        const err1 = Math.abs(m1 - target);
        if (err1 < best.err) best = { k: k1, err: err1 };
        if (err1 <= tol) { log(name + ' -> ' + cwFmt(k1) + ' (' + metric + ' ' + cwFmt(m1) + ' vs target ' + cwFmt(target) + ')'); return { converged: true, sims }; }

        const x0 = xOf(k0), x1 = xOf(k1);
        const slope = (m1 - m0) / (x1 - x0);
        if (!isFinite(slope) || Math.abs(slope) < 1e-12) break;
        let x2 = x1 + (target - m1) / slope;
        // Limit step to 4x / 0.25x per iteration
        x2 = logSpace
            ? cwClamp(x2, x1 - Math.log(4), x1 + Math.log(4))
            : cwClamp(x2, x1 - Math.abs(x1) * 3, x1 + Math.abs(x1) * 3);
        const k2 = cwClamp(kOf(x2), lo, hi);
        if (k2 === k1) break;
        k0 = k1; m0 = m1; k1 = k2;
    }

    set(best.k);
    log(name + ': did not fully converge — ' + metric + ' off by ' + cwFmt(best.err) + ' (best kept: ' + cwFmt(best.k) + ')');
    return { converged: false, sims };
}

function cwFmt(v) {
    if (!isFinite(v)) return '—';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 1) return v.toFixed(1);
    return v.toPrecision(3);
}

// Build the calibration schedule. Sync core — the Node product test calls this directly.
function calibrateCustomWellSync(inputs, onProgress) {
    const progress = onProgress || function () {};
    const logLines = [];
    const log = (s) => { logLines.push(s); };
    const { knobs, bounds, prPinned, notes } = deriveInitialKnobs(inputs);

    cwApplyCtrlToDom(inputs.ctrl);

    let totalSims = 0;
    const steps = [];
    const add = (label, spec) => steps.push({ label, spec });

    // PASS 1 — coarse, in causal order
    add('Fall velocity vs drop time', { name: 'V_FALL_REF', metric: 'dropMin', target: inputs.dropMin, tol: Math.max(2, 0.1 * inputs.dropMin), iters: 4, logSpace: false, dir: -1, bounds: bounds.V_FALL_REF });
    if (!prPinned) add('Reservoir pressure vs SI peak', { name: 'RESERVOIR_PRESSURE', metric: 'siPeakPsi', target: inputs.siPeakPsi, tol: 40, iters: 3, logSpace: false, dir: +1, bounds: bounds.RESERVOIR_PRESSURE });
    add('IPR vs daily production', { name: 'IPR_C', inChar: true, metric: 'dailyMcf', target: inputs.prodMcfd, tol: 0.10 * inputs.prodMcfd, iters: 5, logSpace: true, dir: +1, bounds: bounds.IPR_C, recomputeIprGuess: true });
    add('Storage volume vs SI peak', { name: 'V_STORE_FT3', metric: 'siPeakPsi', target: inputs.siPeakPsi, tol: 20, iters: 5, logSpace: true, dir: -1, bounds: bounds.V_STORE_FT3 });
    add('Plunger drag vs rise time', { name: 'plungerGasDrag', metric: 'riseMin', target: inputs.riseMin, tol: Math.max(1.5, 0.1 * inputs.riseMin), iters: 5, logSpace: true, dir: +1, bounds: bounds.plungerGasDrag });
    // PASS 2 — interaction cleanup
    add('Production re-check', { name: 'IPR_C', inChar: true, metric: 'dailyMcf', target: inputs.prodMcfd, tol: 0.10 * inputs.prodMcfd, iters: 3, logSpace: true, dir: +1, bounds: bounds.IPR_C });
    add('SI peak re-check', { name: 'V_STORE_FT3', metric: 'siPeakPsi', target: inputs.siPeakPsi, tol: 20, iters: 3, logSpace: true, dir: -1, bounds: bounds.V_STORE_FT3 });
    add('Rise time re-check', { name: 'plungerGasDrag', metric: 'riseMin', target: inputs.riseMin, tol: Math.max(1.5, 0.1 * inputs.riseMin), iters: 2, logSpace: true, dir: +1, bounds: bounds.plungerGasDrag });

    return withHeadlessEnv(() => {
        for (let s = 0; s < steps.length; s++) {
            const { label, spec } = steps[s];
            progress('Calibrating (' + (s + 1) + '/' + steps.length + '): ' + label + '…');
            if (spec.recomputeIprGuess) {
                // Pr may have moved in the previous step — refresh the analytic IPR guess (free, no sim)
                const pwfFlow = inputs.flowingTbgPsi + CW_GAS_GRADIENT * inputs.depthFt + 20;
                knobs.WELL_CHARACTERISTICS.IPR_C = cwClamp(cwIprCFor(inputs.prodMcfd, knobs.RESERVOIR_PRESSURE, pwfFlow), 1e-4, 0.5);
            }
            const r = refineKnob(knobs, spec, log);
            totalSims += r.sims;
        }
        progress('Final validation run…');
        const metrics = runHeadlessSim(knobs, CW_CAL_DAYS);
        const pinned = cwPinnedKnobs(knobs, bounds, prPinned);
        const statuses = gradeMetrics(metrics, inputs, pinned);
        const overall = cwOverallDiagnosis(metrics, inputs);
        log('Total sims: ' + totalSims);
        return { knobs, metrics, statuses, notes, log: logLines, prPinned, overall };
    });
}

// Async wrapper: yields to the UI between steps so the progress line paints.
async function calibrateCustomWell(inputs, onProgress) {
    // Run the sync core in one shot after a paint — each full calibration is ~1-2 s,
    // and the schedule already reports step progress through onProgress. To keep the
    // browser responsive we yield once before starting and let sync progress messages
    // accumulate into the log; the status line updates via rAF-free direct DOM writes.
    await new Promise(r => setTimeout(r, 30));
    return calibrateCustomWellSync(inputs, onProgress);
}

// === SECTION 5: GRADING ===

// Which refined knobs ended pinned at a physical bound (within 2%). A pinned knob
// whose metric is still OFF means the entered targets are mutually inconsistent —
// the fit did all the physics allows.
function cwPinnedKnobs(knobs, bounds, prPinned) {
    const pinned = {};
    const check = (name, val) => {
        const b = bounds[name];
        if (!b) return;
        if (val <= b[0] * 1.02) pinned[name] = 'low';
        else if (val >= b[1] * 0.98) pinned[name] = 'high';
    };
    check('V_FALL_REF', knobs.V_FALL_REF);
    if (!prPinned) check('RESERVOIR_PRESSURE', knobs.RESERVOIR_PRESSURE);
    check('IPR_C', knobs.WELL_CHARACTERISTICS.IPR_C);
    check('V_STORE_FT3', knobs.V_STORE_FT3);
    check('plungerGasDrag', knobs.plungerGasDrag);
    return pinned;
}

// Catch-all when the well never produced a valid cycle: an all-OFF table with
// per-metric hints is useless — say the one thing that actually went wrong.
function cwOverallDiagnosis(metrics, inputs) {
    if (metrics.converged) return null;
    if (metrics.liftAttempts === 0) {
        return 'The controller never opened the well during the run — check the off-time (' +
            inputs.ctrl.offTimeMin + ' min) and max shut-in (' + inputs.ctrl.maxShutInMin + ' min) setpoints.';
    }
    return 'The plunger lifted ' + metrics.liftAttempts + ' time(s) but never reached surface — pressure buildup may be ' +
        'insufficient to lift the slug against line pressure. Double-check the shut-in tubing peak (' + inputs.siPeakPsi +
        ' psi) vs line pressure (' + inputs.linePsi + ' psi), the water rate, and the rise time. ' +
        'If those are all correct as entered, this well may genuinely struggle to make plunger trips at these conditions.';
}

function gradeMetrics(metrics, inputs, pinned) {
    pinned = pinned || {};
    const grades = {};
    const grade = (key, target, model, matchTol, closeTol, hint) => {
        let status = 'OFF';
        if (isFinite(model)) {
            const err = Math.abs(model - target);
            if (err <= matchTol) status = 'MATCH';
            else if (err <= closeTol) status = 'CLOSE';
        }
        grades[key] = { target, model, status, hint };
    };
    const pct = (t, p) => Math.abs(t) * p;

    // Knob-at-bound explanations override the generic "double-check X" hints:
    // the fit exhausted the physical range, so the inputs disagree with each other.
    const boundHints = {};
    if (pinned.IPR_C) {
        boundHints.dailyMcf = pinned.IPR_C === 'high'
            ? 'The fit pushed well deliverability (IPR) to its physical limit and still could not reach the entered production — the production number is inconsistent with the entered pressures. Double-check daily production, SI peak, and flowing tubing pressure.'
            : 'Even minimum deliverability over-produces the entered target — the production number looks too low for the entered pressures.';
    }
    if (pinned.V_STORE_FT3 || pinned.RESERVOIR_PRESSURE) {
        boundHints.siPeakPsi = 'The fit pushed ' + (pinned.V_STORE_FT3 ? 'gas storage volume' : 'reservoir pressure') +
            ' to its physical limit and still could not match the shut-in peak — double-check the SI peak reading and the shut-in duration it was observed after. Providing a stabilized long shut-in pressure pins the fit.';
    }
    if (pinned.plungerGasDrag) {
        boundHints.riseMin = 'The fit pushed plunger drag to its physical limit and still could not match the rise time — double-check the rise time reading, tubing size, and depth.';
    }
    if (pinned.V_FALL_REF) {
        boundHints.dropMin = 'The fit pushed plunger fall velocity to its physical limit and still could not match the drop time — double-check BSA depth and drop time.';
    }

    grade('cyclesPerDay', inputs.cyclesPerDay, metrics.cyclesPerDay, 1, 2,
        cwCycleHint(metrics, inputs));
    grade('dailyMcf', inputs.prodMcfd, metrics.dailyMcf, pct(inputs.prodMcfd, 0.20), pct(inputs.prodMcfd, 0.40),
        boundHints.dailyMcf || 'Double-check flowing tubing and line pressures.');
    grade('siPeakPsi', inputs.siPeakPsi, metrics.siPeakPsi, 60, 120,
        boundHints.siPeakPsi || 'Double-check shut-in duration / SI peak reading; providing a stabilized shut-in pressure pins the fit.');
    grade('riseMin', inputs.riseMin, metrics.riseMin, Math.max(3, pct(inputs.riseMin, 0.25)), pct(inputs.riseMin, 0.50),
        boundHints.riseMin || 'Double-check the rise time reading and tubing size.');
    grade('dropMin', inputs.dropMin, metrics.dropMin, Math.max(5, pct(inputs.dropMin, 0.20)), pct(inputs.dropMin, 0.40),
        boundHints.dropMin || 'Double-check BSA depth and drop time.');
    // Flowing tubing far above line while the model hugs line = a surface choke the
    // model doesn't know about (it assumes a wide-open valve).
    const chokeSuspect = isFinite(metrics.flowingTbgAvg)
        && (inputs.flowingTbgPsi - inputs.linePsi) > Math.max(50, 0.2 * inputs.linePsi)
        && (metrics.flowingTbgAvg - inputs.linePsi) < 0.5 * (inputs.flowingTbgPsi - inputs.linePsi);
    grade('flowingTbgAvg', inputs.flowingTbgPsi, metrics.flowingTbgAvg, pct(inputs.flowingTbgPsi, 0.10), pct(inputs.flowingTbgPsi, 0.20),
        chokeSuspect
            ? 'Flowing tubing sits far above line pressure but the model flows near line — the real well is likely choked at surface. The model assumes a wide-open valve, so expect this mismatch until a choke input is added.'
            : 'Double-check line pressure.');
    grade('waterBblD', inputs.waterBblD, metrics.waterBblD, Math.max(0.3, pct(inputs.waterBblD, 0.30)), Math.max(0.6, pct(inputs.waterBblD, 0.60)),
        'Double-check the water rate.');
    return grades;
}

// Diagnostic hint for a cycles/day mismatch. The generic "check your controller
// settings" is often wrong — the most common real cause is computable from data
// the calibration already has, so say the precise thing when we can.
function cwCycleHint(metrics, inputs) {
    const target = inputs.cyclesPerDay;
    const model = metrics.cyclesPerDay;
    const cf = inputs.ctrl.closeFlowMcfd;
    const fLo = metrics.flowBand ? metrics.flowBand[0] : NaN;
    const fHi = metrics.flowBand ? metrics.flowBand[1] : NaN;

    // Over-cycling with afterflows far shorter than the max-afterflow timer: the
    // timer isn't what is closing the well — the close-flow trigger is firing early
    // because the fitted deliverability puts steady flow at/near the trigger.
    // Usually means the production TARGET was entered at the low end of its real
    // range — not that the controller settings are wrong.
    if (isFinite(model) && model > target + 1
        && isFinite(metrics.avgAfterflowMin) && metrics.avgAfterflowMin < 0.7 * inputs.ctrl.maxAfterflowMin
        && isFinite(fHi) && fHi > cf) {
        return 'Model over-cycles: afterflow lasts only ~' + metrics.avgAfterflowMin.toFixed(0) + ' min (max-afterflow is ' +
            inputs.ctrl.maxAfterflowMin + '), so the close-flow trigger (' + cf + ' Mcfd) is closing the well early — the fitted flow rate (' +
            (isFinite(fLo) ? fLo.toFixed(0) : '?') + '–' + fHi.toFixed(0) + ' Mcfd) sits right at it. If the real well flows steadily ABOVE ' +
            cf + ', the daily production you entered is likely at the low end of its range — raise it toward the observed flowing rate and re-calibrate. ' +
            'If the well really flows this low, the trigger would over-cycle it in the field too.';
    }
    // Under-cycling: pacing is off-time + max-afterflow bound.
    if (isFinite(model) && model < target - 1) {
        return 'Model under-cycles — cycle pacing is set by off-time (' + inputs.ctrl.offTimeMin +
            ' min) + afterflow duration (max ' + inputs.ctrl.maxAfterflowMin + ' min). Double-check those setpoints and the observed cycles/day.';
    }
    if (metrics.nonArrivals > 0) {
        return metrics.nonArrivals + ' non-arrival(s) in the run — check rise time, drop time, and off-time against each other.';
    }
    return 'Emergent from controller settings — double-check off-time and close-flow trigger.';
}

const CW_METRIC_LABELS = {
    cyclesPerDay: ['Cycles per day', ''],
    dailyMcf: ['Daily production', 'Mcf/d'],
    siPeakPsi: ['Shut-in tubing peak', 'psi'],
    riseMin: ['Plunger rise time', 'min'],
    dropMin: ['Plunger drop time', 'min'],
    flowingTbgAvg: ['Flowing tubing press.', 'psi'],
    waterBblD: ['Water rate', 'bbl/d']
};

// === SECTION 6: PERSISTENCE + EXPORT / IMPORT ===

function cwHasStorage() {
    try { return typeof localStorage !== 'undefined' && localStorage !== null; }
    catch (e) { return false; }
}

function loadCustomWells() {
    if (!cwHasStorage()) return { version: 1, wells: {} };
    try {
        const raw = localStorage.getItem(CW_LS_KEY);
        if (!raw) return { version: 1, wells: {} };
        const store = JSON.parse(raw);
        if (!store || store.version !== 1 || typeof store.wells !== 'object') throw new Error('bad shape');
        return store;
    } catch (e) {
        console.warn('custom-well: corrupt localStorage, starting empty —', e.message);
        return { version: 1, wells: {} };
    }
}

function cwPersist(store) {
    if (!cwHasStorage()) return;
    try { localStorage.setItem(CW_LS_KEY, JSON.stringify(store)); }
    catch (e) { console.warn('custom-well: could not persist —', e.message); }
}

function cwCustomOptgroup() {
    const sel = document.getElementById('wellPresetSelect');
    if (!sel || typeof document.createElement !== 'function') return null;
    let og = document.getElementById('cwOptgroup');
    if (!og) {
        og = document.createElement('optgroup');
        og.id = 'cwOptgroup';
        og.label = 'Custom';
        sel.appendChild(og);
    }
    return og;
}

function cwAddOption(key, label) {
    const og = cwCustomOptgroup();
    if (!og) return;
    let opt = null;
    for (const o of og.children) if (o.value === key) { opt = o; break; }
    if (!opt) {
        opt = document.createElement('option');
        opt.value = key;
        og.appendChild(opt);
    }
    opt.textContent = label;
}

function mergeCustomWellsIntoUI() {
    const store = loadCustomWells();
    for (const [key, rec] of Object.entries(store.wells)) {
        if (!rec || !rec.preset || !rec.preset.WELL_DEPTH) continue;
        WELL_PRESETS[key] = rec.preset;
        cwAddOption(key, rec.label);
    }
}

function saveCustomWell(key, record) {
    const store = loadCustomWells();
    record.updatedAt = Date.now();
    if (!store.wells[key]) record.createdAt = record.updatedAt;
    else record.createdAt = store.wells[key].createdAt;
    store.wells[key] = record;
    cwPersist(store);
    WELL_PRESETS[key] = record.preset;
    cwAddOption(key, record.label);
}

function deleteCustomWell(key) {
    const store = loadCustomWells();
    delete store.wells[key];
    cwPersist(store);
    delete WELL_PRESETS[key];
    const og = document.getElementById('cwOptgroup');
    if (og) for (const o of Array.from(og.children)) if (o.value === key) o.remove();
    const sel = document.getElementById('wellPresetSelect');
    if (sel && sel.value === key) {
        sel.value = 'marcellus';
        applyWellPreset('marcellus');
        if (typeof closeInstructions === 'function') closeInstructions();
    }
    cwRenderManageList();
}

function exportCustomWells() {
    const store = loadCustomWells();
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'custom-wells.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importCustomWells(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const incoming = JSON.parse(reader.result);
            if (!incoming || incoming.version !== 1 || typeof incoming.wells !== 'object') throw new Error('not a custom-wells export');
            const store = loadCustomWells();
            let added = 0;
            for (let [key, rec] of Object.entries(incoming.wells)) {
                if (!rec || !rec.label || !rec.preset || !rec.preset.WELL_DEPTH || rec.preset.completionType !== 'packer') continue;
                while (store.wells[key] || WELL_PRESETS[key]) key = key + '-2';
                store.wells[key] = rec;
                WELL_PRESETS[key] = rec.preset;
                cwAddOption(key, rec.label);
                added++;
            }
            cwPersist(store);
            cwRenderManageList();
            cwSetImportStatus(added + ' well(s) imported.');
        } catch (e) {
            cwSetImportStatus('Import failed: ' + e.message);
        }
    };
    reader.readAsText(file);
}

function cwSetImportStatus(msg) {
    const el = document.getElementById('cwImportStatus');
    if (el) el.innerText = msg;
}

// === SECTION 7: MODAL FLOW ===

let _cwSnapshot = null;      // globals + controller DOM values, for cancel-restore
let _cwCalResult = null;     // last calibration result awaiting save
let _cwCalInputs = null;
let _cwCalWarnings = [];     // pre-run form warnings, re-shown on the result page

function cwTakeSnapshot() {
    const snap = {
        globals: {
            COMPLETION_TYPE: COMPLETION_TYPE,
            WELL_DEPTH: WELL_DEPTH,
            TUBING_AREA_FT2: TUBING_AREA_FT2,
            TUBING_ID_FT: TUBING_ID_FT,
            FT_PER_BBL: FT_PER_BBL,
            LIQUID_PSI_PER_BBL: LIQUID_PSI_PER_BBL,
            RESERVOIR_PRESSURE: RESERVOIR_PRESSURE,
            P_LINE_BASE: P_LINE_BASE,
            V_FALL_REF: V_FALL_REF,
            VALVE_CV: VALVE_CV,
            AFTERFLOW_INFLOW_FACTOR: AFTERFLOW_INFLOW_FACTOR,
            V_STORE_FT3: V_STORE_FT3,
            PLUNGER_GAS_DRAG_ACTIVE: PLUNGER_GAS_DRAG_ACTIVE,
            TUBING_VOLUME_FT3: TUBING_VOLUME_FT3
        },
        wellChar: Object.assign({}, WELL_CHARACTERISTICS),
        initial: Object.assign({}, INITIAL_CONDITIONS),
        ctrl: {}
    };
    for (const id of CW_CTRL_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        snap.ctrl[id] = id.startsWith('chk') ? el.checked : el.value;
    }
    return snap;
}

function cwRestoreSnapshot(snap) {
    if (!snap) return;
    const g = snap.globals;
    COMPLETION_TYPE = g.COMPLETION_TYPE;
    WELL_DEPTH = g.WELL_DEPTH;
    TUBING_AREA_FT2 = g.TUBING_AREA_FT2;
    TUBING_ID_FT = g.TUBING_ID_FT;
    FT_PER_BBL = g.FT_PER_BBL;
    LIQUID_PSI_PER_BBL = g.LIQUID_PSI_PER_BBL;
    RESERVOIR_PRESSURE = g.RESERVOIR_PRESSURE;
    P_LINE_BASE = g.P_LINE_BASE;
    V_FALL_REF = g.V_FALL_REF;
    VALVE_CV = g.VALVE_CV;
    AFTERFLOW_INFLOW_FACTOR = g.AFTERFLOW_INFLOW_FACTOR;
    V_STORE_FT3 = g.V_STORE_FT3;
    PLUNGER_GAS_DRAG_ACTIVE = g.PLUNGER_GAS_DRAG_ACTIVE;
    TUBING_VOLUME_FT3 = g.TUBING_VOLUME_FT3;
    WELL_CHARACTERISTICS = Object.assign({}, snap.wellChar);
    INITIAL_CONDITIONS.P_casing = snap.initial.P_casing;
    INITIAL_CONDITIONS.P_tubing = snap.initial.P_tubing;
    INITIAL_CONDITIONS.liquidInTubing = snap.initial.liquidInTubing;
    for (const [id, val] of Object.entries(snap.ctrl)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (id.startsWith('chk')) el.checked = val;
        else el.value = val;
    }
}

function cwShowPage(page) {
    for (const id of ['cwFormPage', 'cwProgressPage', 'cwResultPage']) {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === page) ? '' : 'none';
    }
    const save = document.getElementById('cwBtnSave');
    const back = document.getElementById('cwBtnBack');
    const create = document.getElementById('cwBtnCreate');
    if (save) save.style.display = (page === 'cwResultPage') ? '' : 'none';
    if (back) back.style.display = (page === 'cwResultPage') ? '' : 'none';
    if (create) create.style.display = (page === 'cwFormPage') ? '' : 'none';
}

function openCustomWellModal() {
    if (typeof running !== 'undefined' && running && typeof toggleSimulation === 'function') toggleSimulation();
    _cwCalResult = null;
    _cwCalInputs = null;
    cwShowPage('cwFormPage');
    const errBox = document.getElementById('cwValidationErrors');
    if (errBox) errBox.innerHTML = '';
    cwRenderManageList();
    document.getElementById('customWellModal').classList.remove('hidden');
}

function closeCustomWellModal() {
    if (_cwSnapshot) {
        cwRestoreSnapshot(_cwSnapshot);
        _cwSnapshot = null;
        if (typeof applyCompletionTypeUI === 'function') applyCompletionTypeUI();
        if (typeof resetSimulation === 'function') resetSimulation();
        if (typeof closeInstructions === 'function') closeInstructions();
    }
    document.getElementById('customWellModal').classList.add('hidden');
}

function backToCustomWellForm() {
    // Keep the snapshot: user may re-Create; restore happens on close/cancel or is
    // discarded on save.
    cwShowPage('cwFormPage');
}

function cwToggleCustomId() {
    const isCustom = document.getElementById('cwTubingSize').value === 'custom';
    const row = document.getElementById('cwCustomIdRow');
    if (row) row.style.display = isCustom ? '' : 'none';
}

async function startCustomWellCalibration() {
    const inputs = readCustomWellForm();
    const problems = validateCustomWellInputs(inputs);
    const errBox = document.getElementById('cwValidationErrors');
    const hard = problems.filter(p => p.severity === 'error');
    if (errBox) {
        errBox.innerHTML = problems.map(p =>
            '<div class="cw-' + p.severity + '">' + (p.severity === 'error' ? '✕ ' : '⚠ ') + p.message + '</div>'
        ).join('');
    }
    if (hard.length) return;
    _cwCalWarnings = problems.filter(p => p.severity === 'warn').map(p => p.message);

    if (!_cwSnapshot) _cwSnapshot = cwTakeSnapshot();
    cwShowPage('cwProgressPage');
    const statusEl = document.getElementById('cwCalStatus');
    const logEl = document.getElementById('cwCalLog');
    if (logEl) logEl.innerHTML = '';
    const onProgress = (text) => { if (statusEl) statusEl.innerText = text; };
    onProgress('Deriving first-guess parameters…');

    let result;
    try {
        result = await calibrateCustomWell(inputs, onProgress);
    } catch (e) {
        onProgress('Calibration failed: ' + e.message);
        console.error(e);
        return;
    }
    _cwCalResult = result;
    _cwCalInputs = inputs;
    cwRenderValidationTable(result, inputs);
    cwShowPage('cwResultPage');
}

function cwRenderValidationTable(result, inputs) {
    const tbl = document.getElementById('cwValidationTable');
    if (!tbl) return;
    let html = '<tr><th>Metric</th><th>Target</th><th>Model</th><th>Status</th></tr>';
    for (const [key, g] of Object.entries(result.statuses)) {
        const [label, unit] = CW_METRIC_LABELS[key] || [key, ''];
        const badge = '<span class="cw-badge cw-badge-' + g.status.toLowerCase() + '">' + g.status + '</span>';
        const hint = (g.status === 'OFF') ? '<div class="cw-hint">' + g.hint + '</div>' : '';
        html += '<tr><td>' + label + '</td><td>' + cwFmt(g.target) + ' ' + unit + '</td><td>' +
                cwFmt(g.model) + ' ' + unit + '</td><td>' + badge + hint + '</td></tr>';
    }
    tbl.innerHTML = html;

    const notes = document.getElementById('cwCalNotes');
    if (notes) {
        const lines = result.notes.concat(result.log.filter(l => l.indexOf('did not') >= 0));
        notes.innerHTML =
            (result.overall ? '<div class="cw-error"><b>Calibration could not reproduce a working cycle.</b> ' + result.overall + '</div>' : '') +
            _cwCalWarnings.map(w => '<div class="cw-warn">⚠ ' + w + '</div>').join('') +
            lines.map(n => '<div class="cw-note">' + n + '</div>').join('');
    }
    const knobsEl = document.getElementById('cwDerivedKnobs');
    if (knobsEl) {
        const k = result.knobs;
        knobsEl.innerHTML =
            '<b>Derived physics parameters</b><br>' +
            'Reservoir pressure: ' + k.RESERVOIR_PRESSURE.toFixed(0) + ' psi' + (result.prPinned ? ' (pinned)' : ' (estimated)') + '<br>' +
            'IPR_C: ' + k.WELL_CHARACTERISTICS.IPR_C.toPrecision(3) + '  ·  IPR_n: 0.8<br>' +
            'Storage volume: ' + k.V_STORE_FT3.toFixed(0) + ' ft³<br>' +
            'Fall velocity ref: ' + k.V_FALL_REF.toFixed(0) + ' ft/min<br>' +
            'Plunger drag: ' + k.plungerGasDrag.toExponential(2) + '<br>' +
            'LGR: ' + k.WELL_CHARACTERISTICS.liquidGasRatio.toFixed(2) + ' bbl/MMcf  ·  Valve Cv: ' + k.VALVE_CV;
    }
}

function saveCalibratedWell() {
    if (!_cwCalResult || !_cwCalInputs) return;
    const inputs = _cwCalInputs;
    const knobs = _cwCalResult.knobs;
    const key = cwSlugKey(inputs.name);
    const tubingLabel = inputs.tubingSize === 'custom'
        ? inputs.customTubingIdIn.toFixed(2) + '″ ID'
        : inputs.tubingSize + '″ tubing';
    const label = inputs.name + ' — Packer (' + tubingLabel + ', ' + inputs.depthFt.toFixed(0) + ' ft BSA)';

    const preset = {
        label: label,
        completionType: 'packer',
        WELL_DEPTH: knobs.WELL_DEPTH,
        TUBING_AREA_FT2: knobs.TUBING_AREA_FT2, TUBING_ID_FT: knobs.TUBING_ID_FT,
        FT_PER_BBL: knobs.FT_PER_BBL, LIQUID_PSI_PER_BBL: knobs.LIQUID_PSI_PER_BBL,
        RESERVOIR_PRESSURE: knobs.RESERVOIR_PRESSURE, P_LINE_BASE: knobs.P_LINE_BASE,
        WELL_CHARACTERISTICS: Object.assign({}, knobs.WELL_CHARACTERISTICS),
        V_FALL_REF: knobs.V_FALL_REF, VALVE_CV: knobs.VALVE_CV,
        AFTERFLOW_INFLOW_FACTOR: knobs.AFTERFLOW_INFLOW_FACTOR,
        V_STORE_FT3: knobs.V_STORE_FT3,
        plungerGasDrag: knobs.plungerGasDrag,
        INITIAL: Object.assign({}, knobs.INITIAL),
        controller: cwControllerBlock(inputs.ctrl)
    };
    const record = {
        label: label,
        preset: preset,
        inputs: inputs,
        validation: { metrics: _cwCalResult.metrics, statuses: _cwCalResult.statuses, calibratedAt: Date.now() }
    };
    saveCustomWell(key, record);

    _cwSnapshot = null;   // committed — snapshot no longer needed
    const sel = document.getElementById('wellPresetSelect');
    if (sel) sel.value = key;
    applyWellPreset(key);
    if (typeof closeInstructions === 'function') closeInstructions();
    document.getElementById('customWellModal').classList.add('hidden');
}

function cwRenderManageList() {
    const list = document.getElementById('cwManageList');
    if (!list) return;
    const store = loadCustomWells();
    const keys = Object.keys(store.wells);
    if (!keys.length) { list.innerHTML = '<div class="cw-note">No saved custom wells yet.</div>'; return; }
    list.innerHTML = keys.map(k =>
        '<div class="cw-manage-row"><span>' + store.wells[k].label + '</span>' +
        '<button onclick="deleteCustomWell(\'' + k + '\')">Delete</button></div>'
    ).join('');
}

// === SECTION 8: STARTUP MERGE ===
// Guarded so the Node vm test harness (no localStorage, mock document) loads cleanly.
try {
    mergeCustomWellsIntoUI();
} catch (e) {
    console.warn('custom-well: startup merge skipped —', e.message);
}
