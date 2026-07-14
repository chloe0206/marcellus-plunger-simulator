// test-packer-wellA-cal.js — Chunk 4: Well A calibration test
//
// Targets (from Expand Energy spreadsheet):
//   ~2 cycles/day        | actual: 2
//   ~675 Mcf/day         | actual flow rate 650-700 Mcfd, daily 675
//   ~370 psi SI tubing   | actual peak after 50-min shut-in
//   ~15-18 min lift      | actual rise time
//   ~42 min plunger fall | actual drop time
//   ~0.5-0.7 bbl/d water | actual liquid production
//
// Knobs being calibrated:
//   RESERVOIR_PRESSURE, IPR_C, V_STORE_FT3, V_FALL_REF, WELL_DEPTH
//
// Run: node Marcellus-simulator-demo-EXE/js/test-packer-wellA-cal.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

// === WELL A CALIBRATION KNOBS (tune these) ===
const CAL = {
    WELL_DEPTH:           6893,    // BSA depth (plunger travel)
    RESERVOIR_PRESSURE:   650,
    IPR_C:                0.048,   // re-derived after adding afterflow tubing friction (was 0.040);
                                   // restores ~700 Mcfd equilibrium above the 650 close trigger
    IPR_n:                0.8,
    liquidGasRatio:       1.0,     // bbl/MMcf — Well A is essentially dry
    P_LINE_BASE:          312,
    V_STORE_FT3:          6000,
    V_FALL_REF:           800,     // ~177 ft/min at low casing → ~39 min fall over 6893 ft
    VALVE_CV:             10.0,    // wide-open choke → flow IPR-limited, not choke-limited
    AFTERFLOW_INFLOW_FACTOR: 1.0,  // packer wells: continuous formation feed (no annular drawdown lag)
    plungerGasDrag:       6.0e-4,  // Phase 2a: slows dry lift toward 15-18 min target
    // Controller (Well A actual operator settings)
    inOpenOffTimeVal:     '50',
    inCloseFlowVal:       '650',
    inCloseDly:           '2',
    inMaxAft:             '720',   // large so flow trigger fires first
    inMaxShutIn:          '120',
    inPlgDrop:            '42',    // Well A operator: drop timer matches actual drop time
    inMinAft:             '5'
};

// --- Mock DOM ---
const mockElements = {};
function createMockElement(o) {
    return {
        value: '0', checked: false, innerText: '', innerHTML: '', textContent: '',
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        style: {},
        getContext() { return {
            clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
            fillRect(){}, strokeRect(){}, fillText(){}, measureText(){ return {width:0}; },
            arc(){}, save(){}, restore(){}, translate(){}, scale(){}, setTransform(){},
            createLinearGradient(){ return { addColorStop(){} }; }
        }; },
        width: 800, height: 400,
        appendChild(){}, removeChild(){}, setAttribute(){}, getAttribute(){ return ''; },
        addEventListener(){},
        ...o
    };
}
const defaults = {
    'inMaxWait':          { value: '30' },
    'inMinAft':           { value: CAL.inMinAft },
    'inMaxAft':           { value: CAL.inMaxAft },
    'inCloseDly':         { value: CAL.inCloseDly },
    'inPlgDrop':          { value: CAL.inPlgDrop },
    'inMandatory':        { value: '0' },
    'inMaxShutIn':        { value: CAL.inMaxShutIn },
    'inDeviationAngle':   { value: '0' },
    // No casing triggers — packer well
    'chkOpenCsg':         { checked: false }, 'inOpenCsgVal':       { value: '999' },
    'chkOpenDiff':        { checked: false }, 'inOpenDiffVal':      { value: '0' },
    'chkOpenLoad':        { checked: false }, 'inOpenLoadVal':      { value: '0' },
    // Off Time open trigger = Well A's 50-min operator setting
    'chkOpenOffTime':     { checked: true  }, 'inOpenOffTimeVal':   { value: CAL.inOpenOffTimeVal },
    'chkOpenArmedTime':   { checked: false }, 'inOpenArmedTimeVal': { value: '60' },
    'chkOpenTubing':      { checked: false }, 'inOpenTubingVal':    { value: '999' },
    'chkOpenTbgLine':     { checked: false }, 'inOpenTbgLineVal':   { value: '0' },
    // Flow close trigger = Well A's "less than 650 Mcfd" setting
    'chkCloseFlow':       { checked: true  }, 'inCloseFlowVal':     { value: CAL.inCloseFlowVal },
    'chkCloseDP':         { checked: false }, 'inCloseDPVal':       { value: '0' },
    'chkCloseOnTime':     { checked: false }, 'inCloseOnTimeVal':   { value: '180' },
    'chkCloseCasing':     { checked: false }, 'inCloseCasingVal':   { value: '0' },
    'chkCloseTubing':     { checked: false }, 'inCloseTubingVal':   { value: '0' },
    'chkCloseCsgTbg':     { checked: false }, 'inCloseCsgTbgVal':   { value: '0' },
    'chkCloseCsgLine':    { checked: false }, 'inCloseCsgLineVal':  { value: '0' },
    'speedSelect':        { value: '60' },
    'chartViewSelect':    { value: '1440' }
};
for (const [id, o] of Object.entries(defaults)) mockElements[id] = createMockElement(o);
function mockGetElementById(id) {
    if (!mockElements[id]) mockElements[id] = createMockElement();
    return mockElements[id];
}

let combined = `
function logEvent(){} function renderStatus(){} function updateArrivalsTable(){}
function logCycleSummary(){} function updateUI(){} function drawChart(){}
function updateChart(){} function drawWellbore(){} function showInstructions(){}
function captureOpeningData(){} function captureClosingData(){} function updateCycleTable(){}
function updateDailySummary(){}
`;
for (const f of ['config.js', 'physics.js', 'controller.js', 'simulation.js']) {
    combined += `\n// --- ${f} ---\n` + fs.readFileSync(path.join(BASE, f), 'utf-8') + '\n';
}

const calJson = JSON.stringify(CAL);
combined += `
COMPLETION_TYPE = 'packer';
var __CAL = ${calJson};

WELL_DEPTH         = __CAL.WELL_DEPTH;
RESERVOIR_PRESSURE = __CAL.RESERVOIR_PRESSURE;
WELL_CHARACTERISTICS = { liquidGasRatio: __CAL.liquidGasRatio, IPR_C: __CAL.IPR_C, IPR_n: __CAL.IPR_n };
P_LINE_BASE        = __CAL.P_LINE_BASE;
V_STORE_FT3        = __CAL.V_STORE_FT3;
V_FALL_REF         = __CAL.V_FALL_REF;
VALVE_CV           = __CAL.VALVE_CV;
AFTERFLOW_INFLOW_FACTOR = __CAL.AFTERFLOW_INFLOW_FACTOR;
PLUNGER_GAS_DRAG_ACTIVE = __CAL.plungerGasDrag;

// Initial state
P_line = P_LINE_BASE;
P_tubing = P_line + 5;
P_casing = P_line;
liquidInTubing = 0.3;
liquidAbovePlunger = 0.3;
liquidBelowPlunger = 0;
liquidColumnPsi = liquidAbovePlunger * LIQUID_PSI_PER_BBL;
Pwf = 0;
state = 'ARMED_SHUTIN';
stateTimer = 0;
PlungerDepth = WELL_DEPTH;
PlungerVel = 0;
FlowRate = 0;
totalOnTime = 0;
totalOffTime = 0;
totalShutInMins = 0;

// --- Cycle metrics tracker ---
var cycles = [];
var current = null;  // current cycle being tracked
var lastState = state;
var prevPlgDepth = WELL_DEPTH;
var fallStartT = null;
var lastSIpeakP_tbg = 0;

// Steady-flow (post-arrival-transient) accumulators
var steadyTbgSum = 0, steadyTbgN = 0, steadyTbgMin = Infinity, steadyTbgMax = 0;
var steadyFlowSum = 0, steadyFlowN = 0, steadyFlowMin = Infinity, steadyFlowMax = 0;
var steadyPwfMin = Infinity, steadyPwfMax = 0;

for (var i = 0; i < 1440; i++) {  // 24 hours
    simTime += 1.0;
    stateTimer += 1.0;

    // Capture cycle-start of fall when LIFTING→AFTERFLOW arrives, no:
    // Track plunger arrival to begin a cycle, fall when close happens.
    var prevState = state;
    updatePhysics(1.0);
    checkLogic();

    // Track SI peak tubing pressure (across all shut-in states — Pwf builds the whole time)
    if ((state === 'UNARMED_SHUTIN' || state === 'ARMED_SHUTIN' || state === 'MANDATORY_SHUTIN')
        && P_tubing > lastSIpeakP_tbg) {
        lastSIpeakP_tbg = P_tubing;
    }

    // State transitions
    if (state !== prevState) {
        if (prevState === 'ARMED_SHUTIN' && state === 'LIFTING') {
            // Cycle begins (lift starts)
            current = {
                startT: simTime,
                SIpeakP_tbg: lastSIpeakP_tbg,
                liftStartT: simTime,
                liftStartPwf: Pwf,
                fallStartT: null,
                fallEndT: null,
                arrivalT: null,
                arrivalPwf: null,
                closeT: null,
                liftMin: null,
                afterflowMin: null,
                fallMin: null,
                afterflowMcf: 0,
                afterflowPeakFlow: 0
            };
            lastSIpeakP_tbg = 0;  // reset SI peak tracker for next cycle
        }
        if (prevState === 'LIFTING' && state === 'AFTERFLOW' && current) {
            current.arrivalT = simTime;
            current.arrivalPwf = Pwf;
            current.liftMin = simTime - current.liftStartT;
        }
        if (prevState === 'AFTERFLOW' && state === 'UNARMED_SHUTIN' && current) {
            current.closeT = simTime;
            current.afterflowMin = simTime - current.arrivalT;
            current.fallStartT = simTime;
            // Push the completed cycle NOW — don't wait for next lift to start.
            cycles.push(current);
        }
        // Plunger-fall completion: when PlungerDepth reaches WELL_DEPTH after a close
        if (prevState === 'UNARMED_SHUTIN' && state === 'ARMED_SHUTIN') {
            // 'current' has already been pushed; back-fill fallMin on the most recent cycle
            if (cycles.length > 0 && cycles[cycles.length-1].fallStartT !== null && cycles[cycles.length-1].fallEndT === null) {
                cycles[cycles.length-1].fallEndT = simTime;
                cycles[cycles.length-1].fallMin = simTime - cycles[cycles.length-1].fallStartT;
            }
        }
    }

    // Accumulate afterflow gas
    if (state === 'AFTERFLOW' && current) {
        current.afterflowMcf += FlowRate * (1.0 / 1440);
        if (FlowRate > current.afterflowPeakFlow) current.afterflowPeakFlow = FlowRate;
    }

    // STEADY-STATE sampling: skip the first 10 min of afterflow (arrival transient),
    // record flowing tubing + flow band to compare against the SCADA trend.
    if (state === 'AFTERFLOW' && current && current.arrivalT && (simTime - current.arrivalT) > 10) {
        steadyTbgSum += P_tubing; steadyTbgN++;
        if (P_tubing < steadyTbgMin) steadyTbgMin = P_tubing;
        if (P_tubing > steadyTbgMax) steadyTbgMax = P_tubing;
        steadyFlowSum += FlowRate; steadyFlowN++;
        if (FlowRate < steadyFlowMin) steadyFlowMin = FlowRate;
        if (FlowRate > steadyFlowMax) steadyFlowMax = FlowRate;
        if (Pwf < steadyPwfMin) steadyPwfMin = Pwf;
        if (Pwf > steadyPwfMax) steadyPwfMax = Pwf;
    }
}

// Track lift-starts as the cycle initiation count (more meaningful than "completed cycles")
var liftStartCount = 0;
for (var k = 0; k < cycles.length; k++) liftStartCount++;
if (current && current.liftStartT !== null && (cycles.length === 0 || cycles[cycles.length-1] !== current)) liftStartCount++;

({
    cycles: cycles,
    inProgress: (current && state === 'AFTERFLOW') ? current : null,
    liftStartCount: liftStartCount,
    finalState: state,
    totalProductionMcf: totalProductionMcf || 0,
    totalLiquidBbl: totalLiquidProducedBbl || 0,
    initialLiquidBbl: 0.3,  // for adjusting liquid metric
    completedCycleCount: completedCycleCount || 0,
    steadyTbg: steadyTbgN ? steadyTbgSum/steadyTbgN : 0,
    steadyTbgMin: steadyTbgMin === Infinity ? 0 : steadyTbgMin,
    steadyTbgMax: steadyTbgMax,
    steadyFlow: steadyFlowN ? steadyFlowSum/steadyFlowN : 0,
    steadyFlowMin: steadyFlowMin === Infinity ? 0 : steadyFlowMin,
    steadyFlowMax: steadyFlowMax,
    steadyPwfMin: steadyPwfMin === Infinity ? 0 : steadyPwfMin,
    steadyPwfMax: steadyPwfMax,
    P_tubing_final: P_tubing,
    Pwf_final: Pwf,
    simHours: 24
});
`;

const sandbox = {
    document: { getElementById: mockGetElementById },
    console: { log() {}, warn() {}, error() {} },
    Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity, undefined,
    setInterval: () => 0, clearInterval: () => {}
};
vm.createContext(sandbox);

try {
    const r = vm.runInContext(combined, sandbox, { timeout: 60000 });

    console.log('=== WELL A CALIBRATION (Chunk 4) ===');
    console.log(`Knobs: Pr=${CAL.RESERVOIR_PRESSURE}, IPR_C=${CAL.IPR_C}, V_STORE=${CAL.V_STORE_FT3}, V_FALL_REF=${CAL.V_FALL_REF}, WELL_DEPTH=${CAL.WELL_DEPTH}`);
    console.log('');

    const allCycles = r.cycles.slice();
    if (r.inProgress) allCycles.push(r.inProgress);  // include in-progress AF cycle
    console.log(`Lift-starts in 24h: ${r.liftStartCount} (= cycles initiated)`);
    console.log(`Completed (close fired) cycles: ${r.cycles.length}`);
    console.log('');
    if (allCycles.length > 0) {
        console.log('  # | status   |  SI-peak | lift | AF dur | AF Mcf | peak flow | drop');
        console.log('  --+----------+----------+------+--------+--------+-----------+------');
        for (let i = 0; i < allCycles.length; i++) {
            const c = allCycles[i];
            const liftStr = c.liftMin ? c.liftMin.toFixed(1) : '?';
            const afStr = c.afterflowMin ? c.afterflowMin.toFixed(0) : (c.arrivalT ? (r.simHours*60 - c.arrivalT).toFixed(0) + '*' : '?');
            const fallStr = c.fallMin ? c.fallMin.toFixed(0) : (c.closeT ? '?' : '-');
            const status = c.closeT ? 'closed  ' : (c.arrivalT ? 'in AF   ' : 'lifting ');
            console.log(`  ${(i+1).toString().padStart(2)} | ${status} |  ${c.SIpeakP_tbg.toFixed(0).padStart(6)}  | ${liftStr.padStart(4)} | ${afStr.padStart(6)} | ${c.afterflowMcf.toFixed(1).padStart(6)} | ${c.afterflowPeakFlow.toFixed(0).padStart(8)}  | ${fallStr.padStart(4)}`);
        }
    }
    console.log('  (* = AF duration to end of sim, cycle still in progress)');
    console.log('');

    // Aggregate metrics — include in-progress cycle for production/SI/lift
    const cyclesWithArrival = allCycles.filter(c => c.arrivalT);
    const avgSI = cyclesWithArrival.length ? cyclesWithArrival.reduce((a,c) => a + c.SIpeakP_tbg, 0) / cyclesWithArrival.length : 0;
    const avgLift = cyclesWithArrival.length ? cyclesWithArrival.reduce((a,c) => a + (c.liftMin || 0), 0) / cyclesWithArrival.length : 0;
    const closedCycles = allCycles.filter(c => c.closeT);
    const avgAF_closed = closedCycles.length ? closedCycles.reduce((a,c) => a + (c.afterflowMin || 0), 0) / closedCycles.length : 0;
    const totalMcf = allCycles.reduce((a,c) => a + c.afterflowMcf, 0);   // includes in-progress
    const avgFall = closedCycles.length ? closedCycles.reduce((a,c) => a + (c.fallMin || 0), 0) / closedCycles.length : 0;
    const adjustedLiquid = Math.max(0, r.totalLiquidBbl - r.initialLiquidBbl);

    console.log('Targets vs Model:');
    console.log(`  Cycles/day:    ${r.liftStartCount}        (target ~2)`);
    console.log(`  SI tbg peak:   ${avgSI.toFixed(0).padStart(4)} psi (target ~370)`);
    console.log(`  Lift time:     ${avgLift.toFixed(1).padStart(4)} min (target 15-18)`);
    console.log(`  Drop time:     ${avgFall.toFixed(0).padStart(4)} min (target ~42)`);
    console.log(`  Afterflow:     ${avgAF_closed.toFixed(0).padStart(4)} min (closed cycles only)`);
    console.log(`  Production:    ${totalMcf.toFixed(0).padStart(4)} Mcf/day (target ~675)  [includes in-progress AF]`);
    console.log(`  Liquid:        ${adjustedLiquid.toFixed(2)} bbl/d (target 0.5-0.7, initial slug ${r.initialLiquidBbl} bbl subtracted)`);
    console.log('');
    console.log('Steady-flow profile (post-arrival-transient) vs TREND:');
    console.log(`  Flowing tubing: ${r.steadyTbg.toFixed(0)} psi avg [${r.steadyTbgMin.toFixed(0)}-${r.steadyTbgMax.toFixed(0)}]  (TREND: flat ~325, line=312)`);
    console.log(`  Flow band:      ${r.steadyFlow.toFixed(0)} Mcfd avg [${r.steadyFlowMin.toFixed(0)}-${r.steadyFlowMax.toFixed(0)}]  (TREND: 650-780)`);
    console.log(`  Pwf (flowing):  [${r.steadyPwfMin.toFixed(0)}-${r.steadyPwfMax.toFixed(0)}] psi`);

    // Tolerance assertions
    let pass = true;
    const fails = [];
    if (r.liftStartCount < 1 || r.liftStartCount > 4) {
        pass = false; fails.push(`lift-starts/day out of band: ${r.liftStartCount}`);
    }
    if (Math.abs(avgSI - 370) > 60) {
        pass = false; fails.push(`SI peak ${avgSI.toFixed(0)} not within 60 psi of 370`);
    }
    if (avgLift < 8 || avgLift > 30) {
        pass = false; fails.push(`lift time ${avgLift.toFixed(1)} out of band 8-30 min`);
    }
    if (totalMcf < 400 || totalMcf > 1200) {
        pass = false; fails.push(`production ${totalMcf.toFixed(0)} out of band 400-1200`);
    }

    console.log('');
    if (pass) {
        console.log('PASS — model in the calibration tolerance band.');
    } else {
        console.log('NEEDS TUNING:');
        fails.forEach(f => console.log('  -', f));
    }
} catch (err) {
    console.log('ERROR:', err.message);
    if (err.stack) console.log(err.stack.split('\n').slice(0, 10).join('\n'));
    process.exit(1);
}
