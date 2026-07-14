// --- STATE MACHINE: Controller Logic ---

function checkLogic() {
    // Get User Inputs
    const inMaxWait = parseFloat(document.getElementById('inMaxWait').value);
    const inMinAft = parseFloat(document.getElementById('inMinAft').value);
    const inMaxAft = parseFloat(document.getElementById('inMaxAft').value);
    const inCloseDly = parseFloat(document.getElementById('inCloseDly').value);

    const inPlgDrop = parseFloat(document.getElementById('inPlgDrop').value);
    const inMandatory = parseFloat(document.getElementById('inMandatory').value);
    const inMaxShutIn = parseFloat(document.getElementById('inMaxShutIn').value);

    // --- STATE MACHINE TRANSITIONS ---

    if (state === 'UNARMED_SHUTIN') {
        // Plunger Drop timer is a MINIMUM wait — well cannot arm until timer expires,
        // even if the plunger has already landed. Once timer expires:
        //   - If plunger is at bottom → normal arm
        //   - If plunger is still falling → blind arm (risky, fast arrival likely)
        if (stateTimer >= inPlgDrop) {
            if (PlungerDepth >= WELL_DEPTH) {
                changeState('ARMED_SHUTIN', "Plunger landed + drop timer complete. Armed.");
            } else {
                changeState('ARMED_SHUTIN', "Drop timer expired (plunger at " + PlungerDepth.toFixed(0) + " ft). Armed blind.");
            }
        }
    }

    else if (state === 'MANDATORY_SHUTIN') {
         if (stateTimer >= inMandatory) {
            changeState('ARMED_SHUTIN', "Penalty over. Armed.");
        }
    }

    else if (state === 'ARMED_SHUTIN') {
        // 1. Max Shut In Timer
        if (stateTimer >= inMaxShutIn) {
            changeState('LIFTING', "Max Shut-in Time Expired.");
            return;
        }

        // 2. LF Safety Check (permissive AND trigger)
        // When enabled: blocks other triggers if LF > setpoint (safety gate),
        // AND independently opens the well when LF <= setpoint (trigger).
        const lfEnabled = document.getElementById('chkOpenLoad').checked;
        const lfSetpoint = parseFloat(document.getElementById('inOpenLoadVal').value);
        const lfSafe = !lfEnabled || (LoadFactor <= lfSetpoint);

        // Load Factor trigger (independent of other triggers)
        if (lfEnabled && LoadFactor <= lfSetpoint) {
            changeState('LIFTING', "Load Factor Trigger.");
            return;
        }

        // 3. Open Triggers (respect LF safety check)
        // Casing > Setpoint (primary trigger)
        if (document.getElementById('chkOpenCsg').checked) {
            let setpoint = parseFloat(document.getElementById('inOpenCsgVal').value);
            if (P_casing >= setpoint) {
                if (lfSafe) {
                    changeState('LIFTING', "Casing Pressure Trigger.");
                }
                return;
            }
        }
        // Differential < Setpoint (equalization trigger)
        // Opens when Csg-Tbg has dropped below threshold — pressures equalizing
        // means liquid column is small and well is ready to lift
        if (document.getElementById('chkOpenDiff').checked) {
            let setpoint = parseFloat(document.getElementById('inOpenDiffVal').value);
            if ((P_casing - P_tubing) <= setpoint) {
                if (lfSafe) {
                    changeState('LIFTING', "Differential Pressure Trigger.");
                }
                return;
            }
        }
        // Off Time >= Setpoint
        if (document.getElementById('chkOpenOffTime').checked) {
            let setpoint = parseFloat(document.getElementById('inOpenOffTimeVal').value);
            if (totalOffTime >= setpoint) {
                if (lfSafe) {
                    changeState('LIFTING', "Off Time Trigger.");
                }
                return;
            }
        }
        // Armed Time >= Setpoint
        if (document.getElementById('chkOpenArmedTime').checked) {
            let setpoint = parseFloat(document.getElementById('inOpenArmedTimeVal').value);
            if (stateTimer >= setpoint) {
                if (lfSafe) {
                    changeState('LIFTING', "Armed Time Trigger.");
                }
                return;
            }
        }
        // Tubing >= Setpoint
        if (document.getElementById('chkOpenTubing').checked) {
            let setpoint = parseFloat(document.getElementById('inOpenTubingVal').value);
            if (P_tubing >= setpoint) {
                if (lfSafe) {
                    changeState('LIFTING', "Tubing Pressure Trigger.");
                }
                return;
            }
        }
        // Tbg - Line >= Setpoint
        if (document.getElementById('chkOpenTbgLine').checked) {
            let setpoint = parseFloat(document.getElementById('inOpenTbgLineVal').value);
            if ((P_tubing - P_line) >= setpoint) {
                if (lfSafe) {
                    changeState('LIFTING', "Tbg-Line Trigger.");
                }
                return;
            }
        }
    }

    else if (state === 'LIFTING') {
        // 1. Arrival Check
        if (PlungerDepth <= 0) {
            changeState('AFTERFLOW', "Plunger Arrived.");
            return;
        }

        // 2. Non-Arrival (Max Wait) Check
        if (stateTimer >= inMaxWait) {
            changeState('MANDATORY_SHUTIN', "Non-Arrival! Max Wait Expired.");
            return;
        }
    }

    else if (state === 'AFTERFLOW') {
        // 1. Must satisfy Min Afterflow first
        if (stateTimer < inMinAft) return;

        // 2. Check Max Afterflow
        if (stateTimer >= inMaxAft) {
            changeState('UNARMED_SHUTIN', "Max Afterflow Time Expired.");
            return;
        }

        // 3. Check Close Triggers (Only after Close Delay)
        if (stateTimer > (inMinAft + inCloseDly)) {

            // Flow Rate < Setpoint
            if (document.getElementById('chkCloseFlow').checked) {
                let setpoint = parseFloat(document.getElementById('inCloseFlowVal').value);
                if (FlowRate <= setpoint) {
                    changeState('UNARMED_SHUTIN', "Low Flow Rate Trigger.");
                    return;
                }
            }

            // Tubing - Line < Setpoint (DP)
            if (document.getElementById('chkCloseDP').checked) {
                let setpoint = parseFloat(document.getElementById('inCloseDPVal').value);
                if ((P_tubing - P_line) <= setpoint) {
                    changeState('UNARMED_SHUTIN', "Low Differential (Tbg-Ln) Trigger.");
                    return;
                }
            }
            // ON Time >= Setpoint (total time in LIFTING + AFTERFLOW)
            if (document.getElementById('chkCloseOnTime').checked) {
                let setpoint = parseFloat(document.getElementById('inCloseOnTimeVal').value);
                if (totalOnTime >= setpoint) {
                    changeState('UNARMED_SHUTIN', "ON Time Trigger.");
                    return;
                }
            }
            // Casing <= Setpoint
            if (document.getElementById('chkCloseCasing').checked) {
                let setpoint = parseFloat(document.getElementById('inCloseCasingVal').value);
                if (P_casing <= setpoint) {
                    changeState('UNARMED_SHUTIN', "Low Casing Trigger.");
                    return;
                }
            }
            // Tubing <= Setpoint
            if (document.getElementById('chkCloseTubing').checked) {
                let setpoint = parseFloat(document.getElementById('inCloseTubingVal').value);
                if (P_tubing <= setpoint) {
                    changeState('UNARMED_SHUTIN', "Low Tubing Trigger.");
                    return;
                }
            }
            // Csg - Tbg >= Setpoint
            if (document.getElementById('chkCloseCsgTbg').checked) {
                let setpoint = parseFloat(document.getElementById('inCloseCsgTbgVal').value);
                if ((P_casing - P_tubing) >= setpoint) {
                    changeState('UNARMED_SHUTIN', "High Csg-Tbg Trigger.");
                    return;
                }
            }
            // Csg - Line <= Setpoint
            if (document.getElementById('chkCloseCsgLine').checked) {
                let setpoint = parseFloat(document.getElementById('inCloseCsgLineVal').value);
                if ((P_casing - P_line) <= setpoint) {
                    changeState('UNARMED_SHUTIN', "Low Csg-Line Trigger.");
                    return;
                }
            }
        }
    }
}

function changeState(newState, reason) {
    const oldState = state;
    const oldStateTimer = stateTimer; // Capture before reset

    // VERIFY: Log pressure coupling at state transitions
    const csgTbgDiff = P_casing - P_tubing;
    console.log(`[${simTime.toFixed(0)}m] STATE: ${oldState} → ${newState} | P_csg: ${P_casing.toFixed(1)}, P_tbg: ${P_tubing.toFixed(1)}, LiqCol: ${liquidColumnPsi.toFixed(1)}, Csg-Tbg: ${csgTbgDiff.toFixed(1)}`);

    // Capture cycle data BEFORE resetting state timer
    if (newState === 'LIFTING' && (oldState === 'ARMED_SHUTIN' || oldState === 'MANDATORY_SHUTIN')) {
        // TWO-POOL MODEL: Depth-aware liquid pickup
        // Liquid pools at the bottom of tubing. Plunger only picks up liquid at or below its depth.
        const liquidHeight_ft = liquidInTubing * FT_PER_BBL;  // height of liquid pool (ft)
        const liquidTopDepth = WELL_DEPTH - liquidHeight_ft;   // depth where liquid pool starts (ft from surface)

        if (PlungerDepth <= liquidTopDepth) {
            // Plunger is ABOVE the liquid pool — dry lift
            liquidAbovePlunger = 0;
            liquidBelowPlunger = liquidInTubing;
            logEvent(`DRY LIFT: Plunger at ${PlungerDepth.toFixed(0)} ft, liquid starts at ${liquidTopDepth.toFixed(0)} ft`, 'warning');
        } else if (PlungerDepth >= WELL_DEPTH) {
            // Plunger at bottom — full pickup (normal case)
            liquidAbovePlunger = liquidInTubing;
            liquidBelowPlunger = 0;
        } else {
            // Plunger is inside the liquid pool — partial pickup
            const depthIntoLiquid_ft = PlungerDepth - liquidTopDepth;
            liquidAbovePlunger = Math.min(depthIntoLiquid_ft / FT_PER_BBL, liquidInTubing);
            liquidBelowPlunger = liquidInTubing - liquidAbovePlunger;
            logEvent(`PARTIAL LIFT: ${liquidAbovePlunger.toFixed(2)} of ${liquidInTubing.toFixed(2)} bbl picked up`, 'warning');
        }

        // MASS-CONSERVING PHYSICS: Initialize gas mass above plunger
        // This is the gas that will be tracked during lift - only decreases when it flows out
        const V_tubing_init_ft3 = TUBING_AREA_FT2 * PlungerDepth;
        const V_liquid_init_ft3 = liquidAbovePlunger * 5.615;  // bbl to ft³
        const V_gas_init_ft3 = Math.max(V_tubing_init_ft3 - V_liquid_init_ft3, 0.1);
        const P_tubing_abs_init = P_tubing + 14.7;  // psia
        gasAbovePlunger_scf = V_gas_init_ft3 * (P_tubing_abs_init / 14.7) * (520 / GAS_TEMP_R) / GAS_Z;

        // VERIFY: Log lift start conditions with gas mass
        console.log(`LIFT START: P_casing=${P_casing.toFixed(1)}, P_tubing=${P_tubing.toFixed(1)}, slugAbove=${liquidAbovePlunger.toFixed(3)} bbl, gasAbove=${gasAbovePlunger_scf.toFixed(0)} scf (${(gasAbovePlunger_scf/1000).toFixed(1)} Mcf)`);

        // Valve OPENING - capture opening data (pass old timer)
        captureOpeningData(reason, oldStateTimer);
        // Reset stall tracking for new lift cycle
        stallTimer = 0;
        isStalled = false;
        totalOffTime = 0; // Off-time resets when well opens

        if (LoadFactor > 70) {
            logEvent(`STALL: Load Factor ${LoadFactor.toFixed(1)}% too high at open - insufficient lift energy`, 'critical');
            newState = 'MANDATORY_SHUTIN';
            reason = 'High Load Factor Stall';
            // consecutiveFailures incremented by MANDATORY_SHUTIN handler below
        }
    }

    state = newState;
    stateTimer = 0;
    logEvent(`${newState}: ${reason || ''}`);
    renderStatus();

    if (newState === 'AFTERFLOW') {
        // Plunger arrived - calculate rise time and mark afterflow start
        lastRiseTime = simTime - liftStartTime;
        lastArrivalVelocity = PlungerVel;  // Capture velocity at arrival
        afterflowStartTime = simTime;

        // Record arrival for Last 10 Arrivals table
        const arrivalNum = arrivalHistory.length + 1;
        const avgVel = lastRiseTime > 0 ? WELL_DEPTH / lastRiseTime : 0;
        arrivalHistory.unshift({ number: arrivalNum, riseVelocity: avgVel, riseTime: lastRiseTime });
        if (arrivalHistory.length > 10) arrivalHistory.pop();
        updateArrivalsTable();

        // Calculate average rise velocity (industry standard metric)
        lastAvgRiseVelocity = lastRiseTime > 0 ? WELL_DEPTH / lastRiseTime : 0;  // ft/min

        // VERIFY: Log lift end conditions with gas mass balance
        console.log(`LIFT END: rise_time=${lastRiseTime.toFixed(1)}min | avg_vel=${lastAvgRiseVelocity.toFixed(0)} ft/min | arrival_vel=${PlungerVel.toFixed(0)} ft/min | gasRemaining=${(gasAbovePlunger_scf/1000).toFixed(2)} Mcf`);

        logEvent(`Rise time: ${lastRiseTime.toFixed(1)} min (suggested afterflow: ${(lastRiseTime * 2.25).toFixed(1)} min)`, 'success');

        // === ARRIVAL PRESSURE: Static regime change ===
        // At arrival, the slug above plunger is expelled into the flow line.
        // Conventional: PT sees casing pressure minus liquid remaining (big spike toward casing).
        // Packer: PT spikes to the surface value implied by current Pwf (no casing to track).
        if (COMPLETION_TYPE === 'packer') {
            P_tubing = calculateTubingFromPwf_Packer(Pwf, liquidBelowPlunger * LIQUID_PSI_PER_BBL);
        } else {
            P_tubing = P_casing - (liquidBelowPlunger * LIQUID_PSI_PER_BBL);
        }

        // === TWO-POOL LIQUID MODEL: Plunger Arrival ===
        // liquidAbovePlunger = slug that was lifted out (PRODUCED)
        // liquidBelowPlunger = new liquid that entered during lift (stays in wellbore)

        const liquidProducedThisCycle = liquidAbovePlunger;
        const liquidRemainingInWellbore = liquidBelowPlunger;

        // Track liquid production
        totalLiquidProducedBbl += liquidProducedThisCycle;
        todayBbl += liquidProducedThisCycle;
        lastFallback = liquidRemainingInWellbore;  // Track for UI display

        if (liquidRemainingInWellbore > 0.1) {
            logEvent(`NOTE: ${liquidRemainingInWellbore.toFixed(2)} bbl entered during lift - will be lifted next cycle`);
        }

        // Initialize tubing gas mass for two-tank afterflow model
        // P_tubing was just set to arrival pressure above
        const effectiveTubingVol = TUBING_VOLUME_FT3 - (liquidRemainingInWellbore * 5.615);
        tubingGasScf = Math.max(0, effectiveTubingVol) * ((P_tubing + 14.7) / 14.7) * (520 / GAS_TEMP_R) / GAS_Z;
        console.log(`AFTERFLOW INIT: tubingGasScf=${tubingGasScf.toFixed(0)} scf (${(tubingGasScf/1000).toFixed(1)} Mcf), effectiveVol=${effectiveTubingVol.toFixed(1)} ft³, P_tubing=${P_tubing.toFixed(1)}`);

        // Transfer liquid below plunger to tubing (plunger now at surface)
        liquidInTubing = liquidRemainingInWellbore;
        liquidAbovePlunger = 0;  // Nothing above plunger at surface
        liquidBelowPlunger = 0;  // Reset - now tracked as liquidInTubing

        // Update compatibility variables
        liquidAccumulationBbl = liquidInTubing;
        liquidColumnPsi = liquidInTubing * LIQUID_PSI_PER_BBL;
    }

    if (newState === 'UNARMED_SHUTIN' && oldState === 'AFTERFLOW') {
        totalOnTime = 0; // On-time resets when well closes
        // Valve CLOSING - capture closing data
        captureClosingData(reason);
        updateCycleTable();
        logCycleSummary();  // Log cycle stats to event log

        // === TWO-POOL LIQUID MODEL: Valve Closing ===
        // Plunger has fallen to bottom during afterflow
        // All tubing liquid is now above the plunger
        liquidAbovePlunger = liquidInTubing;
        liquidBelowPlunger = 0;  // Nothing below plunger at bottom
        liquidAccumulationBbl = liquidInTubing;

        console.log(`SHUTIN START: liquidInTubing=${liquidInTubing.toFixed(3)} bbl, all above plunger`);
    }

    if (newState === 'MANDATORY_SHUTIN') {
        totalOnTime = 0; // On-time resets on non-arrival close
        // VERIFY: Log failed lift conditions
        if (oldState === 'LIFTING') {
            const liftDuration = simTime - liftStartTime;
            console.log(`LIFT FAILED: P_casing=${P_casing.toFixed(1)}, P_tubing=${P_tubing.toFixed(1)}, duration=${liftDuration.toFixed(1)}min, PlungerDepth=${PlungerDepth.toFixed(0)}ft`);

            // === TWO-POOL LIQUID MODEL: Failed Lift ===
            // Plunger falls back down - all liquid merges back together
            const totalLiquidAfterFail = liquidAbovePlunger + liquidBelowPlunger;
            liquidInTubing = totalLiquidAfterFail;
            liquidAbovePlunger = totalLiquidAfterFail;  // All liquid above plunger at bottom
            liquidBelowPlunger = 0;
            liquidAccumulationBbl = totalLiquidAfterFail;
            liquidColumnPsi = totalLiquidAfterFail * LIQUID_PSI_PER_BBL;

            console.log(`LIFT FAILED: Liquid merged back: ${totalLiquidAfterFail.toFixed(3)} bbl`);
        }

        // Non-arrival penalty - still capture as closing but mark it
        lastCloseTrigger = 'Non-Arrival';
        // Increment consecutive failure counter
        consecutiveFailures++;
        logEvent(`WARNING: Non-arrival #${consecutiveFailures}`, 'warning');
        if (consecutiveFailures >= MAX_CONSEC_FAILURES) {
            logEvent(`ALARM: ${consecutiveFailures} consecutive failures - check well conditions`, 'critical');
        }
    }

    if (newState === 'AFTERFLOW') {
        // Successful arrival - reset consecutive failure counter
        consecutiveFailures = 0;
    }

    // Update cycle status indicator
    if (cycleHistory.opening.length > 0) {
        document.getElementById('cycleStatusIndicator').innerText = cycleHistory.opening.length + ' Recorded';
    }
}
