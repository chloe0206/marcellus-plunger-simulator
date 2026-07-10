// ============================================
// TEST: RL800 Trigger Verification
// Run testTriggers() in browser console
// ============================================

function testTriggers() {
    console.log('=== RL800 TRIGGER TEST SUITE ===\n');

    // Save all settings we'll modify
    const saved = {};
    const idsToSave = [
        'chkOpenCsg', 'inOpenCsgVal', 'chkOpenDiff', 'chkOpenLoad',
        'chkCloseFlow', 'chkCloseDP',
        'inMaxShutIn', 'inMaxAft', 'inMinAft', 'inCloseDly',
        'inPlgDrop', 'inMandatory', 'inMaxWait',
        'chkCloseOnTime', 'inCloseOnTimeVal',
        'chkCloseCasing', 'inCloseCasingVal',
        'chkCloseTubing', 'inCloseTubingVal',
        'chkCloseCsgTbg', 'inCloseCsgTbgVal',
        'chkCloseCsgLine', 'inCloseCsgLineVal',
        'chkOpenOffTime', 'inOpenOffTimeVal',
        'chkOpenArmedTime', 'inOpenArmedTimeVal',
        'chkOpenTubing', 'inOpenTubingVal',
        'chkOpenTbgLine', 'inOpenTbgLineVal'
    ];
    idsToSave.forEach(id => {
        const el = document.getElementById(id);
        saved[id] = (el.type === 'checkbox') ? el.checked : el.value;
    });

    function disableAllTriggers() {
        ['chkOpenCsg', 'chkOpenDiff', 'chkOpenLoad',
         'chkCloseFlow', 'chkCloseDP',
         'chkCloseOnTime', 'chkCloseCasing', 'chkCloseTubing',
         'chkCloseCsgTbg', 'chkCloseCsgLine',
         'chkOpenOffTime', 'chkOpenArmedTime',
         'chkOpenTubing', 'chkOpenTbgLine'
        ].forEach(id => document.getElementById(id).checked = false);
    }

    // Run sim for up to maxMin minutes, return minutes when predicate() first returns true, or -1
    function runUntil(predicate, maxMin) {
        for (let i = 0; i < maxMin; i++) {
            if (predicate()) return i;
            const dt = 1.0;
            simTime += dt;
            stateTimer += dt;
            updatePhysics(dt);
            checkLogic();
        }
        return predicate() ? maxMin : -1;
    }

    const results = [];

    // ===== OPEN TRIGGER TESTS =====
    // Each: reset → ARMED_SHUTIN → enable one trigger → verify it opens well

    function testOpen(name, chkId, inputId, value, expectedReason) {
        resetSimulation();  // state = ARMED_SHUTIN, P_casing = 450
        disableAllTriggers();
        document.getElementById('inMaxShutIn').value = 9999;  // Prevent max shutin from interfering
        document.getElementById(chkId).checked = true;
        document.getElementById(inputId).value = value;

        const mins = runUntil(() => state === 'LIFTING', 300);
        const trigger = lastOpenTrigger;
        const pass = mins >= 0 && trigger.includes(expectedReason);
        results.push({
            name: 'OPEN: ' + name,
            pass: pass,
            detail: mins >= 0
                ? 'Fired at ' + mins + ' min: "' + trigger + '"'
                : 'TIMEOUT — never opened (state=' + state + ')'
        });
    }

    // Off Time >= 25: totalOffTime accumulates during all shut-in states
    testOpen('Off Time >= 25 min', 'chkOpenOffTime', 'inOpenOffTimeVal', 25, 'Off Time');

    // Armed Time >= 25: stateTimer in ARMED_SHUTIN
    testOpen('Armed Time >= 25 min', 'chkOpenArmedTime', 'inOpenArmedTimeVal', 25, 'Armed Time');

    // Tubing >= 410: P_tubing ≈ P_casing - liquidColumnPsi ≈ 415 after first tick, rises with casing
    testOpen('Tubing >= 410 psi', 'chkOpenTubing', 'inOpenTubingVal', 410, 'Tubing Pressure');

    // Tbg - Line >= 200: (P_tubing - P_line) ≈ 415 - 200 = 215, fires quickly
    testOpen('Tbg - Line >= 200 psi', 'chkOpenTbgLine', 'inOpenTbgLineVal', 200, 'Tbg-Line');


    // ===== CLOSE TRIGGER TESTS =====
    // Each: reset → open well with Casing > 460 → wait for AFTERFLOW → verify close trigger fires

    function testClose(name, chkId, inputId, value, expectedReason) {
        resetSimulation();
        disableAllTriggers();

        // Open well naturally via Casing > 460
        document.getElementById('chkOpenCsg').checked = true;
        document.getElementById('inOpenCsgVal').value = 460;
        document.getElementById('inMaxShutIn').value = 9999;
        document.getElementById('inMaxWait').value = 120;

        // Afterflow settings: no delays, no max afterflow interference
        document.getElementById('inMaxAft').value = 9999;
        document.getElementById('inMinAft').value = 0;
        document.getElementById('inCloseDly').value = 0;
        document.getElementById('inPlgDrop').value = 0;
        document.getElementById('inMandatory').value = 0;

        // Enable the close trigger under test
        document.getElementById(chkId).checked = true;
        document.getElementById(inputId).value = value;

        // Phase 1: Get to AFTERFLOW (open → lift → arrive)
        const aftMins = runUntil(() => state === 'AFTERFLOW', 500);
        if (aftMins < 0) {
            results.push({
                name: 'CLOSE: ' + name,
                pass: false,
                detail: 'Never reached AFTERFLOW (state=' + state + ')'
            });
            return;
        }

        // Phase 2: Run afterflow until close trigger fires
        const closeMins = runUntil(() => state === 'UNARMED_SHUTIN', 500);
        const trigger = cycleHistory.closing.length > 0 ? cycleHistory.closing[0].event : '';
        const pass = closeMins >= 0 && trigger.includes(expectedReason);
        results.push({
            name: 'CLOSE: ' + name,
            pass: pass,
            detail: closeMins >= 0
                ? 'Fired at aft+' + closeMins + ' min: "' + trigger + '"'
                : 'TIMEOUT — never closed (state=' + state + ', flow=' + FlowRate.toFixed(0) + ')'
        });
    }

    // ON Time >= 20 min: totalOnTime accumulates during LIFTING + AFTERFLOW
    testClose('ON Time >= 20 min', 'chkCloseOnTime', 'inCloseOnTimeVal', 20, 'ON Time');

    // Casing <= 400 psi: casing drops during afterflow
    testClose('Casing <= 400 psi', 'chkCloseCasing', 'inCloseCasingVal', 400, 'Low Casing');

    // Tubing <= 250 psi: tubing drops fast during afterflow after arrival spike
    testClose('Tubing <= 250 psi', 'chkCloseTubing', 'inCloseTubingVal', 250, 'Low Tubing');

    // Csg - Tbg >= 50 psi: differential grows as tubing drops faster than casing
    testClose('Csg - Tbg >= 50 psi', 'chkCloseCsgTbg', 'inCloseCsgTbgVal', 50, 'Csg-Tbg');

    // Csg - Line <= 250 psi: (P_casing - P_line) shrinks as casing drops
    testClose('Csg - Line <= 250 psi', 'chkCloseCsgLine', 'inCloseCsgLineVal', 250, 'Csg-Line');


    // ===== PRINT RESULTS =====
    console.log('\n--- RESULTS ---');
    let passed = 0, failed = 0;
    results.forEach(function(r) {
        const mark = r.pass ? 'PASS' : 'FAIL';
        if (r.pass) passed++; else failed++;
        console.log('  ' + mark + ': ' + r.name + ' — ' + r.detail);
    });
    console.log('\n' + passed + '/' + results.length + ' passed, ' + failed + ' failed');

    // Restore all settings
    idsToSave.forEach(id => {
        const el = document.getElementById(id);
        if (el.type === 'checkbox') el.checked = saved[id];
        else el.value = saved[id];
    });
    resetSimulation();

    console.log('Original settings restored.\n=== TEST COMPLETE ===');
    return { passed: passed, failed: failed, total: results.length, results: results };
}

window.testTriggers = testTriggers;
console.log('Trigger test available: run testTriggers() in console');
