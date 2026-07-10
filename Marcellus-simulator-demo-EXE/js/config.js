// --- SIMULATION CONFIGURATION ---
const TICK_RATE_MS = 100; // Update every 100ms
let TIME_SCALE = 60; // 1 second real time = X minutes sim time (adjustable)
let WELL_DEPTH = 7000; // Feet — `let` so per-well presets can override

// Well characteristics (fixed, not operator adjustable)
// Marcellus basin: TRAINING MODE - Liquid Loading Challenge
// High liquid ratio makes well sensitive to timing mistakes
let WELL_CHARACTERISTICS = {
    liquidGasRatio: 125,    // bbl/MMcf (moderate liquid challenge for training)
    // Backpressure IPR: Q = C × (Pr² - Pwf²)^n
    IPR_C: 0.012,           // Deliverability coefficient - tuned for 300-500 Mcfd target
    IPR_n: 0.8              // Turbulence exponent (0.5=high turbulence, 1.0=laminar)
};

// Reservoir and line pressure — use `let` for scenario switching
let RESERVOIR_PRESSURE = 750;       // Reservoir pressure (psig)
let P_LINE_BASE = 200;              // Base line pressure (psig)

// === COMPLETION TYPE ===
// 'conventional' = open casing annulus accumulator (Marcellus default)
// 'packer'       = packed-off annulus; tubing-only storage; time/flow control
// Toggle at runtime via console: COMPLETION_TYPE = 'packer'
let COMPLETION_TYPE = 'conventional';

// === PACKER-MODE PARAMETERS ===
// V_STORE_FT3: effective near-wellbore + hydraulic fracture storage volume (ft³).
// Replaces CASING_VOLUME_FT3 in packer mode. Calibration knob — tune so the
// shut-in tubing pressure recovers to the observed SI value in the well's
// actual shut-in time. Educated default for fracced Marcellus horizontals
// (~6000 ft³ ≈ 40× tubing volume, representing the near-frac network).
let V_STORE_FT3 = 6000;

// Flat gas column gradient (psi/ft) used by the packer-mode surface↔bottom
// transforms. Per engineer feedback, packer mode uses a flat 0.025 psi/ft —
// NOT the pressure-scaled form in calculateBottomholePressure_* used by
// conventional mode.
const GAS_GRADIENT_PSI_PER_FT = 0.025;

// === NUMERICAL SANITY BACKSTOPS (NOT physics) ===
// These exist ONLY to stop a NaN/runaway from propagating. They are set far
// outside any physically reachable value so they NEVER bind in normal operation
// — real behavior (e.g. arrival flow spikes) must emerge from the physics, not
// be clipped to a magic number. If a backstop ever trips, enforceBoundaries logs
// it: that's a signal the model went unphysical and should be investigated, not
// a number to quietly tune. (~10x any real Marcellus/Permian gas well.)
const SANITY_FLOW_MCFD = 50000;     // far above any single-well tubing rate
const SANITY_PLUNGER_VEL = 10000;   // ft/min (~167 ft/s); real plungers peak well under 2000

// Gas properties (fixed, for orifice flow calculations)
const GAS_SG = 0.65;           // Specific gravity (air = 1.0, natural gas ~0.65)
const GAS_TEMP_R = 540;        // Temperature in Rankine (~80°F)
const GAS_Z = 0.92;            // Compressibility factor at operating conditions
const GAS_VISCOSITY_CP = 0.012;    // Gas viscosity in centipoise

// === VELOCITY MODEL TOGGLE ===
// true = Lea 1982 physics-based force balance (recommended)
// false = Legacy empirical K-factor model
const USE_LEA_1982_VELOCITY = true;

// === MULTIPHASE MODEL TOGGLE ===
// true = Hagedorn-Brown framework (excess gravity + 2φ friction, ~40-55 psi correction)
// false = Gas-only Darcy-Weisbach friction (~2-10 psi) — better for training demos
// Toggle at runtime via console: USE_MULTIPHASE_MODEL = true
let USE_MULTIPHASE_MODEL = false;

// === VISUALIZER TOGGLE ===
let visualizerOpen = true;  // Whether the wellbore column is shown

// Plunger properties (for Lea 1982 model)
const PLUNGER_WEIGHT_LBM = 10;     // lbm - typical barstock plunger
const LIQUID_SG = 1.05;            // Specific gravity of produced water
const LIQUID_DENSITY_LBF_FT3 = 62.4 * LIQUID_SG;  // lb/ft³ (65.52)
let FT_PER_BBL = 259;              // feet of tubing per barrel (for 2-3/8" tubing) — `let` for per-well override
const GRAVITY_FT_SEC2 = 32.2;      // ft/sec²

// Lea 1982 friction model: τ = f_L × v² × ρ_L / g, then F = τ × π × d × L_st
const DARCY_FRICTION_FACTOR = 0.03;   // Dimensionless (typical for turbulent pipe flow)
let TUBING_ID_FT = 0.166;             // 1.995 inches = 0.166 ft (for 2-3/8") — `let` for per-well override
// Gas drag + mechanical friction on plunger body (always present, even without liquid)
// Calibrated to give ~1000 fpm terminal velocity for dry lifts
// Units: same as C_friction (lbf per (ft/min)²)
const PLUNGER_GAS_DRAG = 1.0e-4;   // base/default (conventional Marcellus) — never changed

// === PHASE 2a: per-well plunger drag (lift-time calibration) ===
// The physics reads PLUNGER_GAS_DRAG_ACTIVE, not the base const. A preset can raise it
// to slow the plunger to the well's real rise time (dry packer lifts are drag-limited).
// ONE-LINE UNDO: set USE_PER_WELL_DRAG = false → every well falls back to the base
// PLUNGER_GAS_DRAG and this whole feature is inert (nothing else depends on it).
let USE_PER_WELL_DRAG = true;
let PLUNGER_GAS_DRAG_ACTIVE = PLUNGER_GAS_DRAG;
// Barstock plunger seal: liquid retention fraction per minute of travel
// Liquid seeps back past plunger through annular clearance, driven by slug hydrostatic head
// 1.0 = perfect seal (pad plunger), 0.99 = good barstock (~10% loss over 10-min lift),
// 0.97 = worn barstock (~26% loss), 0.95 = badly worn (~40% loss)
const PLUNGER_SEAL_FACTOR = 0.99;

// Plunger fall velocity model
let V_FALL_REF = 1200;             // Reference fall velocity in gas at atmospheric pressure (ft/min) — `let` so presets can override
const V_LIQUID_FALL_REF = 70;      // Reference fall velocity in liquid for good barstock (ft/min)
const WALL_FRICTION_MU = 0.2;      // Plunger/tubing wall friction coefficient

// Valve/tubing properties (fixed)
// Note: Effective Cv for plunger lift is much lower than valve nameplate Cv
// due to tubing restrictions, lubricator, and flow path geometry
let VALVE_CV = 2.0;            // `let` so per-well presets can override (sized for surface motor valve flow capacity)
let TUBING_AREA_FT2 = 0.0217;   // Cross-sectional area for 2-3/8" tubing (1.995" ID) — `let` for per-well override

// Casing annulus volume for depletion calculation
// Marcellus: 5.5" casing (5" ID) with 2-3/8" tubing at 7000 ft depth
// Annular area = π/4 × (5² - 2.375²) = 0.152 ft²
// Volume = 0.152 × 7000 ≈ 1060 ft³
const CASING_VOLUME_FT3 = 1060;

// Initial conditions — single source of truth for reset
const INITIAL_CONDITIONS = {
    P_casing: 450,
    P_tubing: 380,
    liquidInTubing: 0.3
};

// --- STATE VARIABLES ---
let running = false;
let timer = null;
let simTime = 0; // Total minutes elapsed

let state = 'ARMED_SHUTIN'; // Initial State
let stateTimer = 0; // Minutes in current state

// Physics State
// Marcellus: mature well that benefits from plunger lift
// Moderate line pressure (NE PA gathering), mature reservoir
let P_line = P_LINE_BASE;
let P_casing = INITIAL_CONDITIONS.P_casing;
let P_tubing = INITIAL_CONDITIONS.P_tubing;
// Bottomhole flowing pressure (psig) at the perfs.
// First-class driven state in packer mode (mass balance into V_STORE_FT3).
// Initialized lazily on the first shut-in tick if 0; computed from P_casing
// via existing helpers in conventional mode.
let Pwf = 0;
let FlowRate = 0;
let PlungerDepth = 7000; // 7000 is bottom, 0 is surface
let PlungerVel = 0;
let LiquidLoad = 100; // PSI equivalent of liquid

// Mass-conserving gas tracking (initialized at state transitions)
let gasAbovePlunger_scf = 0;  // Gas mass above plunger in standard cubic feet (LIFTING)
let tubingGasScf = 0;         // Gas mass in tubing during AFTERFLOW (two-tank model)

// Two-tank afterflow model
let TUBING_VOLUME_FT3 = TUBING_AREA_FT2 * WELL_DEPTH;    // `let` — recompute on preset change if needed
// Standing valve: orifice connecting casing to tubing at bottom of well
// Typical 1" bore for 2-3/8" plunger systems. Controls casing-to-tubing transfer rate.
const STANDING_VALVE_BORE_IN = 1.0;
// Effective Cv for standing valve (orifice flow coefficient)
// Cv scales with bore area: (SV_area / tubing_area) × choke_Cv × discharge_coeff
// For 1" bore: area = 0.00545 ft², tubing area = 0.0217 ft², ratio = 0.251
// With discharge coefficient 0.65: 0.251 × 0.65 × 1.2 ≈ 0.196
const STANDING_VALVE_CV = 0.65 * (Math.PI / 4 * Math.pow(STANDING_VALVE_BORE_IN / 12, 2)) / TUBING_AREA_FT2 * VALVE_CV;
let LoadFactor = 0;

// Chart Data - now stores data points with timestamps
const chartData = []; // Array of {time, casing, tubing, flow}
let lastChartPushTime = -1; // Track last time we pushed chart data (in simTime minutes)
let chartViewWindowMinutes = 1440; // Default: Last 24 hours
let chartHoverIndex = -1; // Index into filteredData for crosshair (-1 = none)

// Arrival History (Last 10 arrivals — compact display)
const arrivalHistory = [];  // Array of {number, riseVelocity, riseTime}

// Cycle History Data (Last 5 cycles)
const cycleHistory = {
    opening: [],  // Data captured when valve opens (LIFTING starts)
    closing: []   // Data captured when valve closes (AFTERFLOW ends)
};

// Tracking variables for cycle metrics
let cycleStartTime = 0;        // When current cycle started (shut-in began)
let liftStartTime = 0;         // When lifting started
let afterflowStartTime = 0;    // When afterflow started
let lastRiseTime = 0;          // Time from lift start to arrival (minutes)
let lastArrivalVelocity = 0;   // Plunger velocity at arrival (ft/min)
let lastAvgRiseVelocity = 0;   // Average rise velocity (WELL_DEPTH / lastRiseTime)
let liquidAtLiftStart = 0;     // Liquid in wellbore when lift began (for removal calc)
let lastFallback = 0;          // Liquid fallback from most recent lift (bbl)
let lowestCasingInCycle = 9999; // Track lowest casing during flow
let cycleTotalFlow = 0;        // Accumulated flow for Cycle Mcf calculation
let lastOpenTrigger = '';      // What triggered the valve to open
let lastCloseTrigger = '';     // What triggered the valve to close
let totalShutInMins = 0;       // Total shut-in time for the cycle
let totalOnTime = 0;          // Minutes in LIFTING + AFTERFLOW (reset when closing)
let totalOffTime = 0;         // Minutes in any shut-in state (reset when LIFTING starts)

// Daily production summary tracking
let totalProductionMcf = 0;    // Total gas produced across all cycles
let totalLiquidProducedBbl = 0; // Total liquid produced across all cycles
let completedCycleCount = 0;   // Number of completed cycles

// Today/Yesterday tracking
let todayMcf = 0;
let todayBbl = 0;
let yesterdayMcf = null;       // null = no yesterday data yet
let yesterdayBbl = null;
let currentSimDay = 0;         // Tracks which sim day we're on (0, 1, 2...)

// Liquid loading tracking - TWO-POOL MODEL
// Pool 1: Liquid above plunger (the slug being lifted during LIFTING state)
// Pool 2: Liquid below plunger / in tubing (accumulates for next cycle)
// For 2-3/8" tubing (1.995" ID): 1 bbl fills ~259 ft, water gradient 0.433 psi/ft
// With SG=1.05: 0.433 × 1.05 × 259 = 118 psi/bbl
let LIQUID_PSI_PER_BBL = 118;   // psi per barrel for produced water (SG=1.05) in 2-3/8" tubing — `let` for per-well override
let liquidAbovePlunger = INITIAL_CONDITIONS.liquidInTubing;    // bbl - slug on top of plunger during lift (plunger starts at bottom)
let liquidBelowPlunger = 0;      // bbl - new liquid entering below plunger during lift
let liquidInTubing = INITIAL_CONDITIONS.liquidInTubing;        // bbl - liquid in tubing (when plunger at surface or bottom)
let liquidColumnPsi = INITIAL_CONDITIONS.liquidInTubing * LIQUID_PSI_PER_BBL;  // Backpressure from liquid (psi)

// Legacy variable for compatibility (computed from pools)
let liquidAccumulationBbl = INITIAL_CONDITIONS.liquidInTubing; // Total liquid in wellbore

// Stall tracking
let stallTimer = 0;            // How long plunger has been stalled (minutes)
let isStalled = false;         // Flag for stall condition

// Consecutive failure tracking
let consecutiveFailures = 0;   // Count of consecutive non-arrivals
const MAX_CONSEC_FAILURES = 3; // Trigger extended shut-in after this many

// C=T (Casing = Tubing) detection
// Only alarm when pressures are very close during shut-in
const CT_THRESHOLD = 20;       // psi - pressures within this = C=T alarm
let ctAlarmActive = false;     // Flag for C=T condition

// --- DOM ELEMENTS ---
// Initialized after DOM is ready (this script is loaded at end of body)
const els = {
    status: document.getElementById('statusDisplay'),
    flow: document.getElementById('valFlow'),
    tbg: document.getElementById('valTbg'),
    csg: document.getElementById('valCsg'),
    pwf: document.getElementById('valPwf'),
    line: document.getElementById('valLine'),
    depth: document.getElementById('valDepth'),
    vel: document.getElementById('valVel'),
    velIndicator: document.getElementById('velIndicator'),
    timerLift: document.getElementById('timerLift'),
    log: document.getElementById('eventLog'),
    btn: document.getElementById('btnStart'),
    canvas: document.getElementById('trendChart'),
    wellboreCanvas: document.getElementById('wellboreCanvas')
};

// --- WELL PRESETS ---
// Calibrated knob sets for switching between the conventional Marcellus default
// and the two Expand Energy packer wells. See PACKER-MODE-PHYSICS-SPEC.md and
// memory/packer-plunger-model.md for derivation.
const WELL_PRESETS = {
    'marcellus': {
        label: 'Marcellus Conventional (default)',
        completionType: 'conventional',
        WELL_DEPTH: 7000,
        TUBING_AREA_FT2: 0.0217, TUBING_ID_FT: 0.166,
        FT_PER_BBL: 259, LIQUID_PSI_PER_BBL: 118,
        RESERVOIR_PRESSURE: 750, P_LINE_BASE: 200,
        WELL_CHARACTERISTICS: { liquidGasRatio: 125, IPR_C: 0.012, IPR_n: 0.8 },
        V_FALL_REF: 1200, VALVE_CV: 2.0, AFTERFLOW_INFLOW_FACTOR: 0.20,
        INITIAL: { P_casing: 450, P_tubing: 380, liquidInTubing: 0.3 },
        controller: {
            inMaxAft: 25, inMinAft: 5, inCloseDly: 0, inPlgDrop: 20,
            inMandatory: 120, inMaxShutIn: 120, inMaxWait: 60,
            chkOpenCsg: true,  inOpenCsgVal: 520,
            chkOpenLoad: false, chkOpenDiff: false,
            chkOpenOffTime: false, chkOpenArmedTime: false,
            chkOpenTubing: false, chkOpenTbgLine: false,
            chkCloseFlow: true, inCloseFlowVal: 200,
            chkCloseDP: false, chkCloseOnTime: false,
            chkCloseCasing: false, chkCloseTubing: false,
            chkCloseCsgTbg: false, chkCloseCsgLine: false
        }
    },
    'wellA': {
        label: 'Well A — Packer (2-3/8″ tubing, 6893 ft BSA)',
        completionType: 'packer',
        WELL_DEPTH: 6893,
        TUBING_AREA_FT2: 0.0217, TUBING_ID_FT: 0.166,
        FT_PER_BBL: 259, LIQUID_PSI_PER_BBL: 118,
        RESERVOIR_PRESSURE: 650, P_LINE_BASE: 312,
        WELL_CHARACTERISTICS: { liquidGasRatio: 1.0, IPR_C: 0.048, IPR_n: 0.8 },  // 0.048 re-derived after afterflow tubing friction added
        V_FALL_REF: 800, VALVE_CV: 10, AFTERFLOW_INFLOW_FACTOR: 1.0,
        V_STORE_FT3: 6000,
        plungerGasDrag: 6.0e-4,   // Phase 2a: calibrated to ~17 min lift (target 15-18)
        INITIAL: { P_casing: 312, P_tubing: 320, liquidInTubing: 0.3 },
        controller: {
            inMaxAft: 720, inMinAft: 5, inCloseDly: 2, inPlgDrop: 42,
            inMandatory: 0, inMaxShutIn: 120, inMaxWait: 30,
            chkOpenCsg: false, inOpenCsgVal: 520,
            chkOpenLoad: false, chkOpenDiff: false,
            chkOpenOffTime: true, inOpenOffTimeVal: 50,
            chkOpenArmedTime: false, chkOpenTubing: false, chkOpenTbgLine: false,
            chkCloseFlow: true, inCloseFlowVal: 650,
            chkCloseDP: false, chkCloseOnTime: false,
            chkCloseCasing: false, chkCloseTubing: false,
            chkCloseCsgTbg: false, chkCloseCsgLine: false
        }
    },
    'wellB': {
        label: 'Well B — Packer (2-7/8″ tubing, 8034 ft BSA)',
        completionType: 'packer',
        WELL_DEPTH: 8034,
        TUBING_AREA_FT2: 0.0325, TUBING_ID_FT: 0.2034,
        FT_PER_BBL: 172.8, LIQUID_PSI_PER_BBL: 78.6,
        RESERVOIR_PRESSURE: 1800, P_LINE_BASE: 990,
        WELL_CHARACTERISTICS: { liquidGasRatio: 0.4, IPR_C: 0.017, IPR_n: 0.8 },
        V_FALL_REF: 1000, VALVE_CV: 10, AFTERFLOW_INFLOW_FACTOR: 0.98,
        V_STORE_FT3: 8000,
        plungerGasDrag: 3.6e-3,   // Phase 2a: calibrated to ~18 min lift (target 18)
        INITIAL: { P_casing: 990, P_tubing: 1000, liquidInTubing: 0.2 },
        controller: {
            inMaxAft: 300, inMinAft: 5, inCloseDly: 10, inPlgDrop: 55,
            inMandatory: 0, inMaxShutIn: 180, inMaxWait: 30,
            chkOpenCsg: false, inOpenCsgVal: 520,
            chkOpenLoad: false, chkOpenDiff: false,
            chkOpenOffTime: true, inOpenOffTimeVal: 90,
            chkOpenArmedTime: false, chkOpenTubing: false, chkOpenTbgLine: false,
            chkCloseFlow: true, inCloseFlowVal: 1600,
            chkCloseDP: false, chkCloseOnTime: false,
            chkCloseCasing: false, chkCloseTubing: false,
            chkCloseCsgTbg: false, chkCloseCsgLine: false
        }
    }
};

function applyWellPreset(key) {
    const p = WELL_PRESETS[key];
    if (!p) return;

    COMPLETION_TYPE        = p.completionType;
    WELL_DEPTH             = p.WELL_DEPTH;
    TUBING_AREA_FT2        = p.TUBING_AREA_FT2;
    TUBING_ID_FT           = p.TUBING_ID_FT;
    FT_PER_BBL             = p.FT_PER_BBL;
    LIQUID_PSI_PER_BBL     = p.LIQUID_PSI_PER_BBL;
    RESERVOIR_PRESSURE     = p.RESERVOIR_PRESSURE;
    P_LINE_BASE            = p.P_LINE_BASE;
    WELL_CHARACTERISTICS   = p.WELL_CHARACTERISTICS;
    V_FALL_REF             = p.V_FALL_REF;
    VALVE_CV               = p.VALVE_CV;
    AFTERFLOW_INFLOW_FACTOR = p.AFTERFLOW_INFLOW_FACTOR;
    if (p.V_STORE_FT3 !== undefined) V_STORE_FT3 = p.V_STORE_FT3;
    // Per-well plunger drag (lift-time calibration). Falls back to base when the flag is
    // off or the preset doesn't specify one — so conventional Marcellus is never slowed.
    PLUNGER_GAS_DRAG_ACTIVE = (USE_PER_WELL_DRAG && p.plungerGasDrag) ? p.plungerGasDrag : PLUNGER_GAS_DRAG;
    TUBING_VOLUME_FT3      = TUBING_AREA_FT2 * WELL_DEPTH;

    INITIAL_CONDITIONS.P_casing       = p.INITIAL.P_casing;
    INITIAL_CONDITIONS.P_tubing       = p.INITIAL.P_tubing;
    INITIAL_CONDITIONS.liquidInTubing = p.INITIAL.liquidInTubing;

    for (const [id, val] of Object.entries(p.controller)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (typeof val === 'boolean') el.checked = val;
        else el.value = val;
    }

    const sub = document.getElementById('headerSubtitle');
    if (sub) sub.innerText = p.label;

    applyCompletionTypeUI();

    if (typeof resetSimulation === 'function') resetSimulation();
}

// Mode-aware UI tweaks: hide/show Pwf, grey casing display + disable casing trigger in packer mode.
function applyCompletionTypeUI() {
    const isPacker = (COMPLETION_TYPE === 'packer');
    const pwfRow = document.getElementById('rowPwf');
    if (pwfRow) pwfRow.style.display = isPacker ? '' : 'none';
    const csgRow = document.getElementById('rowCsg');
    if (csgRow) csgRow.style.opacity = isPacker ? '0.35' : '1.0';
    const csgChk = document.getElementById('chkOpenCsg');
    if (csgChk) csgChk.disabled = isPacker;
    const csgTrgRow = csgChk ? csgChk.closest('.trigger-row') : null;
    if (csgTrgRow) csgTrgRow.style.opacity = isPacker ? '0.4' : '1.0';
    // Chart legend: hide casing item, show Pwf item in packer mode
    const legCsg = document.getElementById('legendCasing');
    if (legCsg) legCsg.style.display = isPacker ? 'none' : '';
    const legPwf = document.getElementById('legendPwf');
    if (legPwf) legPwf.style.display = isPacker ? '' : 'none';
}
