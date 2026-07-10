// test-packer-buildup.js — Chunk 1 validation for packer-mode shut-in buildup
//
// What this verifies:
//   - With COMPLETION_TYPE='packer', Pwf rises asymptotically toward Pr via
//     IPR inflow into V_STORE_FT3 (no casing accumulator involved).
//   - Surface tubing follows Pwf − liquid head − flat gas column.
//   - P_casing stays pinned (dead annulus); no boundary checks fight us.
//
// Configures the well with Well A-ish educated guesses (Pr, IPR_C, V_STORE,
// LGR), holds the controller in ARMED_SHUTIN, and runs 60 sim minutes.
// Run: node Marcellus-simulator-demo-EXE/js/test-packer-buildup.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

// --- Mock DOM (minimal; all triggers OFF so we stay in shut-in) ---
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
    'inMaxAft':           { value: '25' },
    'inCloseDly':         { value: '0' },
    'inPlgDrop':          { value: '5' },
    'inMandatory':        { value: '0' },
    'inMaxShutIn':        { value: '9999' },  // never expire during the test
    'inDeviationAngle':   { value: '0' },
    // All open triggers OFF → ARMED_SHUTIN won't transition out
    'chkOpenCsg':         { checked: false }, 'inOpenCsgVal':       { value: '999' },
    'chkOpenDiff':        { checked: false }, 'inOpenDiffVal':      { value: '0' },
    'chkOpenLoad':        { checked: false }, 'inOpenLoadVal':      { value: '0' },
    'chkOpenOffTime':     { checked: false }, 'inOpenOffTimeVal':   { value: '9999' },
    'chkOpenArmedTime':   { checked: false }, 'inOpenArmedTimeVal': { value: '9999' },
    'chkOpenTubing':      { checked: false }, 'inOpenTubingVal':    { value: '9999' },
    'chkOpenTbgLine':     { checked: false }, 'inOpenTbgLineVal':   { value: '9999' },
    'chkCloseFlow':       { checked: false }, 'inCloseFlowVal':     { value: '0' },
    'chkCloseDP':         { checked: false }, 'inCloseDPVal':       { value: '0' },
    'chkCloseOnTime':     { checked: false }, 'inCloseOnTimeVal':   { value: '9999' },
    'chkCloseCasing':     { checked: false }, 'inCloseCasingVal':   { value: '0' },
    'chkCloseTubing':     { checked: false }, 'inCloseTubingVal':   { value: '0' },
    'chkCloseCsgTbg':     { checked: false }, 'inCloseCsgTbgVal':   { value: '9999' },
    'chkCloseCsgLine':    { checked: false }, 'inCloseCsgLineVal':  { value: '0' },
    'speedSelect':        { value: '60' },
    'chartViewSelect':    { value: '1440' }
};
for (const [id, o] of Object.entries(defaults)) mockElements[id] = createMockElement(o);
function mockGetElementById(id) {
    if (!mockElements[id]) mockElements[id] = createMockElement();
    return mockElements[id];
}

// --- Build combined source ---
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

// --- Test harness: configure packer mode + Well A-ish, run shut-in ---
combined += `
COMPLETION_TYPE = 'packer';

// Well A educated guesses (these are calibration knobs, not measured truth):
RESERVOIR_PRESSURE = 650;
WELL_CHARACTERISTICS = { liquidGasRatio: 1.0, IPR_C: 0.05, IPR_n: 0.8 };
P_LINE_BASE = 312;
V_STORE_FT3 = 6000;

// Initial wellbore state: just-opened-and-closed feel
P_line = P_LINE_BASE;
P_tubing = P_line + 5;
P_casing = P_line;
liquidInTubing = 0.5;
liquidAbovePlunger = 0.5;
liquidBelowPlunger = 0;
liquidColumnPsi = liquidAbovePlunger * LIQUID_PSI_PER_BBL;
Pwf = 0;  // will lazy-init on first tick from P_tubing + columns
state = 'ARMED_SHUTIN';
stateTimer = 0;
PlungerDepth = WELL_DEPTH;
PlungerVel = 0;
FlowRate = 0;

// Run 60 sim minutes of shut-in, sample every 5
var samples = [];
samples.push({ t: 0, Pwf: 0, P_tbg: P_tubing, P_csg: P_casing, state: state, Q_IPR: 0 });
for (var i = 0; i < 60; i++) {
    simTime += 1.0;
    stateTimer += 1.0;
    updatePhysics(1.0);
    checkLogic();
    if ((i+1) % 5 === 0) {
        // Compute Q_IPR for diagnostic
        var Pwf_abs = Pwf + 14.7;
        var Pr_abs2 = RESERVOIR_PRESSURE + 14.7;
        var dpsq = Math.max(0, Pr_abs2*Pr_abs2 - Pwf_abs*Pwf_abs);
        var Q = WELL_CHARACTERISTICS.IPR_C * Math.pow(dpsq, WELL_CHARACTERISTICS.IPR_n);
        samples.push({ t: simTime, Pwf: Pwf, P_tbg: P_tubing, P_csg: P_casing, state: state, Q_IPR: Q });
    }
}

({
    samples: samples,
    Pr: RESERVOIR_PRESSURE,
    finalPwf: Pwf,
    finalP_tbg: P_tubing,
    finalP_csg: P_casing,
    finalState: state,
    V_store: V_STORE_FT3,
    well_depth: WELL_DEPTH,
    liquidPsi: liquidColumnPsi
});
`;

const sandbox = {
    document: { getElementById: mockGetElementById },
    console: { log() {}, warn() {}, error() {} },  // suppress in-sim chatter
    Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity, undefined,
    setInterval: () => 0, clearInterval: () => {}
};
vm.createContext(sandbox);

try {
    const r = vm.runInContext(combined, sandbox, { timeout: 30000 });

    console.log('=== PACKER BUILDUP TEST (Chunk 1) ===');
    console.log(`Configuration: Pr=${r.Pr} psi, V_store=${r.V_store} ft³, WELL_DEPTH=${r.well_depth} ft, liquidCol=${r.liquidPsi.toFixed(1)} psi`);
    console.log(`Final state: ${r.finalState}`);
    console.log('');
    console.log('  t (min) |    Pwf  |  P_tbg  |  P_csg  | Q_IPR (Mcfd)');
    console.log('  ------- + ------- + ------- + ------- + ------------');
    for (const s of r.samples) {
        console.log(`  ${String(s.t).padStart(5)}   |  ${s.Pwf.toFixed(1).padStart(5)}  |  ${s.P_tbg.toFixed(1).padStart(5)}  |  ${s.P_csg.toFixed(1).padStart(5)}  |   ${s.Q_IPR.toFixed(1)}`);
    }
    console.log('');

    // --- Assertions ---
    let pass = true;
    const fails = [];

    // Pwf must rise monotonically
    let monotonic = true;
    for (let k = 1; k < r.samples.length; k++) {
        if (r.samples[k].Pwf < r.samples[k-1].Pwf - 0.01) { monotonic = false; break; }
    }
    if (!monotonic) { pass = false; fails.push('Pwf is not monotonically increasing'); }

    // Pwf must asymptote BELOW Pr (60 min < full buildup)
    if (r.finalPwf >= r.Pr) {
        pass = false; fails.push(`Pwf (${r.finalPwf.toFixed(1)}) reached/exceeded Pr (${r.Pr}) — should asymptote below`);
    }
    if (r.finalPwf <= r.samples[1].Pwf) {
        pass = false; fails.push('Pwf did not increase from initial value');
    }

    // State must stay in shut-in (no triggers should fire)
    if (r.finalState !== 'ARMED_SHUTIN') {
        pass = false; fails.push(`State transitioned out of shut-in: ${r.finalState}`);
    }

    // Surface tubing should equal Pwf − liquidPsi − G·WELL_DEPTH (within tolerance)
    const expectedTbg = r.finalPwf - r.liquidPsi - 0.025 * (r.well_depth - r.liquidPsi/118 * 259);
    if (Math.abs(r.finalP_tbg - expectedTbg) > 3) {
        pass = false; fails.push(`P_tbg=${r.finalP_tbg.toFixed(1)} doesn't match Pwf−columns=${expectedTbg.toFixed(1)}`);
    }

    // Casing must stay pinned (dead annulus)
    if (Math.abs(r.finalP_csg - 312) > 0.5) {
        pass = false; fails.push(`P_casing (${r.finalP_csg.toFixed(1)}) drifted from line (312)`);
    }

    if (pass) {
        const rise = r.finalPwf - r.samples[1].Pwf;
        console.log(`PASS — Pwf rose ${rise.toFixed(1)} psi over 60 min, asymptoting toward Pr=${r.Pr}`);
        console.log(`       Surface tubing tracks Pwf via flat 0.025 psi/ft gradient.`);
        console.log(`       Casing held at line (dead annulus). Conventional boundary checks gated off.`);
    } else {
        console.log('FAIL:');
        fails.forEach(f => console.log('  -', f));
        process.exit(1);
    }
} catch (err) {
    console.log('ERROR:', err.message);
    if (err.stack) console.log(err.stack.split('\n').slice(0, 8).join('\n'));
    process.exit(1);
}
