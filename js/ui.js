// --- VISUALIZATION ---
function updateUI() {
    const isPacker = (COMPLETION_TYPE === 'packer');
    els.flow.innerText = FlowRate.toFixed(1);
    els.tbg.innerText = P_tubing.toFixed(1);
    if (isPacker) {
        els.csg.innerText = 'PACKED';
        if (els.pwf) els.pwf.innerText = Pwf.toFixed(1);
    } else {
        els.csg.innerText = P_casing.toFixed(1);
        if (els.pwf) els.pwf.innerText = '--';
    }
    // Line pressure is an editable <input> — write .value, and don't clobber it
    // while the user is typing in it.
    if (typeof document !== 'undefined' && document.activeElement === els.line) {
        // user is editing; leave it alone
    } else if ('value' in els.line) {
        els.line.value = P_line.toFixed(1);
    } else {
        els.line.innerText = P_line.toFixed(1);
    }
    els.depth.innerText = PlungerDepth.toFixed(0);
    els.vel.innerText = PlungerVel.toFixed(0);

    // Update velocity indicator color based on research thresholds
    if (state === 'LIFTING' && PlungerVel > 0) {
        if (PlungerVel > 1000) {
            els.velIndicator.className = 'velocity-indicator vel-fast';
        } else if (PlungerVel >= 500) {
            els.velIndicator.className = 'velocity-indicator vel-good';
        } else if (PlungerVel >= 200) {
            els.velIndicator.className = 'velocity-indicator vel-slow';
        } else {
            els.velIndicator.className = 'velocity-indicator vel-stall';
        }
    } else {
        els.velIndicator.className = 'velocity-indicator';
    }

    if (state === 'LIFTING') {
        els.timerLift.innerText = stateTimer.toFixed(1);
    } else {
        els.timerLift.innerText = "0.0";
    }

    // Update rise time and arrival quality display
    if (lastRiseTime > 0) {
        document.getElementById('valRiseTime').innerText = lastRiseTime.toFixed(1);
    }
    if (lastAvgRiseVelocity > 0) {
        document.getElementById('valArrivalVel').innerText = lastAvgRiseVelocity.toFixed(0);

        // Color code average rise velocity (optimal range 400-700 ft/min)
        const velDisplay = document.getElementById('valArrivalVel');
        if (lastAvgRiseVelocity >= 400 && lastAvgRiseVelocity <= 700) velDisplay.style.color = '#00ff00';  // Green - optimal
        else if (lastAvgRiseVelocity >= 300 && lastAvgRiseVelocity <= 800) velDisplay.style.color = '#00ffff';  // Cyan - acceptable
        else if (lastAvgRiseVelocity > 800) velDisplay.style.color = '#ffff00';  // Yellow - too fast
        else velDisplay.style.color = '#ff3333';  // Red - too slow
    }

    // Update liquid display - show total liquid in wellbore
    document.getElementById('valLiquidBbl').innerText = liquidAccumulationBbl.toFixed(3);
    document.getElementById('valLiquidPsi').innerText = liquidColumnPsi.toFixed(1);

    // Color code liquid level - higher is concerning
    const liqDisplay = document.getElementById('valLiquidBbl');
    if (liquidAccumulationBbl < 0.3) {
        liqDisplay.style.color = '#00ff00'; // Green - low liquid
    } else if (liquidAccumulationBbl < 0.8) {
        liqDisplay.style.color = '#ffff00'; // Yellow - moderate
    } else {
        liqDisplay.style.color = '#ff3333'; // Red - high liquid load
    }

    // Update consecutive failures display
    const failDisplay = document.getElementById('valConsecFails');
    failDisplay.innerText = consecutiveFailures;
    if (consecutiveFailures >= MAX_CONSEC_FAILURES) {
        failDisplay.style.color = '#ff3333'; // Red
        failDisplay.style.background = '#330000';
    } else if (consecutiveFailures > 0) {
        failDisplay.style.color = '#ffff00'; // Yellow
        failDisplay.style.background = '#333300';
    } else {
        failDisplay.style.color = '#00ff00'; // Green
        failDisplay.style.background = '#000';
    }

    // C=T (Casing = Tubing) detection
    // Only check during shut-in states after pressure has had time to differentiate
    // Exclude LIFTING (pressures converge naturally) and AFTERFLOW (pressures equalize through open valve)
    const ctDiff = Math.abs(P_casing - P_tubing);
    const ctDisplay = document.getElementById('valCTStatus');
    const minShutInForCT = 10;
    const isShutInState = (state === 'ARMED_SHUTIN' || state === 'UNARMED_SHUTIN' || state === 'MANDATORY_SHUTIN');
    const sufficientShutInTime = isShutInState && stateTimer > minShutInForCT;

    if (isPacker) {
        // No casing-tubing differential exists with a sealed annulus
        ctAlarmActive = false;
        ctDisplay.innerText = 'N/A';
        ctDisplay.style.color = '#888';
        ctDisplay.style.background = '#000';
    } else if (ctDiff <= CT_THRESHOLD && isShutInState && sufficientShutInTime) {
        ctAlarmActive = true;
        ctDisplay.innerText = 'ALARM';
        ctDisplay.style.color = '#ff3333';
        ctDisplay.style.background = '#330000';
    } else {
        ctAlarmActive = false;
        ctDisplay.innerText = 'OK';
        ctDisplay.style.color = '#00ff00';
        ctDisplay.style.background = '#000';
    }

    document.getElementById('lastCommTime').innerText = formatDayHrMin(simTime);

    updateTriggerActuals();
}

function updateTriggerActuals() {
    // Close trigger actuals
    document.getElementById('actCloseFlow').innerText = FlowRate.toFixed(0);
    document.getElementById('actCloseTbgLine').innerText = (P_tubing - P_line).toFixed(0);
    document.getElementById('actCloseOnTime').innerText = totalOnTime.toFixed(0);
    document.getElementById('actCloseCasing').innerText = P_casing.toFixed(0);
    document.getElementById('actCloseTubing').innerText = P_tubing.toFixed(0);
    document.getElementById('actCloseCsgTbg').innerText = (P_casing - P_tubing).toFixed(0);
    document.getElementById('actCloseCsgLine').innerText = (P_casing - P_line).toFixed(0);

    // Open trigger actuals
    var actOpenCsg = document.getElementById('actOpenCsg');
    actOpenCsg.innerText = P_casing.toFixed(0);

    var actOpenLoad = document.getElementById('actOpenLoad');
    actOpenLoad.innerText = LoadFactor.toFixed(1);
    // Color code Load Factor based on optimal range
    if (LoadFactor >= 40 && LoadFactor <= 50) {
        actOpenLoad.style.color = '#00ff00'; // Green - optimal
    } else if (LoadFactor < 40) {
        actOpenLoad.style.color = '#00ffff'; // Cyan - excess energy
    } else if (LoadFactor <= 60) {
        actOpenLoad.style.color = '#ffff00'; // Yellow - caution
    } else {
        actOpenLoad.style.color = '#ff3333'; // Red - struggling
    }

    document.getElementById('actOpenDiff').innerText = (P_casing - P_tubing).toFixed(0);
    document.getElementById('actOpenOffTime').innerText = totalOffTime.toFixed(0);
    document.getElementById('actOpenArmedTime').innerText =
        (state === 'ARMED_SHUTIN') ? stateTimer.toFixed(0) : '--';
    document.getElementById('actOpenTubing').innerText = P_tubing.toFixed(0);
    document.getElementById('actOpenTbgLine').innerText = (P_tubing - P_line).toFixed(0);
}

function updateArrivalsTable() {
    const tbody = document.getElementById('arrivalsTableBody');
    if (arrivalHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#666;">--</td></tr>';
        return;
    }
    let html = '';
    arrivalHistory.forEach((a, i) => {
        const displayNum = i + 1;  // 1 = most recent, counting down
        html += `<tr><td>${displayNum}</td><td>${a.riseVelocity.toFixed(0)}</td><td>${a.riseTime.toFixed(1)}</td></tr>`;
    });
    tbody.innerHTML = html;
}

function renderStatus() {
    els.status.innerText = state.replace('_', ' ');
    els.status.className = 'status-box';

    if (state === 'LIFTING') els.status.classList.add('wait');
    if (state === 'MANDATORY_SHUTIN') els.status.classList.add('error');
    if (state === 'AFTERFLOW') els.status.style.color = '#00ffff';
}

// Log event with optional severity level: 'info', 'success', 'warning', 'critical'
function logEvent(msg, level = 'info') {
    const div = document.createElement('div');
    const hours = Math.floor(simTime / 60);
    const mins = Math.floor(simTime % 60);
    const timestamp = `${hours}:${mins.toString().padStart(2, '0')}`;
    div.innerText = `[${timestamp}] ${msg}`;
    div.className = `log-${level}`;
    els.log.prepend(div);
}

// Log cycle summary after each completed cycle
function logCycleSummary() {
    if (cycleHistory.closing.length === 0) return;

    const lastCycle = cycleHistory.closing[0];
    const riseTime = parseFloat(lastCycle.riseTime);
    const avgVel = riseTime > 0 ? WELL_DEPTH / riseTime : 0;
    const flowRate = parseFloat(lastCycle.flowRate);
    const critRate = parseFloat(lastCycle.criticalRate);
    const cycleMcf = parseFloat(lastCycle.cycleMcf);

    // Log cycle summary
    logEvent(`CYCLE COMPLETE: ${cycleMcf.toFixed(1)} Mcf | Rise: ${riseTime.toFixed(1)} min (${avgVel.toFixed(0)} ft/min) | Flow: ${flowRate.toFixed(0)} vs Crit: ${critRate.toFixed(0)} Mcfd`, 'success');

    // Add contextual notes based on performance
    if (avgVel > 0 && avgVel < 350) {
        logEvent(`Slow rise velocity (${avgVel.toFixed(0)} ft/min) - consider increasing shut-in time`, 'warning');
    } else if (avgVel > 1000) {
        logEvent(`Fast rise velocity (${avgVel.toFixed(0)} ft/min) - could reduce shut-in time`, 'warning');
    }

    if (flowRate < critRate && flowRate > 0) {
        logEvent(`Final flow below critical rate - liquid may be accumulating`, 'warning');
    }

    if (liquidAccumulationBbl > 1.0) {
        logEvent(`High liquid in wellbore: ${liquidAccumulationBbl.toFixed(2)} bbl - reduce afterflow time`, 'warning');
    }
}
