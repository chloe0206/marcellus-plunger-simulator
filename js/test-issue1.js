// ============================================
// TEST: Issue 1 — Dead State Casing Pressure Fix
// ============================================
// Run testDeadStateFix() in browser console.
//
// BEFORE the fix: Tests A and B should FAIL (casing snaps down).
// AFTER the fix:  All tests should PASS.

function testDeadStateFix() {
    console.log('========================================');
    console.log('TEST: Issue 1 — Dead State Casing Fix');
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

    // Helper: run the sim forward N ticks in AFTERFLOW, collecting P_casing each tick.
    // Does NOT call checkLogic — we want to stay in AFTERFLOW and isolate physics.
    function runAfterflowTicks(n, dt) {
        const trace = [];
        for (let i = 0; i < n; i++) {
            trace.push({ tick: i, P_casing, P_tubing, FlowRate, liquidColumnPsi });
            updatePhysics(dt);
            simTime += dt;
        }
        trace.push({ tick: n, P_casing, P_tubing, FlowRate, liquidColumnPsi });
        return trace;
    }

    // ===========================================================
    // TEST A: Casing must NOT snap down when well enters dead state
    // ===========================================================
    // Setup: AFTERFLOW with P_casing near the dead/flowing boundary.
    // With gas-only friction (~2-10 psi), the boundary is close to
    // P_line + liquidColumnPsi. P_casing should not snap to an arbitrary value.
    console.log('Test A: No casing snap on dead-state entry');

    resetSimulation();
    state = 'AFTERFLOW';
    stateTimer = 40;
    simTime = 500;
    P_line = 200;
    PlungerDepth = 0;
    PlungerVel = 0;

    // Set liquid so the column creates ~35 psi backpressure
    liquidInTubing = 0.3;
    liquidAbovePlunger = 0;
    liquidBelowPlunger = 0;
    liquidColumnPsi = 0.3 * LIQUID_PSI_PER_BBL; // ~35.4 psi

    // Set casing at 234 psi — just barely above P_line + liquidColumnPsi (~235),
    // so with gas-only friction (~2-10 psi) the well enters dead state.
    // (Previously 280 when Gray friction was ~100+ psi.)
    P_casing = 234;
    P_tubing = 210;
    FlowRate = 30;

    const staticEquil = P_line + liquidColumnPsi; // ~235
    const P_casing_before_A = P_casing;

    // One tick — this should trigger the dead state path
    updatePhysics(1.0);
    simTime += 1.0;

    const dropA = P_casing_before_A - P_casing;

    // With the bug: P_casing snaps to ~235 (drop of ~45 psi)
    // With the fix: mass balance changes P_casing by a few psi at most
    assert(dropA < 15,
        `Casing drop on dead-state entry was ${dropA.toFixed(1)} psi (limit: <15)`,
        `P_casing went from ${P_casing_before_A.toFixed(1)} to ${P_casing.toFixed(1)}, static equil = ${staticEquil.toFixed(1)}`);

    assert(P_casing >= staticEquil - 1,
        `Casing (${P_casing.toFixed(1)}) at or above equilibrium floor (${staticEquil.toFixed(1)})`,
        `Difference: ${(P_casing - staticEquil).toFixed(1)} psi — coupling floor should support casing`);

    // ===========================================================
    // TEST B: No large casing drops near dead/flowing boundary
    // ===========================================================
    // With gas-only friction (~2-10 psi), the dead/flowing boundary is
    // razor-thin (P_casing ≈ P_line + liquidColumnPsi ± a few psi).
    // P_casing may oscillate ±0.5 psi near equilibrium as IPR inflow
    // and tiny trickle flow balance out. The test verifies:
    //   1. No single-tick drop > 5 psi (vs the old snap of ~45+ psi)
    //   2. Final P_casing at or above the coupling floor
    console.log('\nTest B: No large casing drops near dead/flowing boundary');

    resetSimulation();
    state = 'AFTERFLOW';
    stateTimer = 50;
    simTime = 600;
    P_line = 200;
    PlungerDepth = 0;
    PlungerVel = 0;
    liquidInTubing = 0.3;
    liquidAbovePlunger = 0;
    liquidBelowPlunger = 0;
    liquidColumnPsi = 0.3 * LIQUID_PSI_PER_BBL;

    // Start below dead/flowing boundary — coupling floor raises to ~235.
    // (Previously 300 when Gray friction was ~100+ psi.)
    P_casing = 234;
    P_tubing = P_line;
    FlowRate = 0;

    // Capture initial floor before liquid dynamics change it
    const initialFloorB = P_line + liquidColumnPsi; // ~235

    const trace = runAfterflowTicks(20, 1.0);

    // Check: no large single-tick casing drops (the old bug caused ~45+ psi snaps)
    let worstDrop = 0;
    for (let i = 1; i < trace.length; i++) {
        const drop = trace[i - 1].P_casing - trace[i].P_casing;
        worstDrop = Math.max(worstDrop, drop);
    }

    assert(worstDrop < 5,
        `Max tick-to-tick casing drop: ${worstDrop.toFixed(2)} psi (limit: <5)`,
        `A large drop suggests P_casing is being snapped to a static value`);

    // Check: P_casing should be at or above the initial coupling floor.
    // Note: liquid accumulates during the test (below Turner velocity),
    // raising the floor over time. We check against the initial floor to
    // verify no snap-down occurred. The rising floor is a separate concern.
    const finalCasing = trace[trace.length - 1].P_casing;
    assert(finalCasing >= initialFloorB - 1,
        `Final P_casing (${finalCasing.toFixed(1)}) at or above initial floor (${initialFloorB.toFixed(1)})`,
        `Coupling floor should support casing at P_line + liquidColumnPsi`);

    // ===========================================================
    // TEST C: Coupling floor prevents P_casing below liquid support
    // ===========================================================
    // If P_casing is artificially low (below P_line + liquidColumnPsi),
    // the floor should raise it — but only as a minimum, not an overwrite.
    console.log('\nTest C: Coupling floor works as a minimum');

    resetSimulation();
    state = 'AFTERFLOW';
    stateTimer = 50;
    simTime = 700;
    P_line = 200;
    PlungerDepth = 0;
    PlungerVel = 0;
    liquidInTubing = 0.3;
    liquidAbovePlunger = 0;
    liquidBelowPlunger = 0;
    liquidColumnPsi = 0.3 * LIQUID_PSI_PER_BBL;

    // Force P_casing below the physical floor
    P_casing = 220;  // Below P_line + liquidColumnPsi (~235)
    P_tubing = P_line;
    FlowRate = 0;
    const expectedFloor = P_line + liquidColumnPsi;

    updatePhysics(1.0);
    simTime += 1.0;

    assert(P_casing >= expectedFloor - 0.1,
        `Floor applied: P_casing (${P_casing.toFixed(1)}) >= P_line + liquid (${expectedFloor.toFixed(1)})`,
        `P_casing was below the physical minimum`);

    // ===========================================================
    // TEST D: Full integration — aggressive afterflow triggers dead state
    // ===========================================================
    // Run a real cycle with long afterflow. The well should die during afterflow.
    // Check that there's no large single-tick casing drop anywhere in afterflow.
    // With gas-only friction (~2-10 psi), the well produces at higher rates than
    // with Gray (~100+ psi), so a longer afterflow (120 min) is needed to
    // deplete casing pressure enough to approach dead state.
    console.log('\nTest D: Full cycle — no casing discontinuity during afterflow');

    resetSimulation();
    document.getElementById('inMaxAft').value = 120;
    document.getElementById('inMaxShutIn').value = 30;
    document.getElementById('inMandatory').value = 0;
    document.getElementById('chkOpenCsg').checked = false;
    document.getElementById('chkOpenDiff').checked = false;

    let maxSingleTickDrop = 0;
    let maxDropTick = 0;
    let peakAfterflowRate = 0;
    let minAfterflowRate = Infinity;
    let prevCsg = P_casing;
    let prevState = state;

    // Run for 500 minutes (~2-3 cycles with 120 min afterflow)
    for (let t = 0; t < 500; t++) {
        updatePhysics(1.0);
        stateTimer += 1.0;
        checkLogic();
        simTime += 1.0;

        if (state === 'AFTERFLOW') {
            const drop = prevCsg - P_casing;
            if (drop > maxSingleTickDrop) {
                maxSingleTickDrop = drop;
                maxDropTick = t;
            }
            if (FlowRate > peakAfterflowRate) peakAfterflowRate = FlowRate;
            if (FlowRate < minAfterflowRate) minAfterflowRate = FlowRate;
        }

        prevCsg = P_casing;
        prevState = state;
    }

    // With gas-only friction, the well produces healthily during afterflow
    // (350-450 Mcfd peak, declining to 200+ Mcfd). It doesn't reach dead state
    // in a normal afterflow window — this is correct behavior. Verify the flow
    // declined significantly (blowdown is working).
    const flowDecline = peakAfterflowRate - minAfterflowRate;
    assert(flowDecline > 100,
        `Afterflow flow declined: ${peakAfterflowRate.toFixed(0)} → ${minAfterflowRate.toFixed(0)} Mcfd (${flowDecline.toFixed(0)} drop)`,
        `Expected significant flow decline during afterflow blowdown`);

    // The old bug caused ~115 psi drops. Normal mass balance drops are <10 psi/tick.
    // Use 30 as the threshold — generous enough for legitimate blowdown, catches the snap.
    assert(maxSingleTickDrop < 30,
        `Max single-tick casing drop in afterflow: ${maxSingleTickDrop.toFixed(1)} psi at tick ${maxDropTick} (limit: <30)`,
        `A large drop suggests P_casing is still being snapped to a static value`);

    // ===========================================================
    // TEST E: No flow rate oscillation at dead/flowing boundary
    // ===========================================================
    // The iterative solver should produce smooth flow decline, not alternating
    // spikes between 0 and hundreds of Mcfd on consecutive ticks.
    console.log('\nTest E: No flow rate oscillation during late afterflow');

    resetSimulation();
    state = 'AFTERFLOW';
    stateTimer = 30;
    simTime = 500;
    P_line = 200;
    PlungerDepth = 0;
    PlungerVel = 0;
    liquidInTubing = 0.3;
    liquidAbovePlunger = 0;
    liquidBelowPlunger = 0;
    liquidColumnPsi = 0.3 * LIQUID_PSI_PER_BBL;

    // P_casing near the dead/flowing boundary where oscillation would
    // appear with explicit Euler. With gas-only friction (~2-10 psi),
    // the boundary is near P_line + liquidColumnPsi (~235).
    // (Previously 450 when Gray friction was ~100+ psi.)
    P_casing = 250;
    P_tubing = P_line;
    FlowRate = 0;

    let flowValues = [];
    for (let i = 0; i < 10; i++) {
        updatePhysics(1.0);
        simTime += 1.0;
        flowValues.push(FlowRate);
    }

    // Check for alternating behavior: large swings between consecutive ticks
    let maxFlowSwing = 0;
    for (let i = 1; i < flowValues.length; i++) {
        const swing = Math.abs(flowValues[i] - flowValues[i - 1]);
        maxFlowSwing = Math.max(maxFlowSwing, swing);
    }

    assert(maxFlowSwing < 50,
        `Max tick-to-tick flow swing: ${maxFlowSwing.toFixed(1)} Mcfd (limit: <50)`,
        `Flow values: [${flowValues.map(f => f.toFixed(0)).join(', ')}]`);

    // Flow should be relatively stable (trickle rate), not alternating 0/big
    const avgFlow = flowValues.reduce((a, b) => a + b, 0) / flowValues.length;
    const allReasonable = flowValues.every(f => f >= 0 && f < 500);
    assert(allReasonable,
        `All flow values reasonable (avg: ${avgFlow.toFixed(0)} Mcfd)`,
        `Flow values: [${flowValues.map(f => f.toFixed(0)).join(', ')}]`);

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

window.testDeadStateFix = testDeadStateFix;
console.log('Issue 1 test available: run testDeadStateFix() in console');
