// ============================================
// TEST: Issues 2 & 3 — Arrival Spike & Late-Lifting P_tubing
// ============================================
// Run testArrivalFix() in browser console.
//
// Tests verify:
// A: P_tubing declines during lifting (gas above slug depletes, diverges from P_casing)
// B: P_tubing well below P_casing in late lifting (not tracking via boundary cap)
// C: Arrival P_tubing uses physics formula (not P_casing * 0.95)
// D: P_tubing upkick at arrival + meaningful afterflow flow
// E: No oscillation in P_tubing during late lifting
// F: Gas above plunger depletes significantly by arrival

function testArrivalFix() {
    console.log('========================================');
    console.log('TEST: Issues 2 & 3 — Arrival Spike Fix');
    console.log('========================================\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, name, detail) {
        if (condition) {
            console.log(`  PASS: ${name}`);
            passed++;
        } else {
            console.error(`  FAIL: ${name}`);
            if (detail) console.error(`        ${detail}`);
            failed++;
        }
    }

    // Helper: Run a full cycle from ARMED_SHUTIN through LIFTING to AFTERFLOW.
    // Collects per-tick data during LIFTING and captures the arrival transition.
    // Returns { liftTrace, arrivalSnap, afterflowTrace }.
    function runFullCycle() {
        resetSimulation();

        // Configure for a clean, fast cycle
        document.getElementById('inMaxShutIn').value = 60;    // Max shut-in
        document.getElementById('inMandatory').value = 0;     // No mandatory penalty
        document.getElementById('inPlgDrop').value = 0;       // Instant plunger drop
        document.getElementById('inMaxWait').value = 60;      // Max wait for arrival
        document.getElementById('inMaxAft').value = 30;       // Afterflow time
        document.getElementById('inMinAft').value = 2;        // Min afterflow
        document.getElementById('chkOpenCsg').checked = true;
        document.getElementById('inOpenCsgVal').value = 500;  // Open at 500 psi casing
        document.getElementById('chkOpenDiff').checked = false;
        document.getElementById('chkOpenLoad').checked = false;
        document.getElementById('chkCloseFlow').checked = false;
        document.getElementById('chkCloseDP').checked = false;

        const dt = 1.0;

        // Phase 1: Build casing pressure in shut-in until trigger fires
        let maxShutinTicks = 200;
        for (let t = 0; t < maxShutinTicks; t++) {
            updatePhysics(dt);
            stateTimer += dt;
            checkLogic();
            simTime += dt;
            if (state === 'LIFTING') break;
        }

        if (state !== 'LIFTING') {
            console.error('  ERROR: Never reached LIFTING state');
            return null;
        }

        // Phase 2: Run through LIFTING, collecting data each tick
        const liftTrace = [];
        let prevPtubing = P_tubing;
        let maxLiftTicks = 200;

        // Capture the state just before the arrival transition
        let lastLiftingLiquidAbove = liquidAbovePlunger;
        let lastLiftingPcasing = P_casing;
        let lastLiftingPtubing = P_tubing;
        let lastLiftingFlowRate = FlowRate;

        for (let t = 0; t < maxLiftTicks; t++) {
            liftTrace.push({
                tick: t,
                P_tubing,
                P_casing,
                FlowRate,
                PlungerDepth,
                gasAbovePlunger_scf,
                liquidAbovePlunger
            });

            // Save pre-transition values (before checkLogic might fire changeState)
            lastLiftingLiquidAbove = liquidAbovePlunger;
            lastLiftingPcasing = P_casing;
            lastLiftingPtubing = P_tubing;
            lastLiftingFlowRate = FlowRate;

            updatePhysics(dt);
            stateTimer += dt;
            checkLogic();
            simTime += dt;

            if (state !== 'LIFTING') break;
            prevPtubing = P_tubing;
        }

        // Capture arrival snapshot
        // At this point, changeState('AFTERFLOW') has already fired.
        // P_tubing was set by changeState using post-physics P_casing and
        // pre-zeroed liquidAbovePlunger. changeState does NOT modify P_casing
        // or FlowRate, so the globals reflect the final LIFTING physics tick.
        const arrivalSnap = {
            P_tubing_afterArrival: P_tubing,           // Set by changeState arrival formula
            P_casing_atArrival: P_casing,              // Post-physics (what changeState used)
            liquidAbove_atArrival: lastLiftingLiquidAbove, // Before changeState zeroed it
            expectedPtubing: P_casing - (lastLiftingLiquidAbove * LIQUID_PSI_PER_BBL),
            FlowRate_atArrival: FlowRate,              // From final LIFTING physics tick
            lastLiftPtubing: lastLiftingPtubing,       // P_tubing before final physics tick
            gasRemaining_scf: gasAbovePlunger_scf      // Post-physics global (not from trace)
        };

        // Phase 3: Run a few ticks of AFTERFLOW to capture the flow spike
        const afterflowTrace = [];
        for (let t = 0; t < 10; t++) {
            afterflowTrace.push({
                tick: t,
                P_tubing,
                P_casing,
                FlowRate
            });
            updatePhysics(dt);
            stateTimer += dt;
            simTime += dt;
        }

        return { liftTrace, arrivalSnap, afterflowTrace };
    }

    // ===========================================================
    // Run the cycle once — all tests use the same data
    // ===========================================================
    const result = runFullCycle();
    if (!result) {
        console.error('ABORTED: Could not complete a full cycle.');
        resetSimulation();
        return { passed, failed: failed + 6 };
    }

    const { liftTrace, arrivalSnap, afterflowTrace } = result;
    console.log(`  Cycle completed: ${liftTrace.length} lifting ticks, arrival at PlungerDepth=${liftTrace[liftTrace.length - 1].PlungerDepth.toFixed(0)} ft\n`);

    // ===========================================================
    // TEST A: P_tubing declines during lifting (doesn't track P_casing)
    // ===========================================================
    // The gas above the slug depletes as it vents through the choke.
    // P_tubing should decline from its initial value toward P_line.
    // With the old bug, P_tubing tracked P_casing the entire lift (boundary cap).
    console.log('Test A: P_tubing declines during lifting');

    const firstPt = liftTrace[0].P_tubing;
    // Look at the last quarter of the lift
    const lateStart = Math.floor(liftTrace.length * 0.75);
    const latePt = liftTrace[lateStart].P_tubing;

    assert(firstPt > latePt + 20,
        `P_tubing declined: ${firstPt.toFixed(0)} → ${latePt.toFixed(0)} psi (diff: ${(firstPt - latePt).toFixed(0)})`,
        `Expected P_tubing to decline by >20 psi during lift. First: ${firstPt.toFixed(1)}, Late: ${latePt.toFixed(1)}`);

    // Check that P_tubing diverges from P_casing during lifting
    const firstDiff = liftTrace[0].P_casing - liftTrace[0].P_tubing;
    const lateDiff = liftTrace[lateStart].P_casing - liftTrace[lateStart].P_tubing;

    assert(lateDiff > firstDiff + 30,
        `Csg-Tbg gap widened: ${firstDiff.toFixed(0)} → ${lateDiff.toFixed(0)} psi`,
        `With old boundary cap, gap would stay ~0. Need gap to widen by >30 psi.`);

    // ===========================================================
    // TEST B: P_tubing well below P_casing in late lifting
    // ===========================================================
    // With the old boundary cap, P_tubing tracked P_casing the entire lift (gap ~0).
    // With the fix, gas above depletes through the choke, so P_tubing diverges
    // downward from P_casing. By the last quarter of the lift, there should be
    // a significant gap. (P_tubing doesn't reach P_line until the very last tick
    // when V_gas_above → 0, because the plunger moves fast enough that gas
    // compression in the shrinking volume maintains moderate pressure.)
    console.log('\nTest B: P_tubing well below P_casing in late lifting');

    const veryLateStart = Math.floor(liftTrace.length * 0.75);
    const veryLatePts = liftTrace.slice(veryLateStart);
    const avgLatePt = veryLatePts.reduce((s, d) => s + d.P_tubing, 0) / veryLatePts.length;
    const avgLatePcsg = veryLatePts.reduce((s, d) => s + d.P_casing, 0) / veryLatePts.length;
    const lateCsgTbgGap = avgLatePcsg - avgLatePt;

    assert(lateCsgTbgGap > 50,
        `Late-lifting Csg-Tbg gap: ${lateCsgTbgGap.toFixed(0)} psi (avg P_csg=${avgLatePcsg.toFixed(0)}, avg P_tbg=${avgLatePt.toFixed(0)})`,
        `With old boundary cap, gap would be ~0. Gas depletion should create a gap >50 psi.`);

    // ===========================================================
    // TEST C: Arrival P_tubing uses physics formula
    // ===========================================================
    // P_tubing at arrival should = P_casing - (liquidAbovePlunger * LIQUID_PSI_PER_BBL)
    // NOT P_casing * 0.95
    console.log('\nTest C: Arrival pressure uses physics formula');

    const arrivalError = Math.abs(arrivalSnap.P_tubing_afterArrival - arrivalSnap.expectedPtubing);
    const oldFormula = arrivalSnap.P_casing_atArrival * 0.95;
    const oldError = Math.abs(arrivalSnap.P_tubing_afterArrival - oldFormula);

    assert(arrivalError < 5,
        `Arrival P_tubing=${arrivalSnap.P_tubing_afterArrival.toFixed(1)}, expected=${arrivalSnap.expectedPtubing.toFixed(1)} (error: ${arrivalError.toFixed(1)} psi)`,
        `Formula: P_casing(${arrivalSnap.P_casing_atArrival.toFixed(1)}) - slug(${arrivalSnap.liquidAbove_atArrival.toFixed(3)} bbl × ${LIQUID_PSI_PER_BBL})=${arrivalSnap.expectedPtubing.toFixed(1)}`);

    // Also verify it's NOT using the old 0.95 formula (unless they happen to give similar results)
    // This is informational — if the values happen to coincide, the physics formula is still correct.
    if (Math.abs(oldFormula - arrivalSnap.expectedPtubing) > 10) {
        assert(oldError > arrivalError,
            `New formula is closer than old 0.95 formula (old would give ${oldFormula.toFixed(1)}, error=${oldError.toFixed(1)})`,
            `Old: P_csg*0.95=${oldFormula.toFixed(1)}, New: P_csg-slug=${arrivalSnap.expectedPtubing.toFixed(1)}`);
    } else {
        console.log(`  INFO: Old and new formulas give similar results here (old=${oldFormula.toFixed(1)}, new=${arrivalSnap.expectedPtubing.toFixed(1)}). Formula correctness verified above.`);
        passed++; // Count the informational check as passed
    }

    // ===========================================================
    // TEST D: P_tubing upkick at arrival and meaningful afterflow
    // ===========================================================
    // The key arrival signature: P_tubing was declining during lifting (gas depleting),
    // then JUMPS UP at arrival as casing gas reaches the PT through the slug.
    // This is the "upkick" the engineer expects to see consistently.
    // Afterflow should produce meaningful flow (casing gas driving through choke).
    console.log('\nTest D: Arrival upkick and afterflow flow');

    // P_tubing should jump UP at arrival
    const upkick = arrivalSnap.P_tubing_afterArrival - arrivalSnap.lastLiftPtubing;
    assert(upkick > 20,
        `Arrival upkick: +${upkick.toFixed(0)} psi (${arrivalSnap.lastLiftPtubing.toFixed(0)} → ${arrivalSnap.P_tubing_afterArrival.toFixed(0)})`,
        `P_tubing should rise at arrival as casing gas reaches the PT through the slug.`);

    // Afterflow should produce meaningful flow
    // afterflowTrace[0] carries over the last LIFTING flow; [1]+ are actual afterflow physics
    const afterflowFlow = afterflowTrace.length > 1 ? afterflowTrace[1].FlowRate : afterflowTrace[0].FlowRate;
    assert(afterflowFlow > 100,
        `Afterflow flow: ${afterflowFlow.toFixed(0)} Mcfd (limit: >100)`,
        `Casing gas at ${arrivalSnap.P_casing_atArrival.toFixed(0)} psi should drive meaningful flow.`);

    // ===========================================================
    // TEST E: No oscillation in P_tubing during late lifting
    // ===========================================================
    // P_tubing should decline smoothly, not oscillate wildly.
    // Check max tick-to-tick swing in the last half of lifting.
    console.log('\nTest E: No P_tubing oscillation during late lifting');

    const midpoint = Math.floor(liftTrace.length / 2);
    const lateHalf = liftTrace.slice(midpoint);
    let maxPtSwing = 0;
    for (let i = 1; i < lateHalf.length; i++) {
        const swing = Math.abs(lateHalf[i].P_tubing - lateHalf[i - 1].P_tubing);
        maxPtSwing = Math.max(maxPtSwing, swing);
    }

    assert(maxPtSwing < 50,
        `Max P_tubing swing in late lifting: ${maxPtSwing.toFixed(1)} psi (limit: <50)`,
        `P_tubing values should decline smoothly without ping-ponging.`);

    // Also check flow rate doesn't oscillate
    let maxFlowSwing = 0;
    for (let i = 1; i < lateHalf.length; i++) {
        const swing = Math.abs(lateHalf[i].FlowRate - lateHalf[i - 1].FlowRate);
        maxFlowSwing = Math.max(maxFlowSwing, swing);
    }

    assert(maxFlowSwing < 100,
        `Max FlowRate swing in late lifting: ${maxFlowSwing.toFixed(1)} Mcfd (limit: <100)`,
        `Flow rate should decline smoothly during late lifting.`);

    // ===========================================================
    // TEST F: Gas above plunger depletes significantly by arrival
    // ===========================================================
    // The gas above the slug should be mostly gone by arrival.
    // Note: It won't be exactly zero because the plunger overshoots the
    // surface in a single tick — the last gas calculation uses PlungerDepth > 0,
    // then the plunger moves past zero. The V≤0 path would fire on the next
    // tick, but checkLogic transitions to AFTERFLOW first.
    console.log('\nTest F: Gas above plunger depleted by arrival');

    const gasAtEnd = arrivalSnap.gasRemaining_scf;
    const gasAtStart = liftTrace[0].gasAbovePlunger_scf;

    assert(gasAtEnd < gasAtStart * 0.10,
        `Gas depleted: ${gasAtStart.toFixed(0)} → ${gasAtEnd.toFixed(1)} scf (${((gasAtEnd/gasAtStart)*100).toFixed(1)}% remaining)`,
        `Expected <10% of initial gas remaining at arrival.`);

    assert(gasAtEnd < 500,
        `Gas at arrival: ${gasAtEnd.toFixed(1)} scf (limit: <500 scf, started at ${gasAtStart.toFixed(0)})`,
        `Most gas should have vented through the choke during the lift.`);

    // ===========================================================
    // CLEANUP
    // ===========================================================
    resetSimulation();

    console.log('\n========================================');
    console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    if (failed === 0) {
        console.log('All tests passed.');
    } else {
        console.log('Some tests FAILED — see errors above.');
    }
    console.log('========================================');

    return { passed, failed };
}

window.testArrivalFix = testArrivalFix;
console.log('Issue 2/3 test available: run testArrivalFix() in console');
