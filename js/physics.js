// Afterflow IPR inflow factor.
// During afterflow, production is primarily from STORED casing gas draining
// through the tubing (blowdown), NOT from fresh reservoir inflow. The reservoir
// contributes only a trickle — near-wellbore drawdown and flow geometry limit
// real-time reservoir delivery at high flow rates.
// Range: 0.10 (tight, mostly blowdown) to 0.30 (moderate continued inflow).
// At 0.20, roughly 80% of afterflow gas comes from stored casing pressure.
let AFTERFLOW_INFLOW_FACTOR = 0.20;  // `let` so per-well presets can override (packer wells with continuous formation feed use higher values, ~0.4-0.6)

// --- BOTTOMHOLE PRESSURE CALCULATIONS ---
// These convert surface gauge readings to bottomhole pressure
// accounting for gas column weight (and liquid column in tubing)

// Casing bottomhole pressure: gas column gradient increases with pressure
// At higher surface pressure, gas is denser, so gradient is steeper
// Base gradient ~0.025 psi/ft at 1000 psig surface pressure
function calculateBottomholePressure_Casing(P_surface_psig) {
    const gasGradient = 0.025 * P_surface_psig / 1000;  // psi/ft
    return P_surface_psig + (gasGradient * WELL_DEPTH);
}

// Tubing bottomhole pressure: liquid at bottom + gas column above
// Liquid contributes its hydrostatic head directly
// Gas column is shorter (total depth minus liquid height)
function calculateBottomholePressure_Tubing(P_surface_psig, liquidColumnPsi) {
    // Liquid height: 100 psi/bbl and 259 ft/bbl → 2.59 ft per psi of liquid head
    const liquidHeightFt = liquidColumnPsi * 2.59;
    const gasColumnHeightFt = Math.max(0, WELL_DEPTH - liquidHeightFt);

    // Gas gradient based on surface pressure
    const gasGradient = 0.025 * P_surface_psig / 1000;
    const gasColumnPsi = gasGradient * gasColumnHeightFt;

    return P_surface_psig + liquidColumnPsi + gasColumnPsi;
}

// Gas column pressure at arbitrary depth (for Lea 1982 model)
// Returns pressure at given depth below surface, accounting for gas weight
function calculatePressureAtDepth(P_surface_psig, depth_ft) {
    const gasGradient = 0.025 * P_surface_psig / 1000;  // psi/ft
    return P_surface_psig + (gasGradient * depth_ft);
}

// --- PACKER MODE: surface ↔ bottom transforms (flat gas gradient) ---
// In a packer well there is no casing annulus and no two-tank coupling.
// The single tubing column connects surface to bottomhole: gas above any
// liquid slug, liquid at the bottom on the bumper spring.
//   Pwf = P_tubing_surface + liquidColPsi + (G × gas_column_height)
// where G is the flat 0.025 psi/ft per engineer preference (not the
// pressure-scaled form used by conventional bottomhole helpers).
function calculateTubingFromPwf_Packer(Pwf_psig, liquidColPsi) {
    const liquidBbl = liquidColPsi / LIQUID_PSI_PER_BBL;
    const liquidHeightFt = liquidBbl * FT_PER_BBL;
    const gasColumnHeightFt = Math.max(0, WELL_DEPTH - liquidHeightFt);
    const gasColPsi = GAS_GRADIENT_PSI_PER_FT * gasColumnHeightFt;
    return Pwf_psig - liquidColPsi - gasColPsi;
}
function calculatePwf_FromTubing_Packer(P_tbg_surface_psig, liquidColPsi) {
    const liquidBbl = liquidColPsi / LIQUID_PSI_PER_BBL;
    const liquidHeightFt = liquidBbl * FT_PER_BBL;
    const gasColumnHeightFt = Math.max(0, WELL_DEPTH - liquidHeightFt);
    const gasColPsi = GAS_GRADIENT_PSI_PER_FT * gasColumnHeightFt;
    return P_tbg_surface_psig + liquidColPsi + gasColPsi;
}

// Turner equation for critical flow rate (simplified for training)
// Returns critical rate in Mcfd for 2-3/8" tubing (1.995" ID)
function calculateCriticalRate() {
    // Turner critical rate for water-producing wells (Turner et al., 1969)
    // q_t (MMscf/D) = [0.0890 * P * d_ti²] / [(T+460) * Z] * [(67 - 0.0031P)^0.25] / [(0.0031P)^0.5]
    // Reference: "Analysis and Prediction of Minimum Flow Rate for the Continuous Removal of Liquids"
    const P = Math.max(P_tubing, 14.7);  // flowing pressure, psi
    const d_ti = TUBING_ID_FT * 12;       // 2-3/8" tubing ID, inches
    const T = GAS_TEMP_R - 460;           // temperature, °F (derived from GAS_TEMP_R)
    const Z = GAS_Z;                      // gas compressibility factor

    const term1 = (0.0890 * P * d_ti * d_ti) / ((T + 460) * Z);
    const term2 = Math.pow(67 - 0.0031 * P, 0.25) / Math.pow(0.0031 * P, 0.5);

    const q_MMscfd = term1 * term2;
    return q_MMscfd * 1000;  // Convert MMscf/D to Mcfd
}

// Orifice/choke flow equation for gas through motor valve
// Returns flow rate in Mcfd based on upstream/downstream pressures
// Uses industry-standard choke flow with critical/subcritical regimes
function calculateChokeFlow(P_upstream, P_downstream) {
    // Prevent division by zero and ensure positive pressures
    if (P_upstream <= 0 || P_downstream < 0) return 0;
    if (P_downstream >= P_upstream) return 0;

    const pressureRatio = P_downstream / P_upstream;
    const sqrtTerm = Math.sqrt(GAS_SG * GAS_TEMP_R * GAS_Z);

    let flowSCFH;
    if (pressureRatio < 0.53) {
        // CRITICAL (choked) flow - gas reaches sonic velocity at valve throat
        // Flow is limited by valve Cv, independent of downstream pressure
        flowSCFH = 816 * VALVE_CV * P_upstream / sqrtTerm;
    } else {
        // SUBCRITICAL flow - pressure ratio affects flow rate
        // Expansion factor accounts for compressibility
        const expansionFactor = Math.sqrt(1 - pressureRatio * pressureRatio);
        flowSCFH = 816 * VALVE_CV * P_upstream * expansionFactor / sqrtTerm;
    }

    // Convert SCFH to Mcfd: (SCFH / 1000) * 24
    return (flowSCFH / 1000) * 24;
}

// Calculate gas velocity in tubing (ft/sec)
// This is what operators monitor for plunger selection and liquid loading
function calculateGasVelocity(flowRate_Mcfd, P_tubing_psia) {
    // Velocity = Volumetric flow at conditions / Area
    // Q_actual = Q_std * (P_std/P_actual) * (T_actual/T_std) * Z
    // v = Q_actual / (A * 86400) for ft/sec from Mcfd
    if (flowRate_Mcfd <= 0 || P_tubing_psia <= 0) return 0;

    // Convert Mcfd to actual ft³/sec at tubing conditions
    // Mcfd * 1000 = scf/day, /86400 = scf/sec
    // Then adjust for pressure: (14.7/P) and temperature: (T/520) and Z
    const scfPerSec = flowRate_Mcfd * 1000 / 86400;
    const actualCFsec = scfPerSec * (14.7 / P_tubing_psia) * (GAS_TEMP_R / 520) * GAS_Z;

    return actualCFsec / TUBING_AREA_FT2; // ft/sec
}

// Gray correlation for vertical multiphase flow pressure drop (USE_MULTIPHASE_MODEL = false).
// Computes total gravity + friction over full well depth. Note: holdup gravity includes
// in-transit liquid weight, which overlaps with liquidColumnPsi — expect double-counting
// of pooled liquid backpressure when both are subtracted in the AFTERFLOW solver.
// Simplified Gray correlation for vertical multiphase flow pressure drop
// dp/dh = (ρL·HL + ρg·(1-HL))/144 + f·vm²·ρm/(2gc·D·144)
// Returns pressure drop in psi from bottomhole to surface
function calculateGrayPressureDrop(flowRate_Mcfd, P_ref_psig) {
    if (flowRate_Mcfd <= 0) return 0;

    // Constants
    const gc = 32.174;              // lbm·ft/(lbf·s²)
    const D_ft = TUBING_ID_FT;      // Tubing ID in feet (0.1663 ft)
    const L_ft = WELL_DEPTH;        // Tubing length in feet
    const rho_L = LIQUID_DENSITY_LBF_FT3;  // Liquid density lb/ft³
    const mu_g = GAS_VISCOSITY_CP;  // Gas viscosity in cp
    const vb = 1.0;                 // Bubble rise velocity ft/s (mist flow)

    // Gas density at reference pressure (lb/ft³)
    // ρg = 2.7 × SG × P / (Z × T) where P in psia, T in °R
    const P_ref_psia = P_ref_psig + 14.7;
    const rho_g = 2.7 * GAS_SG * P_ref_psia / (GAS_Z * GAS_TEMP_R);

    // Superficial gas velocity (ft/s)
    // Convert Mcfd to actual ft³/s at tubing conditions
    const Q_gas_scfd = flowRate_Mcfd * 1000;
    const Q_gas_acfs = Q_gas_scfd * (14.7 / P_ref_psia) * (GAS_TEMP_R / 520) / GAS_Z / 86400;
    const vSG = Q_gas_acfs / TUBING_AREA_FT2;

    // Superficial liquid velocity (ft/s) from LGR
    const Q_liquid_bpd = (flowRate_Mcfd / 1000) * WELL_CHARACTERISTICS.liquidGasRatio;
    const Q_liquid_cfs = Q_liquid_bpd * 5.615 / 86400;
    const vSL = Q_liquid_cfs / TUBING_AREA_FT2;

    // Mixture velocity
    const vm = vSG + vSL;
    if (vm <= 0) return 0;

    // Liquid holdup - Gray mist flow approximation
    // HL = (vSL/vm)(1 + vb/vm)
    let HL = (vSL / vm) * (1 + vb / vm);
    HL = Math.max(0, Math.min(1, HL));

    // Slip mixture density (for gravity term)
    const rho_slip = rho_L * HL + rho_g * (1 - HL);

    // No-slip mixture density (for friction term)
    const CL = vSL / vm;
    const rho_noslip = rho_L * CL + rho_g * (1 - CL);

    // Reynolds number and friction factor (Blasius for turbulent flow)
    const Re = rho_noslip * vm * D_ft / (mu_g * 0.000672);
    let f = 0.0791 / Math.pow(Math.max(Re, 1000), 0.25);
    f = Math.max(0.008, Math.min(0.05, f));

    // Pressure gradient (psi/ft)
    // Gravity term: ρ_slip / 144
    // Friction term: f·vm²·ρm / (2·gc·D·144)
    const gravity_term = rho_slip / 144;
    const friction_term = (f * vm * vm * rho_noslip) / (2 * gc * D_ft * 144);
    const dP_dh = gravity_term + friction_term;

    // Total pressure drop over tubing length
    return dP_dh * L_ft;
}

// Gas-only Darcy-Weisbach friction for tubing during afterflow.
// During plunger lift afterflow, liquid pools at the bottom (below Turner critical
// velocity ~540 Mcfd) rather than being entrained in the gas stream. Gray's multiphase
// correlation assumes distributed liquid (holdup) which double-counts the liquid already
// tracked by liquidColumnPsi. This function computes friction from gas flow only.
// Returns friction pressure drop in psi (~2-10 psi at typical flow rates).
function calculateTubingFriction(flowRate_Mcfd, P_ref_psig) {
    if (flowRate_Mcfd <= 0) return 0;

    const gc = 32.174;
    const D_ft = TUBING_ID_FT;              // 0.166 ft
    const L_ft = WELL_DEPTH;                // 7000 ft
    const P_ref_psia = P_ref_psig + 14.7;

    // Gas density at reference pressure (lb/ft³)
    const rho_g = 2.7 * GAS_SG * P_ref_psia / (GAS_Z * GAS_TEMP_R);

    // Gas velocity (ft/s)
    const Q_gas_scfd = flowRate_Mcfd * 1000;
    const Q_gas_acfs = Q_gas_scfd * (14.7 / P_ref_psia) * (GAS_TEMP_R / 520) / GAS_Z / 86400;
    const vG = Q_gas_acfs / TUBING_AREA_FT2;

    // Blasius friction factor for turbulent flow in smooth pipe
    const mu_g = GAS_VISCOSITY_CP;  // cp
    const Re = rho_g * vG * D_ft / (mu_g * 0.000672);
    let f = 0.0791 / Math.pow(Math.max(Re, 1000), 0.25);
    f = Math.max(0.008, Math.min(0.05, f));

    // Friction pressure drop only (no gravity — handled by liquidColumnPsi)
    return (f * vG * vG * rho_g * L_ft) / (2 * gc * D_ft * 144);
}

// Multiphase flow pressure drop for the flowing tubing section (Hagedorn-Brown framework).
// During afterflow, gas carries liquid (from LGR) as mist/droplets through the section
// above the pooled liquid. The gas+liquid mixture is denser than the gas-only casing
// column, creating "excess gravity" that the gas-only friction model misses.
//
// Returns: excess gravity (mixture minus gas-only) + two-phase friction, in psi.
// This replaces calculateTubingFriction() in the AFTERFLOW solver.
//
// Holdup model: Gray-style drift-flux, H_L = (v_SL/v_m)(1 + v_drift/v_m)
// where v_drift = 0.8 ft/s (Nicklin 1962 bubble/droplet rise velocity).
// At typical conditions: H_L ≈ 1.5-2.5%, excess gravity ≈ 40-55 psi.
function calculateMultiphaseDp(flowRate_Mcfd, P_ref_psig, flowingLength_ft) {
    if (flowRate_Mcfd <= 0 || flowingLength_ft <= 0) return 0;

    const gc = 32.174;              // lbm·ft/(lbf·s²)
    const D_ft = TUBING_ID_FT;     // 0.166 ft
    const P_ref_psia = P_ref_psig + 14.7;
    const rho_L = LIQUID_DENSITY_LBF_FT3;  // 65.52 lbm/ft³
    const v_drift = 0.8;           // ft/s — bubble/droplet rise velocity (Nicklin 1962)

    // Gas density at reference pressure (lbm/ft³)
    const rho_g = 2.7 * GAS_SG * P_ref_psia / (GAS_Z * GAS_TEMP_R);

    // Superficial gas velocity (ft/s)
    const Q_gas_scfd = flowRate_Mcfd * 1000;
    const Q_gas_acfs = Q_gas_scfd * (14.7 / P_ref_psia) * (GAS_TEMP_R / 520) / GAS_Z / 86400;
    const vSG = Q_gas_acfs / TUBING_AREA_FT2;

    // Superficial liquid velocity (ft/s) from liquid-gas ratio
    const Q_liquid_bpd = (flowRate_Mcfd / 1000) * WELL_CHARACTERISTICS.liquidGasRatio;
    const Q_liquid_cfs = Q_liquid_bpd * 5.615 / 86400;
    const vSL = Q_liquid_cfs / TUBING_AREA_FT2;

    // Mixture velocity
    const vm = vSG + vSL;
    if (vm <= 0) return 0;

    // Liquid holdup — Gray-style drift-flux slip model
    // Accounts for gas rising faster than liquid (slip)
    let HL = (vSL / vm) * (1 + v_drift / vm);
    HL = Math.max(0, Math.min(0.95, HL));

    // --- EXCESS GRAVITY (mixture heavier than gas-only casing column) ---
    // Casing has gas column with density rho_g
    // Tubing has mixture with density rho_mix = rho_L*HL + rho_g*(1-HL)
    // Excess = HL * (rho_L - rho_g)
    const dP_excess_gravity = HL * (rho_L - rho_g) * flowingLength_ft / 144;

    // --- TWO-PHASE FRICTION ---
    // Uses no-slip mixture properties (standard H-B approach)
    const CL = vSL / vm;  // No-slip liquid fraction
    const rho_noslip = rho_L * CL + rho_g * (1 - CL);
    const mu_g = GAS_VISCOSITY_CP;  // Gas viscosity, cp
    const Re = rho_noslip * vm * D_ft / (mu_g * 0.000672);
    let f = 0.0791 / Math.pow(Math.max(Re, 1000), 0.25);
    f = Math.max(0.008, Math.min(0.05, f));
    const dP_friction = (f * vm * vm * rho_noslip * flowingLength_ft) / (2 * gc * D_ft * 144);

    return dP_excess_gravity + dP_friction;
}

// --- PLUNGER FALL VELOCITY MODEL ---
// Two-zone terminal velocity: fast in gas (density-dependent), slow in liquid (bypass-dependent)
// Deviation angle increases wall friction, slowing fall. At ~79° plunger stalls completely.
function calculateFallVelocity(depth) {
    const theta_deg = parseFloat(document.getElementById('inDeviationAngle').value) || 0;
    const theta_rad = theta_deg * Math.PI / 180;
    const devFactor = Math.cos(theta_rad) - WALL_FRICTION_MU * Math.sin(theta_rad);
    if (devFactor <= 0) return 0;  // Plunger stalls — too much wall friction

    // Where is the liquid pool top?
    const liquidHeight_ft = liquidInTubing * FT_PER_BBL;
    const liquidTopDepth = WELL_DEPTH - liquidHeight_ft;

    if (depth < liquidTopDepth) {
        // Falling through gas — terminal velocity ∝ 1/√ρ_gas
        // Higher pressure = denser gas = slower fall
        const P_local = calculatePressureAtDepth(P_casing, depth);
        const P_local_psia = P_local + 14.7;
        const rho_gas = 2.7 * GAS_SG * P_local_psia / (GAS_Z * GAS_TEMP_R);
        const rho_ref = 2.7 * GAS_SG * 14.7 / (GAS_Z * GAS_TEMP_R);
        return V_FALL_REF * Math.sqrt(rho_ref / rho_gas) * Math.sqrt(devFactor);
    } else {
        // Falling through liquid — slower, bypass-dependent
        // Tighter seal (higher PLUNGER_SEAL_FACTOR) = less bypass = slower fall
        const bypassFactor = 1.0 + 3.0 * (1.0 - PLUNGER_SEAL_FACTOR);
        return V_LIQUID_FALL_REF * bypassFactor * Math.sqrt(devFactor);
    }
}

// --- MAIN PHYSICS ENGINE ---
function updatePhysics(dt) {
    // --- IPR PHYSICS: Backpressure Equation ---
    // Q (Mscf/D) = C × (Pr² - Pwf²)^n
    const IPR_C = WELL_CHARACTERISTICS.IPR_C;
    const IPR_n = WELL_CHARACTERISTICS.IPR_n;
    const MAX_RESERVOIR_PRESSURE = RESERVOIR_PRESSURE;
    const Pr_abs = MAX_RESERVOIR_PRESSURE + 14.7;  // Reservoir pressure (psia)

    // Calculate Load Factor: (Csg - Tbg) / (Csg - Line) * 100
    let denominator = (P_casing - P_line);
    if(denominator < 1) denominator = 1;
    LoadFactor = ((P_casing - P_tubing) / denominator) * 100;

    switch (state) {
        case 'UNARMED_SHUTIN':
        case 'MANDATORY_SHUTIN':
        case 'ARMED_SHUTIN':
            if (COMPLETION_TYPE === 'packer') {
                // === PACKER MODE: tubing-only storage, Pwf is the driven state ===
                // Annulus is sealed/dead. Formation feeds the near-wellbore/frac
                // storage volume (V_STORE_FT3). Pwf builds asymptotically toward Pr.
                if (Pwf <= 0) {
                    // Lazy init from current surface tubing + columns
                    Pwf = calculatePwf_FromTubing_Packer(P_tubing, liquidColumnPsi);
                }
                const Pwf_abs_pkr = Pwf + 14.7;
                const Pr_abs_pkr = MAX_RESERVOIR_PRESSURE + 14.7;
                const deltaPsq_pkr = Math.max(0, Pr_abs_pkr * Pr_abs_pkr - Pwf_abs_pkr * Pwf_abs_pkr);
                const Q_IPR_pkr = IPR_C * Math.pow(deltaPsq_pkr, IPR_n);          // Mcfd
                const scfAdded_pkr = (Q_IPR_pkr * 1000 / 1440) * dt;              // scf this tick
                const gasInStore_pkr = V_STORE_FT3 * (Pwf_abs_pkr / 14.7) * (520 / GAS_TEMP_R) / GAS_Z;
                // dP/P = dn/n  (isothermal mass balance into fixed volume)
                Pwf += Pwf * (scfAdded_pkr / gasInStore_pkr);
                if (Pwf > MAX_RESERVOIR_PRESSURE) Pwf = MAX_RESERVOIR_PRESSURE;

                // Surface tubing follows from Pwf (flat gas gradient + liquid head)
                P_tubing = calculateTubingFromPwf_Packer(Pwf, liquidColumnPsi);
                if (P_tubing < P_line) P_tubing = P_line;

                // Casing annulus is dead — hold flat at line for display
                P_casing = P_line;

                if (state === 'ARMED_SHUTIN' && Math.floor(simTime / 10) !== Math.floor((simTime - dt) / 10)) {
                    console.log(`[${simTime.toFixed(0)}m] PACKER SHUT-IN: Pwf=${Pwf.toFixed(1)}, P_tbg=${P_tubing.toFixed(1)}, Q_IPR=${Q_IPR_pkr.toFixed(1)} Mcfd, gasInStore=${(gasInStore_pkr/1000).toFixed(1)} Mcf`);
                }
            } else {
                // === CONVENTIONAL MODE: casing annulus accumulator ===
                // Backpressure IPR: Q = C × (Pr² − Pwf²)^n into CASING_VOLUME_FT3
                const P_casing_bh = calculateBottomholePressure_Casing(P_casing);
                const Pwf_shutin = P_casing_bh + 14.7;  // Bottomhole pressure (psia)
                const deltaPsq_shutin = Math.max(0, Pr_abs * Pr_abs - Pwf_shutin * Pwf_shutin);
                const Q_IPR_shutin = IPR_C * Math.pow(deltaPsq_shutin, IPR_n);
                const inflowScfMin_si = Q_IPR_shutin * 1000 / 1440;
                const gasInCasing_si = CASING_VOLUME_FT3 * (Pwf_shutin / 14.7) * (520 / GAS_TEMP_R) / GAS_Z;
                const scfAdded_si = inflowScfMin_si * dt;
                const pressureBuild = P_casing * (scfAdded_si / gasInCasing_si);
                P_casing += pressureBuild;

                if (state === 'ARMED_SHUTIN' && Math.floor(simTime / 10) !== Math.floor((simTime - dt) / 10)) {
                    const P_tubing_bh = calculateBottomholePressure_Tubing(P_tubing, liquidColumnPsi);
                    console.log(`[${simTime.toFixed(0)}m] Surface Csg: ${P_casing.toFixed(1)}, BH Csg: ${P_casing_bh.toFixed(1)}, Surface Tbg: ${P_tubing.toFixed(1)}, BH Tbg: ${P_tubing_bh.toFixed(1)}, IPR: ${Q_IPR_shutin.toFixed(1)} Mcfd`);
                }
            }

            FlowRate = 0;
            totalShutInMins += dt;
            totalOffTime += dt;

            if (PlungerDepth < WELL_DEPTH) {
                PlungerVel = calculateFallVelocity(PlungerDepth);
                PlungerDepth += PlungerVel * dt;
                if (PlungerDepth > WELL_DEPTH) PlungerDepth = WELL_DEPTH;
            } else {
                PlungerVel = 0;
            }
            break;

        case 'LIFTING':
            totalOnTime += dt;
            if (P_casing < lowestCasingInCycle) lowestCasingInCycle = P_casing;

            // 1. Gap flow (leakage past plunger seal — computed once, not iterated)
            let leakageFactor = 0.1;
            let gapFlow;
            if (COMPLETION_TYPE === 'packer') {
                // Packer: ΔP across plunger driven by gas column from Pwf vs surface tubing.
                // Approximate at-plunger ΔP using Pwf − full gas column (plunger near bottom dominant)
                const p_below_eq = Pwf - GAS_GRADIENT_PSI_PER_FT * Math.max(0, WELL_DEPTH - PlungerDepth);
                gapFlow = (p_below_eq > P_tubing) ? (p_below_eq - P_tubing) * leakageFactor : 0;
            } else {
                gapFlow = (P_casing > P_tubing) ? (P_casing - P_tubing) * leakageFactor : 0;
            }

            // === TUBING BLOWDOWN: Mass-Conserving Physics ===
            // Gas mass above plunger is tracked explicitly (initialized at lift start)
            // Mass ONLY decreases when gas actually flows out through choke
            // Pressure is calculated FROM mass and current volume (ideal gas law)

            // Calculate current gas volume above plunger (shrinks as plunger rises)
            const V_tubing_above_ft3 = TUBING_AREA_FT2 * PlungerDepth;
            const V_liquid_ft3 = liquidAbovePlunger * 5.615;  // bbl to ft³
            const V_gas_above_ft3 = V_tubing_above_ft3 - V_liquid_ft3;

            if (V_gas_above_ft3 <= 0 || gasAbovePlunger_scf <= 0) {
                // Slug has reached the surface — gas above fully displaced
                gasAbovePlunger_scf = 0;
                P_tubing = P_line;
                FlowRate = gapFlow;
            } else {
                // Iterative solve: find self-consistent choke flow and P_tubing.
                // Gas venting (choke) and compression (shrinking volume) are coupled —
                // the choke acts as a relief valve on this small gas volume.
                // Same relaxation pattern as the Issue 1 afterflow fix.
                const gasK = GAS_Z * 14.7 * GAS_TEMP_R / (520 * V_gas_above_ft3);
                let solvedFlow = calculateChokeFlow(P_tubing, P_line);

                for (let iter = 0; iter < 6; iter++) {
                    const scfRemoved = (solvedFlow + gapFlow) * 1000 / 1440 * dt;
                    const gasRemaining = Math.max(0, gasAbovePlunger_scf - scfRemoved);
                    const targetP = gasRemaining > 0 ? gasRemaining * gasK - 14.7 : P_line;
                    const targetFlow = (targetP > P_line) ? calculateChokeFlow(targetP, P_line) : 0;
                    solvedFlow = 0.6 * solvedFlow + 0.4 * targetFlow;
                }

                // Apply converged solution
                const scfRemoved = (solvedFlow + gapFlow) * 1000 / 1440 * dt;
                gasAbovePlunger_scf = Math.max(0, gasAbovePlunger_scf - scfRemoved);

                if (gasAbovePlunger_scf > 0) {
                    P_tubing = Math.max(gasAbovePlunger_scf * gasK - 14.7, P_line);
                } else {
                    P_tubing = P_line;
                }

                FlowRate = solvedFlow + gapFlow;
            }

            // 4. Plunger Movement Logic
            // Toggle between Lea 1982 physics model and legacy empirical model

            if (USE_LEA_1982_VELOCITY) {
                // === LEA 1982 DYNAMIC MODEL ===
                // Force balance: A_t × (p_f - p_ℓ) - w_t - f_s = (w_t / g) × a
                // Rearranged: a = g × [A_t × (p_f - p_ℓ) - w_t - f_s] / w_t

                // Calculate slug height and positions
                const slug_height_ft = liquidAbovePlunger * FT_PER_BBL;  // ft
                const depth_top_of_slug = Math.max(0, PlungerDepth - slug_height_ft);  // ft from surface

                // p_f = pressure at TOP of slug (tubing side, pushing down on slug)
                // p_ℓ = pressure at BOTTOM of plunger (casing side, pushing up)
                // Conventional: casing gas pushes up through standing valve and liquid below.
                // Packer:       gas below plunger is at Pwf-derived pressure (no annulus);
                //               flat 0.025 gradient is used throughout packer mode for consistency
                //               (the pressure-scaled form under-counts back-pressure at low surface P
                //               and gives unrealistically fast lift on these dry packer wells).
                let p_f;
                if (COMPLETION_TYPE === 'packer') {
                    p_f = P_tubing + GAS_GRADIENT_PSI_PER_FT * depth_top_of_slug;
                } else {
                    p_f = calculatePressureAtDepth(P_tubing, depth_top_of_slug);
                }
                let p_l;
                if (COMPLETION_TYPE === 'packer') {
                    // From Pwf (at perfs) go UP the gas column below the plunger:
                    //   p_at_plunger_bottom = Pwf − liquid_head_below − G·(gas column height below plunger)
                    const liquidHeightBelow_ft = liquidBelowPlunger * FT_PER_BBL;
                    const gasColHeightBelow_ft = Math.max(0, (WELL_DEPTH - PlungerDepth) - liquidHeightBelow_ft);
                    p_l = Pwf
                        - (liquidBelowPlunger * LIQUID_PSI_PER_BBL)
                        - (GAS_GRADIENT_PSI_PER_FT * gasColHeightBelow_ft);
                } else {
                    p_l = calculatePressureAtDepth(P_casing, PlungerDepth) - (liquidBelowPlunger * LIQUID_PSI_PER_BBL);  // psi
                }

                // Weight of plunger + liquid slug (lbf)
                const slugVolume_ft3 = liquidAbovePlunger * 5.615;  // ft³ (5.615 ft³/bbl)
                const slugWeight_lbf = slugVolume_ft3 * LIQUID_DENSITY_LBF_FT3;  // lbf
                const w_t = PLUNGER_WEIGHT_LBM + slugWeight_lbf;  // total weight (lbf, assuming lbm ≈ lbf at surface)

                // Net pressure force (lbf) - pressure acts on tubing area
                const pressureForce_lbf = (p_l - p_f) * TUBING_AREA_FT2 * 144;  // lbf (upward)
                const F_drive = pressureForce_lbf - w_t;  // Net driving force before friction (lbf)
                const slug_length_ft = liquidAbovePlunger * FT_PER_BBL;  // ft
                const dt_sec = dt * 60;  // minutes to seconds

                // === SEMI-IMPLICIT INTEGRATION (active) ===
                // Solves: v_new = v_old + (F_drive - C×v_new²) × g × dt / m
                // Quadratic in v_new: A×v² + v - B = 0
                // Friction from Lea 1982 Eq. A-6: f_s = C × v²

                // Friction coefficient C in lbf/(ft/min)²
                const C_friction = (DARCY_FRICTION_FACTOR * LIQUID_DENSITY_LBF_FT3 * Math.PI * TUBING_ID_FT * slug_length_ft)
                                   / (GRAVITY_FT_SEC2 * 3600);
                // Total friction: liquid slug friction + gas drag on plunger body
                // PLUNGER_GAS_DRAG_ACTIVE ensures dry lifts self-limit; per-well in packer mode
                // (see USE_PER_WELL_DRAG in config.js). Falls back to base PLUNGER_GAS_DRAG.
                const C_total = C_friction + PLUNGER_GAS_DRAG_ACTIVE;

                // Integration factor k: converts force to velocity change
                const k = GRAVITY_FT_SEC2 * dt_sec * 60 / w_t;  // (ft/min) per lbf

                // Quadratic coefficients: A×v² + v - B = 0
                const A = C_total * k;
                const B = PlungerVel + F_drive * k;

                // Solve for new velocity
                let f_s, netForce_lbf;
                if (A > 0.0001 && B > 0) {
                    const discriminant = 1 + 4 * A * B;
                    if (discriminant >= 0) {
                        PlungerVel = (-1 + Math.sqrt(discriminant)) / (2 * A);
                    } else {
                        PlungerVel = 0;  // Extreme stall
                    }
                } else if (A <= 0.0001 && B > 0) {
                    PlungerVel = B;  // No friction case
                } else {
                    PlungerVel = 0;  // Can't lift
                }

                // Bounds check: non-negativity only. Friction (C×v²) self-limits
                // terminal velocity, so no magic upper clip here — the numerical
                // backstop in enforceBoundaries catches any genuine runaway.
                if (PlungerVel < 0) PlungerVel = 0;

                // Calculate friction for logging (using final velocity)
                const v_ft_sec_final = PlungerVel / 60;
                f_s = C_total * 3600 * v_ft_sec_final * v_ft_sec_final;
                netForce_lbf = F_drive - f_s;
                // === END SEMI-IMPLICIT ===

                /* === EXPLICIT EULER INTEGRATION (legacy - causes oscillation) ===
                // Uncomment this block and comment out semi-implicit above to use explicit method
                const v_ft_sec = PlungerVel / 60;  // Convert ft/min to ft/sec
                const tau_shear = DARCY_FRICTION_FACTOR * v_ft_sec * v_ft_sec * LIQUID_DENSITY_LBF_FT3 / GRAVITY_FT_SEC2;  // lbf/ft²
                const f_s = tau_shear * Math.PI * TUBING_ID_FT * slug_length_ft;  // lbf
                const netForce_lbf = pressureForce_lbf - w_t - f_s;  // lbf
                const acceleration_ft_sec2 = (netForce_lbf * GRAVITY_FT_SEC2) / w_t;
                const maxAccel = 50;  // ft/sec² cap
                const cappedAccel = Math.max(-maxAccel, Math.min(maxAccel, acceleration_ft_sec2));
                const deltaVel_ft_min = cappedAccel * dt_sec * 60;
                PlungerVel = PlungerVel + deltaVel_ft_min;
                if (PlungerVel < 0) PlungerVel = 0;
                if (PlungerVel > 1500) PlungerVel = 1500;
                === END EXPLICIT EULER === */

                // VERIFY: Log Lea 1982 details every 2 sim minutes
                if (Math.floor(simTime / 2) !== Math.floor((simTime - dt) / 2)) {
                    const v_terminal = A > 0.0001 ? Math.sqrt(Math.max(0, F_drive) / C_total) : 0;
                    console.log(`[${simTime.toFixed(0)}m] LEA1982: ΔP=${(p_l-p_f).toFixed(1)} | F_drive=${F_drive.toFixed(1)} f_s=${f_s.toFixed(1)} F_net=${netForce_lbf.toFixed(1)} lbf | v=${PlungerVel.toFixed(0)} v_term=${v_terminal.toFixed(0)} ft/min`);
                }

                // Stall detection (with grace period for acceleration from 0)
                if (PlungerVel > 100) {
                    stallTimer = 0;
                } else if (simTime - liftStartTime > 2.0) {
                    // Only start stall timer after 2 minutes of lift (grace period for acceleration)
                    stallTimer += dt;
                }

                if (!isStalled && stallTimer > 5.0) {
                    isStalled = true;
                    logEvent("WARNING: Plunger STALLED - insufficient lift force!", 'critical');
                }

                // Update position if not stalled
                if (!isStalled && PlungerVel > 0) {
                    PlungerDepth -= PlungerVel * dt;
                }

                if (isStalled) {
                    P_casing -= 3.0 * dt;
                    PlungerDepth += 30 * dt;
                    if (PlungerDepth > WELL_DEPTH) PlungerDepth = WELL_DEPTH;
                }

            } else {
                // === LEGACY EMPIRICAL MODEL ===
                // v_avg = K × (Pc - Pt - ΔP_slug) / (Pc + Pt)

                const K_velocity = 1000;  // Velocity coefficient (ft/min)

                // Pressure due to liquid slug weight
                const P_slug = liquidAbovePlunger * LIQUID_PSI_PER_BBL;

                // Convert to absolute pressure (psia)
                const Pc_abs = P_casing + 14.7;
                const Pt_abs = P_tubing + 14.7;

                // Empirical velocity calculation
                const F_G_numerator = Pc_abs - Pt_abs - P_slug;
                const F_G_denominator = Pc_abs + Pt_abs;

                if (F_G_numerator > 0 && F_G_denominator > 0 && !isStalled) {
                    PlungerVel = K_velocity * F_G_numerator / F_G_denominator;
                    if (PlungerVel > 1200) PlungerVel = 1200;

                    PlungerDepth -= PlungerVel * dt;

                    if (PlungerVel > 100) stallTimer = 0;
                    else stallTimer += dt;
                } else {
                    PlungerVel = 0;
                    stallTimer += dt;
                    if (stallTimer > 5.0 && !isStalled) {
                        isStalled = true;
                        logEvent("WARNING: Plunger STALLED - Gas slippage!", 'critical');
                    }
                    if (isStalled) {
                        P_casing -= 3.0 * dt;
                        PlungerDepth += 30 * dt;
                        if (PlungerDepth > WELL_DEPTH) PlungerDepth = WELL_DEPTH;
                    }
                }
            }

            if (!isStalled) {
                if (COMPLETION_TYPE === 'packer') {
                    // PACKER: storage = V_STORE (near-wellbore/frac) + tubing below plunger.
                    // Two effects update Pwf each tick:
                    //   (a) isothermal expansion as plunger rises (V grows → Pwf drops)
                    //   (b) IPR makeup from formation (formation-supported flow)
                    const V_gas_ft3_pkr = V_STORE_FT3 + TUBING_AREA_FT2 * (WELL_DEPTH - PlungerDepth);
                    const dV_dt_pkr = TUBING_AREA_FT2 * PlungerVel;
                    Pwf -= Pwf * (dV_dt_pkr * dt) / V_gas_ft3_pkr;

                    const Pwf_abs_lift = Pwf + 14.7;
                    const Pr_abs_lift = MAX_RESERVOIR_PRESSURE + 14.7;
                    const deltaPsq_lift_pkr = Math.max(0, Pr_abs_lift * Pr_abs_lift - Pwf_abs_lift * Pwf_abs_lift);
                    const Q_IPR_lift_pkr = IPR_C * Math.pow(deltaPsq_lift_pkr, IPR_n);
                    const gasInWell_lift_pkr = V_gas_ft3_pkr * (Pwf_abs_lift / 14.7) * (520 / GAS_TEMP_R) / GAS_Z;
                    const scfAdded_lift_pkr = (Q_IPR_lift_pkr * 1000 / 1440) * dt;
                    Pwf += Pwf * (scfAdded_lift_pkr / gasInWell_lift_pkr);

                    if (Pwf < P_line) Pwf = P_line;
                    P_casing = P_line;  // dead annulus
                } else {
                    // CONVENTIONAL: isothermal gas expansion of annulus + tubing below plunger
                    // PV = constant → dP/dt = −P × (dV/dt) / V
                    const V_gas_ft3 = CASING_VOLUME_FT3 + TUBING_AREA_FT2 * (WELL_DEPTH - PlungerDepth);
                    const dV_dt = TUBING_AREA_FT2 * PlungerVel;
                    const dP_expansion = P_casing * (dV_dt * dt) / V_gas_ft3;
                    P_casing -= dP_expansion;
                }
            }

            // Accumulate gas production during lifting phase
            cycleTotalFlow += FlowRate * (dt / 1440);

            // VERIFY: Log LIFTING progress every 2 sim minutes
            if (Math.floor(simTime / 2) !== Math.floor((simTime - dt) / 2)) {
                const pctComplete = ((WELL_DEPTH - PlungerDepth) / WELL_DEPTH * 100).toFixed(0);
                console.log(`[${simTime.toFixed(0)}m] LIFTING - Depth: ${PlungerDepth.toFixed(0)}ft (${pctComplete}%), Vel: ${PlungerVel.toFixed(0)} ft/min | P_csg: ${P_casing.toFixed(0)}, P_tbg: ${P_tubing.toFixed(0)} psi | gas: ${(gasAbovePlunger_scf/1000).toFixed(1)} Mcf, V: ${V_gas_above_ft3.toFixed(0)} ft³`);
            }
            break;

        case 'AFTERFLOW':
            totalOnTime += dt;
            PlungerDepth = 0;
            PlungerVel = 0;

            if (COMPLETION_TYPE === 'packer') {
                // === PACKER AFTERFLOW: SINGLE-TANK MASS BALANCE ===
                // Plunger at surface; gas inventory = V_STORE + tubing volume (minus liquid).
                // No standing valve, no annulus — choke flow draws straight from Pwf-side gas.
                // Production rate is limited by IPR feeding into a continuously-flowing well.

                const V_total_pkr = V_STORE_FT3 + Math.max(0, TUBING_VOLUME_FT3 - (liquidInTubing * 5.615));
                const Pwf_abs_af = Pwf + 14.7;
                const Pr_abs_af_pkr = MAX_RESERVOIR_PRESSURE + 14.7;
                const gasInWell_af_pkr = V_total_pkr * (Pwf_abs_af / 14.7) * (520 / GAS_TEMP_R) / GAS_Z;

                // --- Flow: vertical tubing friction IN SERIES with the surface choke ---
                // P_tbg_static = no-flow surface pressure (Pwf minus gas column + liquid head).
                // As gas flows up the tubing it loses friction ΔP, dropping the surface pressure
                // the choke sees. Friction ∝ flow², so it is ~0 at steady production (the
                // validated steady state is preserved) and large only during the arrival blowdown
                // — self-throttling the spike. calculateTubingFriction() uses the per-well tubing
                // geometry, so small-tubing Well A is throttled more than big-tubing Well B.
                // Solved by damped fixed-point iteration (flow ↔ friction-dropped tubing).
                const P_tbg_static_pkr = calculateTubingFromPwf_Packer(Pwf, liquidColumnPsi);
                let flowSolve_pkr = (P_tbg_static_pkr > P_line) ? calculateChokeFlow(P_tbg_static_pkr, P_line) : 0;
                let P_tbg_solved_pkr = P_tbg_static_pkr;
                for (let it = 0; it < 8; it++) {
                    const dPf = calculateTubingFriction(flowSolve_pkr, P_tbg_static_pkr);
                    P_tbg_solved_pkr = Math.max(P_tbg_static_pkr - dPf, P_line);
                    const flowTrial = (P_tbg_solved_pkr > P_line) ? calculateChokeFlow(P_tbg_solved_pkr, P_line) : 0;
                    flowSolve_pkr = 0.5 * flowSolve_pkr + 0.5 * flowTrial;  // damped to avoid oscillation
                }
                FlowRate = flowSolve_pkr;
                const scfOut_af_pkr = (FlowRate * 1000 / 1440) * dt;

                // IPR inflow at reduced factor (near-wellbore drawdown limit, same as conventional)
                const deltaPsq_af_pkr = Math.max(0, Pr_abs_af_pkr * Pr_abs_af_pkr - Pwf_abs_af * Pwf_abs_af);
                const Q_IPR_af_pkr = IPR_C * Math.pow(deltaPsq_af_pkr, IPR_n) * AFTERFLOW_INFLOW_FACTOR;
                const scfIn_af_pkr = (Q_IPR_af_pkr * 1000 / 1440) * dt;

                // Mass balance on Pwf (uses the friction-throttled outflow)
                Pwf += Pwf * ((scfIn_af_pkr - scfOut_af_pkr) / gasInWell_af_pkr);
                if (Pwf > MAX_RESERVOIR_PRESSURE) Pwf = MAX_RESERVOIR_PRESSURE;
                if (Pwf < P_line) Pwf = P_line;

                // Surface tubing = friction-dropped value from the solve (matched pair with FlowRate)
                P_tubing = P_tbg_solved_pkr;
                if (P_tubing < P_line) {
                    P_tubing = P_line;
                    FlowRate = 0;
                }

                P_casing = P_line;  // dead annulus

                cycleTotalFlow += FlowRate * (dt / 1440);
                if (Math.floor(simTime / 5) !== Math.floor((simTime - dt) / 5)) {
                    const critRate_af_pkr = calculateCriticalRate();
                    const loadStatus_pkr = FlowRate < critRate_af_pkr ? 'LOADING' : 'clearing';
                    console.log(`[${simTime.toFixed(0)}m] PACKER AFTERFLOW - Flow: ${FlowRate.toFixed(0)} Mcfd (${loadStatus_pkr}) | Pwf: ${Pwf.toFixed(0)}, P_tbg: ${P_tubing.toFixed(0)} | Q_IPR: ${Q_IPR_af_pkr.toFixed(0)} Mcfd | Liq: ${liquidInTubing.toFixed(3)} bbl`);
                }
                break;
            }

            const timeInAfterflow = simTime - afterflowStartTime;

            // === TWO-TANK AFTERFLOW MODEL ===
            // Tubing and casing are separate gas volumes connected through the standing valve.
            // Tubing (small, ~152 ft³) blows down fast through the choke.
            // Casing (large, ~1060 ft³) feeds tubing slowly through the standing valve.
            // The liquid column at the bottom of the tubing progressively chokes off transfer.

            // 1. Flow rate from choke (P_tubing known from last tick)
            FlowRate = (P_tubing > P_line) ? calculateChokeFlow(P_tubing, P_line) : 0;

            // 2. Remove gas from tubing through choke (explicit mass tracking)
            if (FlowRate > 0 && tubingGasScf > 0) {
                const chokeOutflowScf = (FlowRate * 1000 / 1440) * dt;  // Mcfd → scf/min → scf
                tubingGasScf = Math.max(0, tubingGasScf - chokeOutflowScf);
            }

            // 3. Casing-to-tubing transfer through standing valve
            //    Driving force: casing BH pressure minus tubing BH pressure minus liquid column.
            //    The liquid column sits between the standing valve and tubing gas space —
            //    casing gas must overcome it to enter the tubing. As liquid builds,
            //    transfer chokes off naturally. This IS the dynamic restriction.
            const P_casing_bh_af = calculateBottomholePressure_Casing(P_casing);
            const P_tbg_bh_af = P_tubing + liquidColumnPsi + (WELL_DEPTH * 0.025);  // surface + liquid + gas column
            const dP_drive = Math.max(0, P_casing_bh_af - P_tbg_bh_af);

            // Orifice flow through standing valve bore, same equation form as surface choke
            let transferScf = 0;
            if (dP_drive > 0) {
                const svPressureRatio = P_tbg_bh_af / P_casing_bh_af;
                let transferMcfd;
                if (svPressureRatio < 0.53) {
                    // Critical flow through standing valve
                    transferMcfd = 816 * STANDING_VALVE_CV * P_casing_bh_af / Math.sqrt(GAS_SG * GAS_TEMP_R * GAS_Z);
                } else {
                    // Subcritical flow — expansion factor from pressure ratio
                    const svExpansion = Math.sqrt(1 - svPressureRatio * svPressureRatio);
                    transferMcfd = 816 * STANDING_VALVE_CV * P_casing_bh_af * svExpansion / Math.sqrt(GAS_SG * GAS_TEMP_R * GAS_Z);
                }
                transferScf = (transferMcfd * 1000 / 1440) * dt;  // Mcfd → scf this tick
            }

            // Add transferred gas to tubing
            tubingGasScf += transferScf;

            // 4. Derive P_tubing from mass and current volume (ideal gas law)
            //    Volume shrinks as liquid accumulates — gas compression effect
            const effectiveTubingVol_af = Math.max(TUBING_VOLUME_FT3 - (liquidInTubing * 5.615), 0.1);
            if (tubingGasScf > 0 && effectiveTubingVol_af > 0.1) {
                P_tubing = tubingGasScf * 14.7 * GAS_TEMP_R / (520 * effectiveTubingVol_af * GAS_Z) - 14.7;
            } else {
                P_tubing = P_line;
            }
            if (P_tubing < P_line) {
                P_tubing = P_line;
                FlowRate = 0;
            }

            // 5. Casing mass balance: loses gas to tubing transfer, gains from IPR
            const P_csg_abs_af = P_casing + 14.7;
            const casingGasScf_af = CASING_VOLUME_FT3 * (P_csg_abs_af / 14.7) * (520 / GAS_TEMP_R) / GAS_Z;
            // Transfer out
            P_casing -= P_casing * (transferScf / casingGasScf_af);
            // IPR inflow
            const Pwf_af = P_casing_bh_af + 14.7;
            const deltaPsq_af = Math.max(0, Pr_abs * Pr_abs - Pwf_af * Pwf_af);
            const Q_IPR_af = IPR_C * Math.pow(deltaPsq_af, IPR_n) * AFTERFLOW_INFLOW_FACTOR;
            const inflowScf_af = (Q_IPR_af * 1000 / 1440) * dt;
            P_casing += P_casing * (inflowScf_af / casingGasScf_af);

            // Cap casing at reservoir pressure
            if (P_casing > MAX_RESERVOIR_PRESSURE) P_casing = MAX_RESERVOIR_PRESSURE;

            // Coupling floor: casing must support the liquid column
            const P_casing_min = P_line + liquidColumnPsi;
            if (P_casing < P_casing_min) {
                P_casing = P_casing_min;
            }

            if (FlowRate < 0) FlowRate = 0;
            if (P_casing < P_line) P_casing = P_line;

            // Liquid dynamics handled by updateLiquidDynamics()

            if (P_casing < lowestCasingInCycle) lowestCasingInCycle = P_casing;
            cycleTotalFlow += FlowRate * (dt / 1440);

            // VERIFY: Log two-tank afterflow state every 5 sim minutes
            if (Math.floor(simTime / 5) !== Math.floor((simTime - dt) / 5)) {
                const critRate_af = calculateCriticalRate();
                const loadingStatus = FlowRate < critRate_af ? 'LOADING' : 'clearing';
                const transferMcfd = transferScf / dt * 1440 / 1000;  // scf/tick → Mcfd
                console.log(`[${simTime.toFixed(0)}m] AFTERFLOW - Flow: ${FlowRate.toFixed(0)} Mcfd (${loadingStatus}) | tubingGas: ${(tubingGasScf/1000).toFixed(1)} Mcf | P_tbg: ${P_tubing.toFixed(0)}, P_csg: ${P_casing.toFixed(0)} | transfer: ${transferMcfd.toFixed(0)} Mcfd, dP_drive: ${dP_drive.toFixed(0)} psi | Liq: ${liquidInTubing.toFixed(3)} bbl (${liquidColumnPsi.toFixed(0)} psi)`);
            }
            break;
    }

    // Update liquid dynamics (consolidated from all states)
    updateLiquidDynamics(dt);

    // Boundary Constraints
    enforceBoundaries();
    validatePressures();
}

// A7 FIX: Boundary enforcement function
// Ensures all physics values stay within realistic/valid ranges
function enforceBoundaries() {
    const MAX_RESERVOIR_PRESSURE = RESERVOIR_PRESSURE;

    // Pressure bounds
    if (P_casing < 0) P_casing = 0;
    if (P_casing > MAX_RESERVOIR_PRESSURE) P_casing = MAX_RESERVOIR_PRESSURE;

    if (P_tubing < 0) P_tubing = 0;
    // In packer mode the casing is sealed/dead — P_tubing > P_casing is expected.
    if (COMPLETION_TYPE !== 'packer' && P_tubing > P_casing) P_tubing = P_casing;
    if (P_tubing < P_line && state !== 'LIFTING') P_tubing = P_line;

    if (P_line < 0) P_line = 0;

    // Flow rate: only the physical non-negativity floor. NO upper clip —
    // peak flow (e.g. plunger-arrival blowdown) must emerge from the physics,
    // not be pinned to a magic number. SANITY_FLOW is a far-outside backstop
    // that catches numerical blowups (NaN/runaway); it should never bind in
    // normal operation. If it does, the model went unphysical — investigate.
    if (FlowRate < 0) FlowRate = 0;
    if (FlowRate > SANITY_FLOW_MCFD) {
        console.warn(`[SANITY] FlowRate ${FlowRate.toFixed(0)} exceeded backstop ${SANITY_FLOW_MCFD} at t=${simTime.toFixed(0)}m — model may be unphysical`);
        FlowRate = SANITY_FLOW_MCFD;
    }

    // Plunger geometry (physically true — can't pass surface or bottom)
    if (PlungerDepth < 0) PlungerDepth = 0;
    if (PlungerDepth > WELL_DEPTH) PlungerDepth = WELL_DEPTH;
    // Velocity: non-negativity is physical; the Lea friction term self-limits
    // terminal velocity, so the upper bound is only a numerical backstop.
    if (PlungerVel < 0) PlungerVel = 0;
    if (PlungerVel > SANITY_PLUNGER_VEL) {
        console.warn(`[SANITY] PlungerVel ${PlungerVel.toFixed(0)} exceeded backstop ${SANITY_PLUNGER_VEL} at t=${simTime.toFixed(0)}m — model may be unphysical`);
        PlungerVel = SANITY_PLUNGER_VEL;
    }

    // Liquid bounds (non-negativity — physical)
    if (liquidAccumulationBbl < 0) liquidAccumulationBbl = 0;
    if (liquidColumnPsi < 0) liquidColumnPsi = 0;

    // Load Factor: non-negativity only (display metric; not meaningful in packer mode)
    if (LoadFactor < 0) LoadFactor = 0;
}

// --- CONSOLIDATED LIQUID DYNAMICS ---
// Handles all liquid accumulation, clearing, and production tracking
// Called once per physics update based on current state
function updateLiquidDynamics(dt) {
    const IPR_C = WELL_CHARACTERISTICS.IPR_C;
    const IPR_n = WELL_CHARACTERISTICS.IPR_n;
    const MAX_RESERVOIR_PRESSURE = RESERVOIR_PRESSURE;
    const Pr_abs = MAX_RESERVOIR_PRESSURE + 14.7;

    switch(state) {
        case 'UNARMED_SHUTIN':
        case 'MANDATORY_SHUTIN':
        case 'ARMED_SHUTIN':
            // TWO-POOL MODEL: Shut-in state
            // - Plunger is at bottom (or falling to bottom)
            // - Standing valve CLOSED (no pressure differential)
            // - All liquid in tubing is effectively "above" the plunger
            // - No liquid enters or leaves (PetroSkills principle)

            // Liquid stays constant during shut-in
            liquidAbovePlunger = liquidInTubing;  // All tubing liquid is above plunger at bottom
            liquidBelowPlunger = 0;               // Nothing below when plunger is at bottom

            // Pressure coupling: liquid column creates Csg-Tbg differential
            liquidColumnPsi = liquidAbovePlunger * LIQUID_PSI_PER_BBL;
            if (COMPLETION_TYPE !== 'packer') {
                // Conventional: tubing is casing minus liquid head (annulus drives it).
                // Packer: P_tubing was already set from Pwf in updatePhysics — don't override.
                P_tubing = P_casing - liquidColumnPsi;
                if (P_tubing < 0) P_tubing = 0;
            }

            // Update legacy variable for compatibility
            liquidAccumulationBbl = liquidInTubing;

            // VERIFY: Log liquid status every 30 sim minutes during shut-in
            if (Math.floor(simTime / 30) !== Math.floor((simTime - dt) / 30)) {
                console.log(`[${simTime.toFixed(0)}m] SHUTIN LIQUID: InTubing=${liquidInTubing.toFixed(3)} bbl, AbovePlunger=${liquidAbovePlunger.toFixed(3)} bbl`);
            }
            break;

        case 'LIFTING':
            // TWO-POOL MODEL: Lifting state
            // - Plunger is rising from bottom to surface
            // - liquidAbovePlunger = slug being lifted (FIXED at lift start)
            // - Standing valve OPEN - new liquid enters BELOW the rising plunger
            // - New liquid doesn't affect current lift, accumulates for NEXT cycle

            // Calculate IPR-based liquid entry
            const P_casing_bh_lift = calculateBottomholePressure_Casing(P_casing);
            const Pwf_lift = P_casing_bh_lift + 14.7;
            const deltaPsq_lift = Math.max(0, Pr_abs * Pr_abs - Pwf_lift * Pwf_lift);
            const Q_IPR_lift = IPR_C * Math.pow(deltaPsq_lift, IPR_n);

            // Liquid entering from reservoir goes BELOW the plunger
            const liquidEntryBbl_lift = (Q_IPR_lift / 1000) * WELL_CHARACTERISTICS.liquidGasRatio * (dt / 1440);
            liquidBelowPlunger += liquidEntryBbl_lift;
            if (liquidBelowPlunger > 20.0) liquidBelowPlunger = 20.0; // Tubing holds ~27 bbl max

            // Barstock plunger seal leakback: liquid seeps past plunger through
            // annular clearance, driven by slug hydrostatic head.
            // Exponential decay — heavier slug leaks faster (self-limiting).
            if (liquidAbovePlunger > 0.001) {
                const retained = Math.pow(PLUNGER_SEAL_FACTOR, dt);
                const leakback = liquidAbovePlunger * (1 - retained);
                liquidAbovePlunger -= leakback;
                liquidBelowPlunger += leakback;
            }

            // Pressure: plunger fights against liquid ABOVE it only
            liquidColumnPsi = liquidAbovePlunger * LIQUID_PSI_PER_BBL;

            // Update legacy variable (total in wellbore)
            liquidAccumulationBbl = liquidAbovePlunger + liquidBelowPlunger;
            break;

        case 'AFTERFLOW':
            // TWO-POOL MODEL: Afterflow state
            // - Plunger is at SURFACE (in lubricator)
            // - liquidAbovePlunger = 0 (nothing above plunger at surface)
            // - All liquid is in tubing below plunger (liquidInTubing)
            // - New liquid enters and may fall back if flow < critical

            // Calculate IPR inflow rate
            const P_casing_bh_af = calculateBottomholePressure_Casing(P_casing);
            const Pwf_af_liq = P_casing_bh_af + 14.7;
            const deltaPsq_af_liq = Math.max(0, Pr_abs * Pr_abs - Pwf_af_liq * Pwf_af_liq);
            const Q_IPR_af_liq = IPR_C * Math.pow(deltaPsq_af_liq, IPR_n) * AFTERFLOW_INFLOW_FACTOR;

            // Liquid production tracking (what exits to separator)
            const continuousLiquidBbl = (Q_IPR_af_liq / 1000) * WELL_CHARACTERISTICS.liquidGasRatio * (dt / 1440);
            totalLiquidProducedBbl += continuousLiquidBbl;
            todayBbl += continuousLiquidBbl;

            // Wellbore liquid dynamics
            const critRate = calculateCriticalRate();
            if (FlowRate > critRate) {
                // Above critical: gas velocity clears tubing liquid
                // Drift-flux model: liquid droplets rise at (v_gas - v_critical)
                // Clearing rate = v_excess × liquid_holdup_fraction × tubing_area
                // Simplifies to: v_excess × liquidInTubing × 60 / WELL_DEPTH
                const P_tbg_psia = P_tubing + 14.7;
                const v_gas = calculateGasVelocity(FlowRate, P_tbg_psia);
                const v_crit = calculateGasVelocity(critRate, P_tbg_psia);
                const v_excess = v_gas - v_crit;
                const clearingRate = v_excess * liquidInTubing * 60 / WELL_DEPTH; // bbl/min
                liquidInTubing = Math.max(0, liquidInTubing - clearingRate * dt);
            } else {
                // Below critical: liquid falls back and accumulates in tubing
                const fallbackFraction = (critRate - FlowRate) / critRate;
                liquidInTubing += continuousLiquidBbl * fallbackFraction;
                if (liquidInTubing > 20.0) liquidInTubing = 20.0; // Tubing holds ~27 bbl max
            }

            // During afterflow, plunger is at surface
            liquidAbovePlunger = 0;
            liquidBelowPlunger = 0;  // Not used in afterflow

            // Pressure: liquid in tubing creates backpressure
            liquidColumnPsi = liquidInTubing * LIQUID_PSI_PER_BBL;

            // Update legacy variable
            liquidAccumulationBbl = liquidInTubing;
            break;
    }

    // Note: liquidColumnPsi is set in each state above based on the relevant pool
}

// VERIFY: Pressure validation - checks for physically impossible conditions
function validatePressures() {
    const warnings = [];

    if (COMPLETION_TYPE !== 'packer' && P_tubing > P_casing + 1) {  // +1 for floating point tolerance
        warnings.push(`P_tubing (${P_tubing.toFixed(1)}) > P_casing (${P_casing.toFixed(1)})`);
    }
    if (P_casing < 0) {
        warnings.push(`P_casing negative: ${P_casing.toFixed(1)}`);
    }
    if (P_tubing < 0) {
        warnings.push(`P_tubing negative: ${P_tubing.toFixed(1)}`);
    }
    if (FlowRate < 0) {
        warnings.push(`FlowRate negative: ${FlowRate.toFixed(1)}`);
    }
    if (state !== 'LIFTING' && state !== 'AFTERFLOW' && FlowRate > 0.1) {
        warnings.push(`Flow during shut-in: ${FlowRate.toFixed(1)} in state ${state}`);
    }

    if (warnings.length > 0) {
        console.warn(`[${simTime.toFixed(0)}m] PRESSURE VALIDATION:`, warnings.join('; '));
    }
}
