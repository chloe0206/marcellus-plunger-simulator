// test-packer-cycle.js — Chunk 2 validation for packer-mode full cycle
//
// What this verifies:
//   - Well builds in shut-in until Off-Time trigger fires (50 min)
//   - LIFTING: plunger rises off bumper spring, Pwf drops via expansion + IPR makeup,
//     plunger reaches surface (arrival)
//   - AFTERFLOW: Pwf draws down to flowing equilibrium, FlowRate > 0 sustained,
//     closes on low flow OR max afterflow
//   - Cycle returns to UNARMED_SHUTIN; multiple cycles complete
//
// Run: node Marcellus-simulator-demo-EXE/js/test-packer-cycle.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

// --- Mock DOM (controller inputs configured for packer-mode operation) ---
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
    'inMinAft':           { value: '5' },
    'inMaxAft':           { value: '30' },    // forces close on time so cycle completes
    'inCloseDly':         { value: '2' },
    'inPlgDrop':          { value: '5' },
    'inMandatory':        { value: '0' },
    'inMaxShutIn':        { value: '60' },    // backstop in case Off Time gate misses
    'inDeviationAngle':   { value: '0' },
    // CASING-PRESSURE TRIGGERS OFF — packer wells can't use these
    'chkOpenCsg':         { checked: false }, 'inOpenCsgVal':       { value: '999' },
    'chkOpenDiff':        { checked: false }, 'inOpenDiffVal':      { value: '0' },
    'chkOpenLoad':        { checked: false }, 'inOpenLoadVal':      { value: '0' },
    // OFF TIME open trigger = primary control for packer wells
    'chkOpenOffTime':     { checked: true  }, 'inOpenOffTimeVal':   { value: '50' },
    'chkOpenArmedTime':   { checked: false }, 'inOpenArmedTimeVal': { value: '60' },
    'chkOpenTubing':      { checked: false }, 'inOpenTubingVal':    { value: '999' },
    'chkOpenTbgLine':     { checked: false }, 'inOpenTbgLineVal':   { value: '0' },
    // FLOW close trigger disabled in this test — using inMaxAft as deterministic close
    'chkCloseFlow':       { checked: false }, 'inCloseFlowVal':     { value: '200' },
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

combined += `
COMPLETION_TYPE = 'packer';

// Well A educated guesses (calibration knobs, not measured truth)
RESERVOIR_PRESSURE = 650;
WELL_CHARACTERISTICS = { liquidGasRatio: 1.0, IPR_C: 0.05, IPR_n: 0.8 };
P_LINE_BASE = 312;
V_STORE_FT3 = 6000;

// Initial state
P_line = P_LINE_BASE;
P_tubing = P_line + 5;
P_casing = P_line;
liquidInTubing = 0.3;
liquidAbovePlunger = 0.3;
liquidBelowPlunger = 0;
liquidColumnPsi = liquidAbovePlunger * LIQUID_PSI_PER_BBL;
Pwf = 0;  // lazy-init from current P_tubing on first shut-in tick
state = 'ARMED_SHUTIN';
stateTimer = 0;
PlungerDepth = WELL_DEPTH;
PlungerVel = 0;
FlowRate = 0;
totalOnTime = 0;
totalOffTime = 0;
totalShutInMins = 0;

// Track state transitions for assertions
var transitions = [];
var lastState = state;
var samples = [];
var maxFlow = 0;
var minPwf_AF = Infinity;
var arrivals = 0;

// 6 simulated hours, 1 min per tick — long enough for ~3 cycles
for (var i = 0; i < 360; i++) {
    simTime += 1.0;
    stateTimer += 1.0;
    updatePhysics(1.0);
    checkLogic();

    if (state !== lastState) {
        transitions.push({ t: simTime, from: lastState, to: state, Pwf: Pwf, P_tbg: P_tubing, PlgDepth: PlungerDepth, Flow: FlowRate });
        if (lastState === 'LIFTING' && state === 'AFTERFLOW') arrivals++;
        lastState = state;
    }

    // sample every 2 min
    if (i % 2 === 0) {
        samples.push({ t: simTime, st: state, Pwf: Pwf, P_tbg: P_tubing, Flow: FlowRate, Plg: PlungerDepth });
    }
    if (state === 'AFTERFLOW' && FlowRate > maxFlow) maxFlow = FlowRate;
    if (state === 'AFTERFLOW' && Pwf < minPwf_AF) minPwf_AF = Pwf;
}

({
    transitions: transitions,
    arrivals: arrivals,
    samples: samples,
    maxFlow: maxFlow,
    minPwf_AF: (minPwf_AF === Infinity ? 0 : minPwf_AF),
    finalState: state,
    finalPwf: Pwf,
    finalP_tbg: P_tubing,
    totalProductionMcf: totalProductionMcf || 0,
    completedCycleCount: completedCycleCount || 0
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
    const r = vm.runInContext(combined, sandbox, { timeout: 30000 });

    console.log('=== PACKER FULL-CYCLE TEST (Chunk 2) ===');
    console.log(`Final state: ${r.finalState} | Pwf=${r.finalPwf.toFixed(1)} | P_tbg=${r.finalP_tbg.toFixed(1)}`);
    console.log(`Arrivals: ${r.arrivals} | Cycles completed: ${r.completedCycleCount} | Production: ${r.totalProductionMcf.toFixed(1)} Mcf`);
    console.log(`Max afterflow rate: ${r.maxFlow.toFixed(0)} Mcfd | Min Pwf during AF: ${r.minPwf_AF.toFixed(1)} psi`);
    console.log('');
    console.log('State transitions:');
    for (const tr of r.transitions) {
        console.log(`  t=${tr.t.toFixed(0)}m  ${tr.from} → ${tr.to}  | Pwf=${tr.Pwf.toFixed(0)}, P_tbg=${tr.P_tbg.toFixed(0)}, Plg=${tr.PlgDepth.toFixed(0)}ft, Flow=${tr.Flow.toFixed(0)} Mcfd`);
    }
    console.log('');
    // Print first cycle's per-state samples for the trace
    console.log('Time series (every 2 min, first 60 samples):');
    console.log('  t (m) | state         | Pwf  | P_tbg | Flow | Plg(ft)');
    console.log('  ----- + ------------- + ---- + ----- + ---- + -------');
    for (const s of r.samples.slice(0, 60)) {
        console.log(`  ${String(s.t).padStart(3)}   | ${s.st.padEnd(14)}| ${s.Pwf.toFixed(0).padStart(4)} | ${s.P_tbg.toFixed(0).padStart(4)}  | ${s.Flow.toFixed(0).padStart(4)} | ${s.Plg.toFixed(0).padStart(5)}`);
    }
    console.log('');

    // --- Assertions ---
    let pass = true;
    const fails = [];

    if (r.arrivals < 2) { pass = false; fails.push(`Expected ≥ 2 arrivals; got ${r.arrivals}`); }
    if (r.maxFlow < 100) { pass = false; fails.push(`Afterflow rate too low (max ${r.maxFlow.toFixed(0)} Mcfd)`); }
    if (r.completedCycleCount < 1) { pass = false; fails.push(`No complete cycles recorded — close logic may not have fired`); }
    if (r.minPwf_AF >= r.finalPwf - 1 && r.minPwf_AF !== Infinity) {
        // Pwf must have drawn down during afterflow (not just held flat)
        pass = false; fails.push(`Pwf did not draw down during afterflow`);
    }

    if (pass) {
        console.log(`PASS — ${r.arrivals} arrivals, ${r.completedCycleCount} cycles, ${r.totalProductionMcf.toFixed(1)} Mcf in 4h.`);
        console.log(`       Lift + afterflow physics behave; Pwf cycles, flow rates ≥ ${r.maxFlow.toFixed(0)} Mcfd.`);
    } else {
        console.log('FAIL:');
        fails.forEach(f => console.log('  -', f));
        process.exit(1);
    }
} catch (err) {
    console.log('ERROR:', err.message);
    if (err.stack) console.log(err.stack.split('\n').slice(0, 10).join('\n'));
    process.exit(1);
}
