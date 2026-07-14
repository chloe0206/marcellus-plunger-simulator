// test-custom-well-cal.js — THE PRODUCT TEST for auto-calibration.
//
// Feeds Well A's operator-spreadsheet numbers through the custom-well
// auto-calibration pipeline (deriveInitialKnobs + coordinate-descent refine)
// with NO hand tuning, and asserts the machine re-derives knobs close to the
// hand-calibrated values from the manual Well A calibration:
//   IPR_C ≈ 0.048, V_STORE ≈ 6000, V_FALL_REF ≈ 800, plungerGasDrag ≈ 6e-4
//
// If this passes, the core of the "operator enters well data → matched model"
// product is proven.
//
// Run: node Marcellus-simulator-demo-EXE/js/test-custom-well-cal.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

// === Well A spreadsheet inputs (operator observables, NOT physics knobs) ===
const INPUTS = {
    name: 'Well A recal',
    tubingSize: '2-3/8',
    customTubingIdIn: NaN,
    depthFt: 6893,
    linePsi: 312,
    flowingTbgPsi: 325,
    siPeakPsi: 370,
    siPeakAfterMin: 50,
    prodMcfd: 675,
    waterBblD: 0.6,
    cyclesPerDay: 2,
    riseMin: 15,
    dropMin: 40,
    stabilizedSiPsi: null,   // the realistic case: no long shut-in data
    ctrl: {
        offTimeMin: 50,
        closeFlowMcfd: 650,
        closeDelayMin: 2,
        dropTimerMin: 42,
        maxAfterflowMin: 720,
        maxShutInMin: 120
    }
};

// === Hand-calibrated reference values (from the manual Well A calibration) ===
const EXPECT = {
    IPR_C:          { lo: 0.03,   hi: 0.07,   hand: 0.048 },
    V_STORE_FT3:    { lo: 3500,   hi: 9500,   hand: 6000 },
    V_FALL_REF:     { lo: 600,    hi: 1100,   hand: 800 },
    plungerGasDrag: { lo: 2e-4,   hi: 1.5e-3, hand: 6.0e-4 }
};

// --- Mock DOM (same pattern as test-packer-wellA-cal.js) ---
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
function mockGetElementById(id) {
    if (!mockElements[id]) mockElements[id] = createMockElement();
    return mockElements[id];
}

// UI stubs (proven safe by the Well A/B cal tests)
let combined = `
function logEvent(){} function renderStatus(){} function updateArrivalsTable(){}
function logCycleSummary(){} function updateUI(){} function drawChart(){}
function updateChart(){} function drawWellbore(){} function showInstructions(){}
function captureOpeningData(){} function captureClosingData(){} function updateCycleTable(){}
function updateDailySummary(){} function closeInstructions(){}
`;
for (const f of ['config.js', 'physics.js', 'controller.js', 'simulation.js', 'custom-well.js']) {
    combined += `\n// --- ${f} ---\n` + fs.readFileSync(path.join(BASE, f), 'utf-8') + '\n';
}

combined += `
var __INPUTS = ${JSON.stringify(INPUTS)};
var __progress = [];
var __result = calibrateCustomWellSync(__INPUTS, function(t){ __progress.push(t); });
({ result: __result, progress: __progress });
`;

const sandbox = {
    document: { getElementById: mockGetElementById },
    console: { log() {}, warn() {}, error() {} },
    Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity, undefined,
    JSON, Object, Array, Date,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn) => { fn(); return 0; }
};
vm.createContext(sandbox);

try {
    const t0 = Date.now();
    const { result } = vm.runInContext(combined, sandbox, { timeout: 120000 });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const k = result.knobs;
    const m = result.metrics;
    const s = result.statuses;

    console.log('=== CUSTOM WELL AUTO-CALIBRATION — PRODUCT TEST (Well A blind re-derivation) ===');
    console.log(`Calibration wall time: ${elapsed}s`);
    console.log('');
    console.log('Re-derived knobs vs hand-calibrated values:');
    const knobVals = {
        IPR_C: k.WELL_CHARACTERISTICS.IPR_C,
        V_STORE_FT3: k.V_STORE_FT3,
        V_FALL_REF: k.V_FALL_REF,
        plungerGasDrag: k.plungerGasDrag
    };
    let pass = true;
    const fails = [];
    for (const [name, band] of Object.entries(EXPECT)) {
        const v = knobVals[name];
        const ok = v >= band.lo && v <= band.hi;
        if (!ok) { pass = false; fails.push(`${name}=${v} outside [${band.lo}, ${band.hi}]`); }
        console.log(`  ${name.padEnd(16)} ${String(v.toPrecision(4)).padStart(10)}   (hand: ${band.hand}, band [${band.lo}, ${band.hi}])  ${ok ? 'OK' : 'FAIL'}`);
    }
    console.log(`  RESERVOIR_PRESSURE ${k.RESERVOIR_PRESSURE.toFixed(0).padStart(8)}   (hand: 650, estimated — not asserted)`);
    console.log('');
    console.log('Validation table (target vs model):');
    for (const [key, g] of Object.entries(s)) {
        console.log(`  ${key.padEnd(16)} target ${String(g.target).padStart(8)}  model ${(isFinite(g.model) ? g.model.toFixed(1) : '—').padStart(8)}  ${g.status}`);
        if (g.status === 'OFF') { pass = false; fails.push(`metric ${key} graded OFF`); }
    }
    console.log('');
    console.log('Calibration log:');
    for (const line of result.log) console.log('  ' + line);
    console.log('');
    if (pass) {
        console.log('PASS — auto-calibration re-derived the hand-calibrated Well A model from spreadsheet inputs alone.');
    } else {
        console.log('FAIL:');
        fails.forEach(f => console.log('  - ' + f));
        process.exit(1);
    }
} catch (err) {
    console.log('ERROR:', err.message);
    if (err.stack) console.log(err.stack.split('\n').slice(0, 12).join('\n'));
    process.exit(1);
}
