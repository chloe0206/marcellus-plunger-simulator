// test-node-smoke.js — Node.js headless smoke test for plunger lift simulator
// Mocks the browser DOM, loads core JS files, runs 24h of simulation, checks key outputs.
// Run: node plunger-lift-simulator-1/js/test-node-smoke.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname);

// --- Mock DOM ---
const mockElements = {};

function createMockElement(overrides) {
    return {
        value: '0',
        checked: false,
        innerText: '',
        innerHTML: '',
        textContent: '',
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        style: {},
        getContext() {
            return {
                clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
                fill() {}, fillRect() {}, strokeRect() {}, fillText() {},
                measureText() { return { width: 0 }; },
                arc() {}, save() {}, restore() {}, translate() {}, scale() {}, setTransform() {},
                createLinearGradient() { return { addColorStop() {} }; }
            };
        },
        width: 800,
        height: 400,
        appendChild() {}, removeChild() {}, setAttribute() {},
        getAttribute() { return ''; },
        addEventListener() {},
        ...overrides
    };
}

// Pre-populate controller inputs with known-good defaults
const defaults = {
    // Controller timing
    'inMaxWait':          { value: '30' },
    'inMinAft':           { value: '5' },
    'inMaxAft':           { value: '25' },
    'inCloseDly':         { value: '0' },
    'inPlgDrop':          { value: '5' },
    'inMandatory':        { value: '0' },
    'inMaxShutIn':        { value: '60' },
    'inDeviationAngle':   { value: '0' },
    // Open triggers
    'chkOpenCsg':         { checked: true },
    'inOpenCsgVal':       { value: '572' },
    'chkOpenDiff':        { checked: false },
    'inOpenDiffVal':      { value: '100' },
    'chkOpenLoad':        { checked: false },
    'inOpenLoadVal':      { value: '70' },
    'chkOpenOffTime':     { checked: false },
    'inOpenOffTimeVal':   { value: '120' },
    'chkOpenArmedTime':   { checked: false },
    'inOpenArmedTimeVal': { value: '60' },
    'chkOpenTubing':      { checked: false },
    'inOpenTubingVal':    { value: '300' },
    'chkOpenTbgLine':     { checked: false },
    'inOpenTbgLineVal':   { value: '100' },
    // Close triggers
    'chkCloseFlow':       { checked: true },
    'inCloseFlowVal':     { value: '50' },
    'chkCloseDP':         { checked: false },
    'inCloseDPVal':       { value: '20' },
    'chkCloseOnTime':     { checked: false },
    'inCloseOnTimeVal':   { value: '60' },
    'chkCloseCasing':     { checked: false },
    'inCloseCasingVal':   { value: '200' },
    'chkCloseTubing':     { checked: false },
    'inCloseTubingVal':   { value: '200' },
    'chkCloseCsgTbg':     { checked: false },
    'inCloseCsgTbgVal':   { value: '200' },
    'chkCloseCsgLine':    { checked: false },
    'inCloseCsgLineVal':  { value: '50' },
    // Speed/view (not used in headless, but simulation.js references them)
    'speedSelect':        { value: '60' },
    'chartViewSelect':    { value: '1440' }
};

for (const [id, overrides] of Object.entries(defaults)) {
    mockElements[id] = createMockElement(overrides);
}

function mockGetElementById(id) {
    if (!mockElements[id]) {
        mockElements[id] = createMockElement();
    }
    return mockElements[id];
}

// --- Build combined source ---
// Stub functions from ui.js, chart.js, wellbore.js, help.js (not needed for physics)
let combinedSource = `
function logEvent() {}
function renderStatus() {}
function updateArrivalsTable() {}
function logCycleSummary() {}
function updateUI() {}
function drawChart() {}
function updateChart() {}
function drawWellbore() {}
function showInstructions() {}
`;

// Load core files in dependency order
const files = ['config.js', 'physics.js', 'controller.js', 'simulation.js'];
for (const file of files) {
    const filePath = path.join(BASE, file);
    const src = fs.readFileSync(filePath, 'utf-8');
    combinedSource += `\n// --- ${file} ---\n${src}\n`;
}

// Append the test loop and result extraction
combinedSource += `
// --- SMOKE TEST LOOP ---
var SIM_MINUTES = 1440; // 24 simulated hours
var dt_test = 1.0;      // 1 minute per tick

for (var _i = 0; _i < SIM_MINUTES; _i++) {
    simTime += dt_test;
    stateTimer += dt_test;
    updatePhysics(dt_test);
    checkLogic();
}

// Return results for assertion
({
    cycles: completedCycleCount,
    production: totalProductionMcf,
    P_casing: P_casing,
    P_tubing: P_tubing,
    liquidAccumulationBbl: liquidAccumulationBbl,
    finalState: state
});
`;

// --- Create sandbox and run ---
const sandbox = {
    document: { getElementById: mockGetElementById },
    console: { log() {}, warn() {}, error() {} },  // suppress physics logging
    Math, parseFloat, parseInt,
    setInterval: () => 0,
    clearInterval: () => {},
    isNaN, isFinite, NaN, Infinity, undefined
};
vm.createContext(sandbox);

try {
    const result = vm.runInContext(combinedSource, sandbox, { timeout: 30000 });

    // --- Assertions ---
    let passed = true;
    const errors = [];

    function assert(condition, msg) {
        if (!condition) { passed = false; errors.push(msg); }
    }

    assert(result.cycles > 5,
        `completedCycleCount (${result.cycles}) should be > 5`);
    assert(result.production > 50,
        `totalProductionMcf (${result.production.toFixed(1)}) should be > 50`);
    assert(result.P_casing > 0,
        `P_casing (${result.P_casing.toFixed(1)}) should be > 0`);
    assert(result.P_casing < 800,
        `P_casing (${result.P_casing.toFixed(1)}) should be < 800`);
    assert(result.P_tubing > 0,
        `P_tubing (${result.P_tubing.toFixed(1)}) should be > 0`);
    assert(result.P_tubing <= result.P_casing + 1,
        `P_tubing (${result.P_tubing.toFixed(1)}) should be <= P_casing (${result.P_casing.toFixed(1)})`);
    assert(result.liquidAccumulationBbl < 5.0,
        `liquidAccumulationBbl (${result.liquidAccumulationBbl.toFixed(3)}) should be < 5.0`);

    const dailyMcf = result.production;  // 1440 min = 1 day

    if (passed) {
        console.log(`SMOKE TEST PASSED \u2014 ${result.cycles} cycles, ${dailyMcf.toFixed(1)} Mcf/day, ${result.liquidAccumulationBbl.toFixed(3)} bbl liquid`);
    } else {
        console.log('SMOKE TEST FAILED:');
        errors.forEach(e => console.log(`  FAIL: ${e}`));
        process.exit(1);
    }
} catch (err) {
    console.log('SMOKE TEST ERROR:', err.message);
    if (err.stack) console.log(err.stack.split('\n').slice(0, 5).join('\n'));
    process.exit(1);
}
