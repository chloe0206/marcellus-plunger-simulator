// --- MAIN SIMULATION LOOP ---

// Update simulation speed from dropdown
function updateSpeed() {
    TIME_SCALE = parseInt(document.getElementById('speedSelect').value);
}

// Update chart view window when dropdown changes
function updateChartView() {
    chartViewWindowMinutes = parseInt(document.getElementById('chartViewSelect').value);
    drawChart(); // Redraw immediately with new window
}

function updateSimulation() {
    // Calculate time step (dt in minutes)
    const dt = (TICK_RATE_MS / 1000) * (TIME_SCALE / 60);
    simTime += dt;
    stateTimer += dt;

    // 1. UPDATE PHYSICS BASED ON STATE
    updatePhysics(dt);

    // 2. CHECK STATE TRANSITION LOGIC
    checkLogic();

    // 3. UPDATE UI
    updateUI();
    updateChart();
    drawWellbore();
}

// --- CYCLE TRACKING FUNCTIONS ---

// Format simulation time as Day.HrMin (e.g., 25.0832 = Day 25, 08:32)
function formatDayHrMin(totalMins) {
    const days = Math.floor(totalMins / 1440) + 1; // Day 1 starts at 0
    const remainingMins = totalMins % 1440;
    const hours = Math.floor(remainingMins / 60);
    const mins = Math.floor(remainingMins % 60);
    return `${days}.${hours.toString().padStart(2,'0')}${mins.toString().padStart(2,'0')}`;
}

// Capture data when valve OPENS (transition to LIFTING)
function captureOpeningData(trigger, armedStateTime) {
    const openingRecord = {
        dayHrMin: formatDayHrMin(simTime),
        event: trigger,
        refVal: trigger.includes('Casing Pressure') ? Math.round(parseFloat(document.getElementById('inOpenCsgVal').value)) :
                trigger.includes('Differential') ? Math.round(parseFloat(document.getElementById('inOpenDiffVal').value)) :
                trigger.includes('Off Time') ? Math.round(parseFloat(document.getElementById('inOpenOffTimeVal').value)) :
                trigger.includes('Armed Time') ? Math.round(parseFloat(document.getElementById('inOpenArmedTimeVal').value)) :
                trigger.includes('Tubing Pressure') ? Math.round(parseFloat(document.getElementById('inOpenTubingVal').value)) :
                trigger.includes('Tbg-Line') ? Math.round(parseFloat(document.getElementById('inOpenTbgLineVal').value)) :
                Math.round(parseFloat(document.getElementById('inMaxShutIn').value)),
        casingPsig: P_casing.toFixed(2),
        tubingPsig: P_tubing.toFixed(2),
        loadFactor: LoadFactor.toFixed(2),
        totOffMins: totalShutInMins.toFixed(2),
        netOffMins: armedStateTime.toFixed(2),  // Time spent in ARMED state before opening
        casingLine: (P_casing - P_line).toFixed(2),
        tubingLine: (P_tubing - P_line).toFixed(2),
        linePsig: P_line.toFixed(2)
    };

    cycleHistory.opening.unshift(openingRecord);
    if (cycleHistory.opening.length > 5) cycleHistory.opening.pop();

    // Reset cycle tracking for the flow period
    liftStartTime = simTime;
    liquidAtLiftStart = liquidAccumulationBbl;  // Record liquid to be lifted
    lowestCasingInCycle = P_casing;
    cycleTotalFlow = 0;
    lastOpenTrigger = trigger;
}

// Capture data when valve CLOSES (transition from AFTERFLOW to UNARMED)
function captureClosingData(trigger) {
    const afterflowMins = simTime - afterflowStartTime;
    const cycleMcf = cycleTotalFlow; // Already in Mcf from accumulation

    // Determine arrival type
    let arrivalType = 'Unassisted Arriv';
    if (lastOpenTrigger.includes('Non-Arrival') || lastOpenTrigger.includes('Penalty')) {
        arrivalType = 'Non-Arrival';
    }

    const closingRecord = {
        dayHrMin: formatDayHrMin(simTime),
        event: trigger,
        refVal: trigger.includes('Flow') ? Math.round(parseFloat(document.getElementById('inCloseFlowVal').value)) :
                trigger.includes('Differential') || trigger.includes('Tbg-Ln') ? Math.round(parseFloat(document.getElementById('inCloseDPVal').value)) :
                trigger.includes('ON Time') ? Math.round(parseFloat(document.getElementById('inCloseOnTimeVal').value)) :
                trigger.includes('Low Casing') ? Math.round(parseFloat(document.getElementById('inCloseCasingVal').value)) :
                trigger.includes('Low Tubing') ? Math.round(parseFloat(document.getElementById('inCloseTubingVal').value)) :
                trigger.includes('Csg-Tbg') ? Math.round(parseFloat(document.getElementById('inCloseCsgTbgVal').value)) :
                trigger.includes('Csg-Line') ? Math.round(parseFloat(document.getElementById('inCloseCsgLineVal').value)) :
                Math.round(parseFloat(document.getElementById('inMaxAft').value)),
        casingPsig: P_casing.toFixed(2),
        tubingPsig: P_tubing.toFixed(2),
        lowestCsg: lowestCasingInCycle.toFixed(2),
        flowRate: FlowRate.toFixed(1),
        criticalRate: calculateCriticalRate().toFixed(1),
        riseTime: lastRiseTime.toFixed(1),
        aftFlwMins: afterflowMins.toFixed(2),
        cycleMcf: cycleMcf.toFixed(1),
        arrivalType: arrivalType
    };

    cycleHistory.closing.unshift(closingRecord);
    if (cycleHistory.closing.length > 5) cycleHistory.closing.pop();

    // Update daily production totals
    totalProductionMcf += cycleMcf;
    todayMcf += cycleMcf;
    completedCycleCount++;
    updateDailySummary();

    // Reset for next cycle
    cycleStartTime = simTime;
    totalShutInMins = 0;
}

// Update cycle table display
function updateCycleTable() {
    // Opening table
    let openingHTML = '';
    const openLabels = ['Prev', '2 Prev', '3 Prev', '4 Prev', '5 Prev'];
    cycleHistory.opening.forEach((rec, i) => {
        openingHTML += `<tr>
            <td>${openLabels[i]}</td>
            <td>${rec.dayHrMin}</td>
            <td>${rec.event}</td>
            <td>${rec.refVal}</td>
            <td>${rec.casingPsig}</td>
            <td>${rec.tubingPsig}</td>
            <td>${rec.loadFactor}</td>
            <td>${rec.totOffMins}</td>
            <td>${rec.netOffMins}</td>
            <td>${rec.casingLine}</td>
            <td>${rec.tubingLine}</td>
            <td>${rec.linePsig}</td>
        </tr>`;
    });
    document.getElementById('openingTableBody').innerHTML = openingHTML || '<tr><td colspan="12">No cycles recorded yet</td></tr>';

    // Closing table
    let closingHTML = '';
    cycleHistory.closing.forEach((rec, i) => {
        closingHTML += `<tr>
            <td>${openLabels[i]}</td>
            <td>${rec.dayHrMin}</td>
            <td>${rec.event}</td>
            <td>${rec.refVal}</td>
            <td>${rec.casingPsig}</td>
            <td>${rec.tubingPsig}</td>
            <td>${rec.lowestCsg}</td>
            <td>${rec.flowRate}</td>
            <td>${rec.criticalRate}</td>
            <td>${rec.riseTime}</td>
            <td>${rec.aftFlwMins}</td>
            <td>${rec.cycleMcf}</td>
            <td>${rec.arrivalType}</td>
        </tr>`;
    });
    document.getElementById('closingTableBody').innerHTML = closingHTML || '<tr><td colspan="13">No cycles recorded yet</td></tr>';
}

// Update daily production summary display
function updateDailySummary() {
    const hoursElapsed = simTime / 60;
    const avgMcfPerCycle = completedCycleCount > 0 ? (totalProductionMcf / completedCycleCount) : 0;

    // Check for day rollover (every 24 sim hours)
    const newSimDay = Math.floor(hoursElapsed / 24);
    if (newSimDay > currentSimDay) {
        // Roll over: today becomes yesterday
        yesterdayMcf = todayMcf;
        yesterdayBbl = todayBbl;

        // Log daily metrics before resetting
        logDailyMetrics(currentSimDay + 1);

        todayMcf = 0;
        todayBbl = 0;
        currentSimDay = newSimDay;
    }

    // Project to 24-hour rate based on current performance
    let projectedDaily = 0;
    let cyclesPerDay = 0;
    if (hoursElapsed > 0 && completedCycleCount > 0) {
        projectedDaily = (totalProductionMcf / hoursElapsed) * 24;
        // Cycles per day pace - THE key optimization metric
        cyclesPerDay = (completedCycleCount / hoursElapsed) * 24;
    }

    document.getElementById('summaryTodayMcf').innerText = todayMcf.toFixed(1);
    document.getElementById('summaryTodayBbl').innerText = todayBbl.toFixed(2);
    document.getElementById('summaryYesterdayMcf').innerText = yesterdayMcf !== null ? yesterdayMcf.toFixed(1) : '--';
    document.getElementById('summaryYesterdayBbl').innerText = yesterdayBbl !== null ? yesterdayBbl.toFixed(2) : '--';
    document.getElementById('summaryCycles').innerText = completedCycleCount;
    document.getElementById('summaryAvgMcf').innerText = avgMcfPerCycle.toFixed(1);
    document.getElementById('summaryProjected').innerText = projectedDaily.toFixed(1);
    document.getElementById('summaryHours').innerText = hoursElapsed.toFixed(1);
    document.getElementById('summaryCyclesPerDay').innerText = cyclesPerDay.toFixed(1);
}

// Log daily metrics to console every 24 sim hours
function logDailyMetrics(dayNumber) {
    // Calculate metrics from cycle history and production totals
    const hoursElapsed = simTime / 60;

    // Cycles and production (use yesterday's values since day just rolled over)
    const cycles = cycleHistory.closing.length; // Last 5 cycles available
    const dailyMcf = yesterdayMcf !== null ? yesterdayMcf : todayMcf;
    const dailyBbl = yesterdayBbl !== null ? yesterdayBbl : todayBbl;

    // Calculate averages from cycle history
    let avgRiseTime = 0;
    let avgCsgAtOpen = 0;
    let avgCsgAtClose = 0;
    let validRiseTimes = 0;

    if (cycleHistory.closing.length > 0) {
        cycleHistory.closing.forEach(cycle => {
            const riseTime = parseFloat(cycle.riseTime);
            if (riseTime > 0 && riseTime < 60) { // Valid rise time (not a failed lift)
                avgRiseTime += riseTime;
                validRiseTimes++;
            }
            avgCsgAtClose += parseFloat(cycle.casingPsig);
        });
        avgCsgAtClose /= cycleHistory.closing.length;
    }
    if (validRiseTimes > 0) {
        avgRiseTime /= validRiseTimes;
    }

    if (cycleHistory.opening.length > 0) {
        cycleHistory.opening.forEach(cycle => {
            avgCsgAtOpen += parseFloat(cycle.casingPsig);
        });
        avgCsgAtOpen /= cycleHistory.opening.length;
    }

    // Calculate average rise velocity from rise time and well depth
    const avgRiseVelocity = avgRiseTime > 0 ? WELL_DEPTH / avgRiseTime : 0;

    // Log formatted metrics
    console.log(`
=== DAILY METRICS (Day ${dayNumber}) ===
Cycles: ${completedCycleCount} total (target: 12-20/day)
Production: ${dailyMcf.toFixed(1)} Mcf (target: 300-500 Mcf/day)
Avg Rise Time: ${avgRiseTime.toFixed(1)} min (target: 6-12 min)
Avg Rise Velocity: ${avgRiseVelocity.toFixed(0)} ft/min (target: 800-1100 ft/min)
Avg Csg at Open: ${avgCsgAtOpen.toFixed(0)} psig (target: 550-650 psig)
Avg Csg at Close: ${avgCsgAtClose.toFixed(0)} psig
Liquid Produced: ${dailyBbl.toFixed(2)} bbl
===============================`);
}

// --- CONTROLS ---

// Live line-pressure change (gathering-system what-if). Applies immediately:
// the physics reads P_line every tick, so no reset is needed. P_LINE_BASE is
// updated too so a later RESET keeps the operator's value; switching well
// preset restores that preset's line pressure.
function setLinePressure(value) {
    const v = parseFloat(value);
    if (!isFinite(v) || v < 0) {
        logEvent('Ignored invalid line pressure input.', 'warning');
        if (els.line) els.line.value = P_line.toFixed(1);
        return;
    }
    const old = P_line;
    P_LINE_BASE = v;
    P_line = v;
    logEvent(`Line pressure set to ${v.toFixed(0)} psi (was ${old.toFixed(0)}).`, 'info');
    if (v >= RESERVOIR_PRESSURE) {
        logEvent(`Line pressure >= reservoir pressure (${RESERVOIR_PRESSURE} psi) — the well cannot flow against this line.`, 'warning');
    }
    if (els.line && typeof els.line.blur === 'function') els.line.blur();
    updateUI();
}

function toggleSimulation() {
    if (running) {
        clearInterval(timer);
        running = false;
        els.btn.innerText = "RESUME";
        els.btn.classList.remove('primary');
    } else {
        timer = setInterval(updateSimulation, TICK_RATE_MS);
        running = true;
        els.btn.innerText = "PAUSE";
        els.btn.classList.add('primary');
    }
}

function resetSimulation() {
    clearInterval(timer);
    running = false;
    els.btn.innerText = "START SIMULATION";
    els.btn.classList.add('primary');

    simTime = 0;
    state = 'ARMED_SHUTIN';
    stateTimer = 0;
    P_line = P_LINE_BASE;
    P_casing = INITIAL_CONDITIONS.P_casing;
    P_tubing = INITIAL_CONDITIONS.P_tubing;
    FlowRate = 0;
    PlungerDepth = WELL_DEPTH;  // use current well depth (may differ from default 7000)
    gasAbovePlunger_scf = 0;    // Will be initialized at lift start
    tubingGasScf = 0;           // Will be initialized at arrival (two-tank afterflow)

    // Pwf init: packer mode derives from surface tubing + columns;
    // conventional mode leaves Pwf at 0 (not used as a state variable there).
    liquidInTubing = INITIAL_CONDITIONS.liquidInTubing;
    liquidAbovePlunger = INITIAL_CONDITIONS.liquidInTubing;
    liquidBelowPlunger = 0;
    liquidColumnPsi = liquidAbovePlunger * LIQUID_PSI_PER_BBL;
    if (COMPLETION_TYPE === 'packer' && typeof calculatePwf_FromTubing_Packer === 'function') {
        Pwf = calculatePwf_FromTubing_Packer(P_tubing, liquidColumnPsi);
    } else {
        Pwf = 0;
    }

    // Wipe chart history so old (different-well) data doesn't skew the axes after a preset swap
    if (typeof chartData !== 'undefined') chartData.length = 0;
    if (typeof lastChartPushTime !== 'undefined') lastChartPushTime = -1;

    // Reset cycle tracking variables
    cycleStartTime = 0;
    liftStartTime = 0;
    afterflowStartTime = 0;
    lastRiseTime = 0;
    lastArrivalVelocity = 0;
    lastAvgRiseVelocity = 0;
    liquidAtLiftStart = 0;
    lastFallback = 0;
    lowestCasingInCycle = 9999;
    cycleTotalFlow = 0;
    lastOpenTrigger = '';
    lastCloseTrigger = '';
    totalShutInMins = 0;
    totalOnTime = 0;
    totalOffTime = 0;

    // Reset daily production totals
    totalProductionMcf = 0;
    totalLiquidProducedBbl = 0;
    completedCycleCount = 0;
    todayMcf = 0;
    todayBbl = 0;
    yesterdayMcf = null;
    yesterdayBbl = null;
    currentSimDay = 0;
    updateDailySummary();

    // Reset liquid loading - TWO-POOL MODEL
    // At start, plunger is at bottom, so all liquid is "above" it
    liquidInTubing = INITIAL_CONDITIONS.liquidInTubing;
    liquidAbovePlunger = INITIAL_CONDITIONS.liquidInTubing;
    liquidBelowPlunger = 0;
    liquidAccumulationBbl = INITIAL_CONDITIONS.liquidInTubing;
    liquidColumnPsi = INITIAL_CONDITIONS.liquidInTubing * LIQUID_PSI_PER_BBL;

    // Reset stall tracking
    stallTimer = 0;
    isStalled = false;

    // Reset consecutive failures and alarms
    consecutiveFailures = 0;
    ctAlarmActive = false;

    // Clear cycle and arrival history
    cycleHistory.opening = [];
    cycleHistory.closing = [];
    arrivalHistory.length = 0;
    updateArrivalsTable();
    updateCycleTable();
    document.getElementById('cycleStatusIndicator').innerText = 'Ready';
    document.getElementById('lastCommTime').innerText = '--';
    document.getElementById('valRiseTime').innerText = '--';
    document.getElementById('valArrivalVel').innerText = '--';

    chartData.length = 0; // Clear the chart data array
    lastChartPushTime = -1; // Reset chart push timer
    els.log.innerHTML = '<div class="log-info">Reset Complete. Click "Start Simulation" to begin.</div>';

    updateUI();
    drawChart();
    drawWellbore();
    renderStatus();
    showInstructions();  // Show instructions on reset
}
