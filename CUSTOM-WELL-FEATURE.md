# Custom Well Auto-Calibration — "+ Add Well…"

**Status: built, tested, browser-verified (2026-07-08).** This is the auto-calibration product POC embedded in the simulator: an operator enters well data from a spreadsheet, and the app derives + refines the physics model automatically — no expert hand-tuning. Proven by blind re-derivation of both Expand Energy wells.

---

## 1. What it is

Turning a spreadsheet row into a matched simulator model (Wells A & B) originally took expert hand-calibration of physics knobs (`IPR_C`, `V_STORE_FT3`, `plungerGasDrag`, `V_FALL_REF`, `RESERVOIR_PRESSURE`). The **+ Add Well…** button (next to the Well dropdown) automates that: form in → calibrated preset out, with a graded validation scorecard in between. Packer completions only (Expand's well type).

**The product boundary this enforces:** the operator supplies *what the well data says* (targets/observables); the program figures out *the physics* (knobs). Knobs are never entered by hand.

## 2. User flow & the feedback at each stage

1. **Form** (3 fieldsets): Well & Geometry (name, tubing size 2-3/8"/2-7/8"/custom ID, BSA depth, line pressure) · Observed Performance = calibration targets (flowing tubing, SI peak + the shut-in duration it was observed after, Mcfd, water bbl/d, cycles/day, rise min, drop min, optional stabilized long-SI pressure) · Controller Settings (off-time, close-flow, close delay, drop timer, max afterflow, max shut-in).
2. **Pre-run validation**: hard errors block (flowing ≤ line, SI ≤ flowing, name collision, ranges); amber warnings allow but carry through to the results page (no stabilized SI → "Pr will be estimated"; SI-duration vs off-time mismatch; choked-well suspicion when flowing ≫ line; implied fall/rise speed sanity).
3. **Create & Calibrate**: ~10–35 headless sims, 1–2 s (page briefly unresponsive — sims run on the main thread; by design, not worth a worker for 2 s).
4. **Validation scorecard**: per-metric Target | Model | MATCH/CLOSE/OFF badges. OFF rows carry a *diagnostic hint* (see §5). A collapsed "Derived physics parameters (for the engineer)" section shows the fitted knobs. Non-uniqueness note appears whenever Pr was estimated.
5. **Save Well** → preset appears under a "Custom" optgroup in the dropdown, is applied immediately (packer UI flips: casing greys to PACKED, purple Pwf trace), and persists in localStorage. **Export All (JSON) / Import** buttons make wells shareable files. Delete from the "Saved Custom Wells" list in the modal.

## 3. Architecture (all in `js/custom-well.js`, ~800 lines; nothing else modified except index.html markup + styles.css)

- **Analytic first-guesses** (`deriveInitialKnobs`) — these carry most of the load; on Well A most knobs were already in tolerance before refinement:
  - Geometry lookup: 2-3/8" → {area 0.0217, ID 0.166 ft, 259 ft/bbl, 118 psi/bbl}; 2-7/8" → {0.0325, 0.2034, 172.8, 78.6}; custom ID → `area=π(id/2)²`, `FT_PER_BBL=5.615/area`, `LIQUID_PSI_PER_BBL=0.4547×FT_PER_BBL`
  - `V_FALL_REF = 800 × (depth/dropMin)/177` (Well A anchor: 800 → ~177 ft/min)
  - `Pr = stabilizedSI + 0.025×depth` (pinned) **or** `1.2 × (siPeak + 0.025×depth)` (estimated, refined) — exact for Well A (650), 1723 vs 1800 for Well B
  - `IPR_C = prod / (Pr² − Pwf_flow²)^0.8`, `Pwf_flow = flowingTbg + gasCol + 20` — gave 0.0472 vs hand 0.048 on Well A
  - `V_STORE = 6000 × depth/6893`; drag start 1e-3 (log-refined); `LGR = bbl/d ÷ (Mcfd/1000)`; VALVE_CV=10, AFTERFLOW_INFLOW_FACTOR=1.0, IPR_n=0.8 fixed
- **Headless runner**: stubs the UI fns (same list the Node cal tests proved safe), reuses `resetSimulation()` for seeding, loops `updatePhysics(1.0)+checkLogic()` for 3 days, custom metrics tracker (state-transition based, port of `test-packer-wellA-cal.js`). **Metrics use day 2+ only** — excludes the cold-start cycle (cold rise ~20 min vs steady ~12; this is why the app's day-1 numbers always read low). Drop time = *physical* fall-to-bottom tracked from `PlungerDepth`, NOT the controller drop timer.
- **Refinement** (`calibrateCustomWellSync`): coordinate descent, bounded secant per knob, 2 passes — (1) V_FALL_REF→drop, Pr→SI (if unpinned), IPR_C→production, V_STORE→SI, drag→steady-rise; (2) interaction cleanup IPR_C/V_STORE/drag. Skips any knob already in tolerance. Bounds are *physical* limits on the fit only — sim behavior is never clamped.
- **Cancel-safety**: snapshot of all preset globals + controller DOM inputs taken before first sim; Cancel restores exactly. (Gotcha fixed during build: top-level `let` globals are NOT reachable via `globalThis` — snapshot/restore must reference each by name.)
- **Persistence**: localStorage key `plsim.customWells.v1` `{version, wells:{key:{label, preset, inputs, validation, createdAt}}}`; startup merge into `WELL_PRESETS` + dropdown (guarded for the Node vm harness); JSON export via Blob download, import via FileReader with shape validation and collision suffixing.

## 4. Grading bands (from the hand-cal test tolerances)

| Metric | MATCH | CLOSE |
|---|---|---|
| SI tubing peak | ±60 psi | ±120 |
| Daily production | ±20% | ±40% |
| Rise | ±25% or ±3 min | ±50% |
| Drop | ±20% or ±5 min | ±40% |
| Cycles/day | ±1 | ±2 |
| Flowing tubing | ±10% | ±20% |
| Water | ±0.3 or ±30% | ±60% |

## 5. Deterministic diagnostic tier — "expert judgment as code"

No AI at runtime: each rule is an if-condition over numbers the calibration already computed, filling a template. Born from the live Well B test where the generic hint pointed at the wrong input.

| Trigger (computed) | Message the user gets |
|---|---|
| Over-cycling AND avg afterflow < 0.7×max-afterflow AND peak flow > close trigger | "Close-flow trigger is closing the well early — the fitted flow sits right at it. Your production entry is likely at the low end of its range; raise it toward the observed flowing rate and re-calibrate." |
| Under-cycling | Pacing = off-time + max-afterflow; check those setpoints |
| Non-arrivals in run | Check rise/drop/off-time against each other |
| **Never cycles** (banner, replaces useless all-OFF table) | Distinguishes `liftAttempts==0` → "controller never opened — check off-time/max shut-in" from `liftAttempts>0, no arrivals` → "buildup insufficient to lift the slug vs line pressure… if inputs are correct, this well may genuinely struggle" |
| **Knob pinned at physical bound** + its metric OFF | "Fit pushed [deliverability/storage/drag/fall velocity] to its physical limit and still couldn't match — these inputs are mutually inconsistent" (per-metric mapping: IPR_C→production, V_STORE/Pr→SI, drag→rise, V_FALL_REF→drop) |
| Pre-run: SI observed after X min but off-time is Y (>25% apart) | Modeled SI peak may not be comparable to the reading |
| Pre-run + post-run: flowing ≫ line but model hugs line | "Well is likely choked at surface; model assumes wide-open valve" |
| Water rate off | Generic only — no clean numeric signature (LLM-tier territory) |

**Design principle (agreed with Vivek):** deterministic rules wherever the trigger condition is computable from sim outputs; the future LLM review layer ("automated reservoir engineer", a handful of API calls per well, never in the fitting loop) is for judgment without a numeric signature.

## 6. Validation results (the proof)

**Well A blind re-derivation** (`node js/test-custom-well-cal.js`, 9 sims, ~1 s): IPR_C 0.0473 (hand 0.048) · V_STORE 6000 (6000) · V_FALL_REF 779 (800) · **Pr estimated 651 vs hand 650** · 6 MATCH + water CLOSE.

**Well B live in browser** (2026-07-08, via Edge + Claude extension): entering production at the low end (1300 of the 1300–1600 range) → 5 MATCH + cycles OFF 9 vs 3.5 **with the correct diagnostic**; following the hint (1300→1500) → **all 7 MATCH**, SI peak 1236 vs 1235 (better than the hand cal's 1174). Derived: Pr 1807 (hand 1800), IPR_C 0.0169 (hand 0.017), drag 4.14e-3, V_STORE 5698.

**Failure path**: impossible targets (5,000 Mcfd from a 370-psi well) → IPR rides its bound, OFF + "inputs mutually inconsistent" hint, save still allowed, no crash. **Healthy control**: zero false positives from any diagnostic.

## 6b. Live line-pressure what-if (added 2026-07-08)

The **Line (psi)** readout in Current Values is an editable input (dashed border): type a value, press Enter, and the physics responds mid-run — no reset. `setLinePressure()` in `simulation.js` sets both `P_line` (live) and `P_LINE_BASE` (so RESET keeps it); switching well preset restores that preset's value; invalid input is rejected and logged. Every change is logged to the event log, with a warning if line ≥ reservoir pressure.

**Physics validation (Well A, all monotonic, zero numerical issues):**

| Line psi | Steady Mcf/d | Flowing tbg |
|---|---|---|
| 250 | 937 | 265 |
| 312 (cal) | 776 | 320 |
| 375 | 415 | 384 |
| 450 | 0 — well dies (Pr 650 leaves only ~28 psi kick after gas column; plunger can't make trips) | — |

**Mid-run steps** (one continuous run, via `setLinePressure`): 312→420 dropped production 585→341 **and drove over-cycling (~15 arrivals/day)** because the close-flow trigger (650 Mcfd, tuned for line 312) now fires constantly; stepping down to 250 recovered 718 Mcf/d at normal cadence. Both effects are correct physics + correct controller behavior — **and a great demo beat: "if your gathering pressure rises and you don't retune the controller, this is what happens."** Test: scratchpad `test-line-pressure.js` pattern (sweep + step + garbage-input rejection).

**Both-well directional test (2026-07-08)** — the marginal-vs-strong contrast is the story:

| Δ line | Well A (Pr 650, base 312) | Well B (Pr 1800, base 990) |
|---|---|---|
| −100 psi | **+31%** (1019 Mcf/d) | **+10%** (1742) |
| baseline | 776 | 1586 |
| +50 | **−37%** (491) + over-cycling starts (11 arr/d) | −6% (1497) |
| +100 | **DEAD** — 0 Mcf/d, 54 non-arrivals (plunger can't lift) | −17% (1321), cycles creeping up |
| +150 | dead | **−21%** (1253, 8 arr/d) — degrades gracefully, survives |

Sensitivity scales with drawdown margin (backpressure IPR is ΔP²-driven): the marginal well dies at +100 psi via **non-arrivals** (a mechanism, not just "less flow"); the strong well loses ~1.4%/10 psi. Mid-run steps on Well B (990→1140→890 via `setLinePressure`): −25% live with cycling doubling, full recovery on step-down. Zero NaN/floor violations across all 10 sweeps + steps.

## 7. How to demo / present it (Expand meeting script)

1. **Frame:** "Last time we showed we can match your wells — but that took our expert hours per well. This is that expertise automated."
2. Click **+ Add Well…**, enter Well A's spreadsheet numbers on screen (placeholders in the form ARE Well A's numbers). Point out the optional stabilized-SI field: "this is the data gap we flagged — the tool works without it but tells you what it costs."
3. Create & Calibrate → scorecard in ~2 s. Read the MATCH column aloud. Open **Derived physics parameters**: "it re-derived the same reservoir pressure and IPR we found by hand — from your spreadsheet alone."
4. **The money moment — do the Well B imperfect-data detour on purpose:** enter production at 1300 → show the OFF badge and read the diagnostic aloud: *"it doesn't fudge inconsistent data — it tells you which number to reconsider and why."* Fix one field → all green.
5. Save → it's a dropdown well like any other; change a controller setting and show the what-if response. Export the JSON: "this is your well as a file — send it to us or move it between machines."
6. **Honesty close:** snapshot tool (no decline curve); water accounting is CLOSE not MATCH; Pr estimated without a stabilized shut-in. "The next well you send goes through this form as a true blind test."

**Presentation don'ts:** don't quote day-1 production on screen (cold start reads low — use "Yesterday Mcf" at sim-day 3+); don't oversell the drag knob for extreme extrapolation (calibrated coefficient, accurate near the operating point).

## 8. Tests

| Test | Command | Expected |
|---|---|---|
| Product test (blind Well A re-derivation) | `node js/test-custom-well-cal.js` | PASS, knobs in bands, all MATCH/CLOSE |
| Conventional regression | `node js/test-node-smoke.js` | 14 cycles / 201.2 Mcf/day |
| Hand-cal regressions | `node js/test-packer-wellA-cal.js`, `...wellB-cal.js` | PASS |
| Browser automation | needs `python -m http.server` (extension can't drive `file://`); buttons by element ref, not coordinates | — |

## 9. Known limitations / roadmap

- Packer-only (conventional custom wells need `CASING_VOLUME_FT3` made mutable + an annulus input).
- No surface-choke input (flagged by the choke diagnostic instead).
- Water rate grades CLOSE on wet-ish entries — initial-slug accounting; no diagnostic rule (no clean signature).
- Non-uniqueness without stabilized SI: Pr/IPR_C/V_STORE trade off — the tool says so rather than hiding it.
- Calibration blocks the UI ~1–2 s (acceptable; web-worker if it ever grows).
- **LLM review tier** (next product phase): ingest messy data packets, choose knobs/bounds, review fit quality, write the goodness-of-fit narrative — judgment without a numeric signature. Deterministic optimizer stays the inner loop.
