# Plunger Lift Simulator

A browser-based physics simulator for plunger lift gas well operations, designed for training and demonstration purposes.

## What This Project Is

An interactive training tool that simulates a plunger lift system on a Marcellus shale gas well. It demonstrates:
- How plunger lift physics work (pressure buildup, plunger dynamics, liquid loading)
- How controller settings affect well performance
- The consequences of poor tuning (liquid loading, non-arrivals, production loss)

Uses real physics equations (IPR, Lea 1982 force balance, Turner critical velocity) but simplified for educational purposes - constant reservoir pressure, no decline curves.

## Project Structure

```
plunger-lift-simulator/
├── index.html              ← HTML shell (UI structure only)
├── css/
│   └── styles.css          ← All styling (SCADA-grey theme)
└── js/
    ├── config.js           ← Constants, well parameters, all state variables
    ├── physics.js          ← Physics engine + liquid dynamics
    ├── controller.js       ← State machine (checkLogic, changeState)
    ├── simulation.js       ← Main loop, cycle tracking, daily summary, controls
    ├── ui.js               ← DOM updates, status rendering, event log
    ├── chart.js            ← Canvas chart rendering
    ├── help.js             ← Help definitions + popover system
    ├── custom-well.js      ← "+ Add Well…" form + auto-calibration + localStorage presets
    └── test-sweep.js       ← Console test tool (runTestSweep)
```

### File Responsibilities

| File | Key Functions | What It Owns |
|------|--------------|--------------|
| `config.js` | — | All `const`/`let` declarations, `WELL_CHARACTERISTICS`, `RESERVOIR_PRESSURE`, `P_LINE_BASE`, `INITIAL_CONDITIONS`, `USE_MULTIPHASE_MODEL` toggle, `els` DOM cache |
| `physics.js` | `updatePhysics()`, `updateLiquidDynamics()`, `enforceBoundaries()`, `calculateChokeFlow()`, `calculateCriticalRate()`, `calculateTubingFriction()`, `calculateMultiphaseDp()`, `calculateGrayPressureDrop()` (retained, not called) | IPR, Lea 1982, Turner, Hagedorn-Brown multiphase, two-pool liquid model, pressure validation |
| `controller.js` | `checkLogic()`, `changeState()` | State machine transitions, cycle data capture at state changes |
| `simulation.js` | `updateSimulation()`, `resetSimulation()`, `toggleSimulation()`, `captureOpeningData()`, `captureClosingData()`, `updateCycleTable()`, `updateDailySummary()` | Main loop, cycle history, daily metrics, sim controls |
| `ui.js` | `updateUI()`, `renderStatus()`, `logEvent()`, `logCycleSummary()` | All DOM updates, color coding, C=T alarm display |
| `chart.js` | `updateChart()`, `drawChart()` | Canvas pressure/flow chart with dual Y-axes |
| `help.js` | `showHelpPopover()`, `closeHelpPopover()`, `HELP_DEFINITIONS` | Click-to-learn help system, instructions modal |
| `test-sweep.js` | `runTestSweep()`, `runTestScenario()`, `classifyZone()` | Automated 25-combination parameter sweep (disables all open/close triggers) |
| `custom-well.js` | `openCustomWellModal()`, `deriveInitialKnobs()`, `calibrateCustomWellSync()`, `runHeadlessSim()`, `gradeMetrics()`, `saveCustomWell()` | "+ Add Well…" operator form → analytic first-guess + coordinate-descent auto-calibration (packer only) → MATCH/CLOSE/OFF validation table with deterministic diagnostic hints → localStorage-persisted preset in the Well dropdown, with JSON export/import. Product test: `node js/test-custom-well-cal.js` re-derives Well A's hand-calibrated knobs from spreadsheet inputs alone. **Full feature doc + demo script: `CUSTOM-WELL-FEATURE.md`** |

### Script Load Order (matters!)

Scripts are loaded via `<script src="...">` tags at the end of `index.html`. Order is critical because all files share global state:

1. `config.js` — declares all globals (must be first)
2. `physics.js` — reads/writes physics globals
3. `controller.js` — calls functions from physics.js and simulation.js
4. `simulation.js` — orchestrates physics + controller + UI
5. `ui.js` — reads globals for display
6. `chart.js` — reads globals for chart rendering
7. `help.js` — standalone (no physics dependencies)
8. `custom-well.js` — needs WELL_PRESETS/applyWellPreset, updatePhysics, checkLogic, resetSimulation, closeInstructions
9. `test-sweep.js` — calls resetSimulation, updatePhysics, checkLogic
10. `test-node-smoke.js` — Node.js headless smoke test (not loaded in browser)

## Shared Global State

All files read/write the same global variables declared in `config.js`. Key ones:

- `P_casing`, `P_tubing`, `P_line` — surface pressures (psig)
- `FlowRate` — current gas flow (Mcfd)
- `PlungerDepth`, `PlungerVel` — plunger position and speed
- `state`, `stateTimer` — current controller state and time in state
- `liquidInTubing`, `liquidAbovePlunger`, `liquidBelowPlunger` — two-pool liquid model
- `liquidColumnPsi` — backpressure from liquid column
- `simTime` — total elapsed simulation minutes
- `USE_MULTIPHASE_MODEL` — toggle: `false` = gas-only friction (default), `true` = Hagedorn-Brown multiphase

## Well Configuration (Centralized in config.js)

All well characteristics are defined in `config.js`. No hardcoded values remain in physics.js.

| Variable | Default | Purpose |
|----------|---------|---------|
| `RESERVOIR_PRESSURE` | 750 psi | Reservoir pressure (let — scenario switchable) |
| `P_LINE_BASE` | 200 psi | Gathering line pressure (let — scenario switchable) |
| `WELL_CHARACTERISTICS` | `{liquidGasRatio: 125, IPR_C: 0.012, IPR_n: 0.8}` | IPR and liquid loading (let — scenario switchable) |
| `INITIAL_CONDITIONS` | `{P_casing: 450, P_tubing: 380, liquidInTubing: 0.3}` | Starting state for resetSimulation() |
| `GAS_VISCOSITY_CP` | 0.012 cp | Used by Gray, friction, multiphase calcs |
| `WELL_DEPTH` | 7,000 ft | Measured depth |
| `TUBING_ID_FT` | 0.166 ft (1.995 in) | Tubing inner diameter |

### Switching Wells (Future Scenarios)

To simulate a different well, set the `let` variables then call `resetSimulation()`:
```js
RESERVOIR_PRESSURE = 550;
P_LINE_BASE = 250;
WELL_CHARACTERISTICS = { liquidGasRatio: 175, IPR_C: 0.010, IPR_n: 0.8 };
INITIAL_CONDITIONS.P_casing = 350;
INITIAL_CONDITIONS.P_tubing = 280;
INITIAL_CONDITIONS.liquidInTubing = 0.5;
resetSimulation();
```

## Headless Smoke Test

Run `node js/test-node-smoke.js` from the `plunger-lift-simulator-1/` directory (or from project root as `node plunger-lift-simulator-1/js/test-node-smoke.js`). Mocks the browser DOM, runs 24h of simulation, asserts the well cycles and produces within expected ranges. Use after any physics or config change.

## State Machine

`UNARMED_SHUTIN` → `MANDATORY_SHUTIN` → `ARMED_SHUTIN` → `LIFTING` → `AFTERFLOW` → (repeat)

## Quick Start

1. Open `index.html` in a browser
2. Click "Begin Simulation" to dismiss the instructions
3. Click "START SIMULATION"
4. Use speed control (1x-300x) to fast-forward
5. Adjust controller settings and observe effects

### Test Sweep (Console)

Run `runTestSweep()` in browser console to test 25 shut-in × afterflow combinations over 24 simulated hours each.

## Multiphase Model Toggle

The AFTERFLOW solver supports two friction/pressure-drop models, controlled by `USE_MULTIPHASE_MODEL` in `config.js`:

| Mode | Function | Correction | Use Case |
|------|----------|------------|----------|
| `false` (default) | `calculateTubingFriction()` | ~2-10 psi gas-only Darcy-Weisbach | Training demos — preserves AGGR/RECK zones |
| `true` | `calculateMultiphaseDp()` | ~40-55 psi excess gravity + 2-phase friction | More realistic — but stabilizes well too much for training |

Toggle at runtime via console: `USE_MULTIPHASE_MODEL = true`

## Important Notes

- No build tools, no npm, no bundler — plain vanilla JS with `<script>` tags
- The original monolithic file (`../demo-tuning-marcellus.html`) is kept as a known-good reference
- Initial state values are defined once in `INITIAL_CONDITIONS` and `P_LINE_BASE` in `config.js` — both the initial declarations and `resetSimulation()` read from these, so there's only one place to change
