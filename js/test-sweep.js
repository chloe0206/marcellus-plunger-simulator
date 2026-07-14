// ============================================
// TEST SWEEP: Automated parameter optimization
// ============================================

// Run a single test scenario for specified duration (in sim minutes)
async function runTestScenario(shutInTime, afterflowTime, durationMins) {
    return new Promise((resolve) => {
        // Reset to clean state
        resetSimulation();

        // Configure controller for timer-based operation
        document.getElementById('chkOpenCsg').checked = false;   // Disable pressure trigger
        document.getElementById('chkOpenDiff').checked = false;  // Disable differential trigger
        document.getElementById('chkCloseFlow').checked = false; // Disable flow close trigger
        document.getElementById('chkCloseDP').checked = false;   // Disable differential close trigger
        // Disable new close triggers
        document.getElementById('chkCloseOnTime').checked = false;
        document.getElementById('chkCloseCasing').checked = false;
        document.getElementById('chkCloseTubing').checked = false;
        document.getElementById('chkCloseCsgTbg').checked = false;
        document.getElementById('chkCloseCsgLine').checked = false;
        // Disable new open triggers
        document.getElementById('chkOpenOffTime').checked = false;
        document.getElementById('chkOpenArmedTime').checked = false;
        document.getElementById('chkOpenTubing').checked = false;
        document.getElementById('chkOpenTbgLine').checked = false;
        document.getElementById('inMaxShutIn').value = shutInTime;
        document.getElementById('inMaxAft').value = afterflowTime;
        document.getElementById('inPlgDrop').value = 5;          // Fast plunger drop for testing
        document.getElementById('inDeviationAngle').value = 0;   // Vertical well for fastest fall
        document.getElementById('inMandatory').value = 0;        // No mandatory penalty for testing

        // Tracking variables
        let testStartMcf = totalProductionMcf;
        let testStartCycles = completedCycleCount;  // Global counter, not capped
        let testNonArrivals = 0;

        // Run simulation at max speed without UI updates
        const testInterval = setInterval(() => {
            // Run physics updates in batch (fast forward)
            // Use smaller batches (10 steps) for accurate state transitions
            for (let i = 0; i < 10; i++) {
                const dt = 1.0; // 1 minute per step
                updatePhysics(dt);
                stateTimer += dt;
                const stateBefore = state;
                checkLogic();
                // Detect non-arrivals: transition into MANDATORY_SHUTIN
                if (state === 'MANDATORY_SHUTIN' && stateBefore !== 'MANDATORY_SHUTIN') {
                    testNonArrivals++;
                }
                simTime += dt;
            }

            // Check if we've reached target duration
            if (simTime >= durationMins) {
                clearInterval(testInterval);

                // Calculate results
                const mcfProduced = totalProductionMcf - testStartMcf;
                const cyclesCompleted = completedCycleCount - testStartCycles;
                const finalLiquid = liquidAccumulationBbl;

                resolve({
                    shutIn: shutInTime,
                    afterflow: afterflowTime,
                    mcfProduced: mcfProduced,
                    cycles: cyclesCompleted,
                    failures: testNonArrivals,
                    finalLiquid: finalLiquid,
                    mcfPerDay: (mcfProduced / durationMins) * 1440
                });
            }
        }, 10); // Small delay to prevent browser freeze
    });
}

// Classify result into zone
function classifyZone(result, maxProduction) {
    const prodRatio = result.mcfPerDay / maxProduction;

    // RECKLESS: Well is dying - failures or severe liquid loading
    if (result.failures >= 2 || result.finalLiquid > 2.0) {
        return 'RECK';
    }
    // AGGRESSIVE: Pushing limits - some stress signs
    else if (result.failures >= 1 || result.finalLiquid > 1.5 || prodRatio < 0.75) {
        return 'AGGR';
    }
    // OPTIMAL: Sweet spot - high production, healthy operation
    else if (prodRatio >= 0.92 && result.finalLiquid < 1.2) {
        return 'OPT';
    }
    // CONSERVATIVE: Safe but leaving production on table
    else {
        return 'CONS';
    }
}

// Main test sweep function
async function runTestSweep() {
    console.log('========================================');
    console.log('STARTING TEST SWEEP');
    console.log('========================================');

    // Save original settings
    const originalChkOpenCsg = document.getElementById('chkOpenCsg').checked;
    const originalChkOpenDiff = document.getElementById('chkOpenDiff').checked;
    const originalMaxShutIn = document.getElementById('inMaxShutIn').value;
    const originalMaxAft = document.getElementById('inMaxAft').value;
    const originalPlgDrop = document.getElementById('inPlgDrop').value;
    const originalMandatory = document.getElementById('inMandatory').value;
    const originalChkCloseFlow = document.getElementById('chkCloseFlow').checked;
    const originalChkCloseDP = document.getElementById('chkCloseDP').checked;
    const originalChkCloseOnTime = document.getElementById('chkCloseOnTime').checked;
    const originalChkCloseCasing = document.getElementById('chkCloseCasing').checked;
    const originalChkCloseTubing = document.getElementById('chkCloseTubing').checked;
    const originalChkCloseCsgTbg = document.getElementById('chkCloseCsgTbg').checked;
    const originalChkCloseCsgLine = document.getElementById('chkCloseCsgLine').checked;
    const originalChkOpenOffTime = document.getElementById('chkOpenOffTime').checked;
    const originalChkOpenArmedTime = document.getElementById('chkOpenArmedTime').checked;
    const originalChkOpenTubing = document.getElementById('chkOpenTubing').checked;
    const originalChkOpenTbgLine = document.getElementById('chkOpenTbgLine').checked;
    const originalDeviationAngle = document.getElementById('inDeviationAngle').value;

    // Test parameters
    const shutInValues = [15, 25, 35, 45, 60];      // minutes
    const afterflowValues = [20, 30, 40, 50, 60];   // minutes
    const testDuration = 1440; // 24 hours in sim minutes

    const results = [];
    const totalTests = shutInValues.length * afterflowValues.length;
    let testNum = 0;

    // Run all combinations
    for (const shutIn of shutInValues) {
        for (const afterflow of afterflowValues) {
            testNum++;
            console.log(`Test ${testNum}/${totalTests}: ShutIn=${shutIn}min, Afterflow=${afterflow}min`);

            const result = await runTestScenario(shutIn, afterflow, testDuration);
            results.push(result);

            console.log(`  -> ${result.mcfPerDay.toFixed(0)} Mcf/day, ${result.cycles} cycles, ${result.failures} failures, ${result.finalLiquid.toFixed(2)} bbl liquid`);
        }
    }

    // Find max production for classification
    const maxProduction = Math.max(...results.map(r => r.mcfPerDay));

    // Classify all results
    results.forEach(r => {
        r.zone = classifyZone(r, maxProduction);
    });

    // Build output matrix
    console.log('\n========================================');
    console.log('TEST SWEEP RESULTS');
    console.log('========================================\n');

    // Header
    let header = 'ShutIn\\Aft |';
    afterflowValues.forEach(af => header += ` ${af.toString().padStart(4)} |`);
    console.log(header);
    console.log('-'.repeat(header.length));

    // Data rows
    for (const shutIn of shutInValues) {
        let row = `    ${shutIn.toString().padStart(2)} min |`;
        for (const afterflow of afterflowValues) {
            const r = results.find(x => x.shutIn === shutIn && x.afterflow === afterflow);
            row += ` ${r.zone.padStart(4)} |`;
        }
        console.log(row);
    }

    console.log('\nLegend: CONS=Conservative, OPT=Optimal, AGGR=Aggressive, RECK=Reckless');
    console.log(`Max Production: ${maxProduction.toFixed(0)} Mcf/day\n`);

    // Detailed results table
    console.log('DETAILED RESULTS:');
    console.log('ShutIn | Afterflow | Mcf/Day | Cycles | Fails | Liquid | Zone');
    console.log('-'.repeat(65));
    results.forEach(r => {
        console.log(`  ${r.shutIn.toString().padStart(3)}  |    ${r.afterflow.toString().padStart(3)}    |  ${r.mcfPerDay.toFixed(0).padStart(5)}  |   ${r.cycles.toString().padStart(3)}  |   ${r.failures.toString().padStart(2)}  |  ${r.finalLiquid.toFixed(2).padStart(5)} | ${r.zone}`);
    });

    // Restore original settings
    document.getElementById('chkOpenCsg').checked = originalChkOpenCsg;
    document.getElementById('chkOpenDiff').checked = originalChkOpenDiff;
    document.getElementById('inMaxShutIn').value = originalMaxShutIn;
    document.getElementById('inMaxAft').value = originalMaxAft;
    document.getElementById('inPlgDrop').value = originalPlgDrop;
    document.getElementById('inMandatory').value = originalMandatory;
    document.getElementById('chkCloseFlow').checked = originalChkCloseFlow;
    document.getElementById('chkCloseDP').checked = originalChkCloseDP;
    document.getElementById('chkCloseOnTime').checked = originalChkCloseOnTime;
    document.getElementById('chkCloseCasing').checked = originalChkCloseCasing;
    document.getElementById('chkCloseTubing').checked = originalChkCloseTubing;
    document.getElementById('chkCloseCsgTbg').checked = originalChkCloseCsgTbg;
    document.getElementById('chkCloseCsgLine').checked = originalChkCloseCsgLine;
    document.getElementById('chkOpenOffTime').checked = originalChkOpenOffTime;
    document.getElementById('chkOpenArmedTime').checked = originalChkOpenArmedTime;
    document.getElementById('chkOpenTubing').checked = originalChkOpenTubing;
    document.getElementById('chkOpenTbgLine').checked = originalChkOpenTbgLine;
    document.getElementById('inDeviationAngle').value = originalDeviationAngle;

    // Reset simulation to clean state
    resetSimulation();

    console.log('\n========================================');
    console.log('TEST SWEEP COMPLETE');
    console.log('Original settings restored.');
    console.log('========================================');

    return results;
}

// Make it callable from console
window.runTestSweep = runTestSweep;
console.log('Test sweep available: run runTestSweep() in console');
