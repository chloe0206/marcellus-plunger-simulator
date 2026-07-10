// --- INSTRUCTIONS MODAL ---
function showInstructions() {
    document.getElementById('instructionsModal').classList.remove('hidden');
}

function closeInstructions() {
    document.getElementById('instructionsModal').classList.add('hidden');
}

// --- HELP POPOVER SYSTEM ---
const HELP_DEFINITIONS = {
    // Current Values
    flowRate: {
        title: "Flow Rate",
        content: "Gas production rate in thousand cubic feet per day (Mcfd). During afterflow, this should start high and decline. When it drops below the critical rate, liquid begins falling back into the tubing."
    },
    tubingPressure: {
        title: "Tubing Pressure",
        content: "Pressure at the surface in the tubing string. During shut-in, this equals casing minus the liquid column. During flow, it's higher due to the velocity pressure from gas movement."
    },
    casingPressure: {
        title: "Casing Pressure",
        content: "Pressure in the annulus between casing and tubing. Builds during shut-in as the reservoir delivers gas. This stored energy lifts the plunger when the well opens."
    },
    linePressure: {
        title: "Line Pressure",
        content: "Sales line or gathering system pressure. The well must overcome this backpressure to flow. Lower line pressure means easier flow but may require choking to avoid too-fast plunger arrivals."
    },
    plungerDepth: {
        title: "Plunger Depth",
        content: "Current position of the plunger. 0 ft = at surface (arrived). 7000 ft = at bottom. During lifting, watch this decrease as the plunger rises."
    },
    velocity: {
        title: "Plunger Velocity",
        content: "Speed of the plunger during lift in feet per minute. Target: 500-1000 ft/min. Below 200 ft/min risks stalling. Above 1000 ft/min risks equipment damage from hard arrivals."
    },
    elapsedLift: {
        title: "Elapsed Lift Time",
        content: "Time since the well opened and lift began. If this exceeds Max Wait time without an arrival, the controller declares a non-arrival and closes the well."
    },

    // Key Metrics
    loadFactor: {
        title: "Load Factor",
        content: "Measures how hard the plunger is working. Calculated as (Casing - Tubing) / (Casing - Line) × 100. Target: 40-50%. Below 40% = excess energy. Above 65% = struggling, may stall."
    },
    casingMinusTubing: {
        title: "Casing - Tubing Differential",
        content: "Pressure difference between casing and tubing. During shut-in, this equals the liquid column weight. A key indicator of liquid load in the wellbore."
    },
    casingMinusLine: {
        title: "Casing - Line Differential",
        content: "Available driving force to lift the plunger. This is the total energy available from casing pressure above line pressure. Higher = more lift capacity."
    },
    consecFailures: {
        title: "Consecutive Failures",
        content: "Number of non-arrivals in a row. Multiple failures indicate the well is loaded up or settings need adjustment. After 3 failures, consider extending shut-in time significantly."
    },
    lastRiseTime: {
        title: "Last Rise Time",
        content: "How long the plunger took to travel from bottom to surface on the last cycle. Typical: 7-14 minutes for a 7000 ft well. Use this to tune afterflow time (often 2-3× rise time)."
    },
    lastRiseVelocity: {
        title: "Last Rise Velocity",
        content: "Average plunger speed during the last lift (Well Depth ÷ Rise Time). Target: 500-800 ft/min. This is the key metric for tuning shut-in time."
    },
    liquidBbl: {
        title: "Liquid in Wellbore",
        content: "Total liquid (water/condensate) accumulated in the tubing. Measured in barrels. Higher liquid = heavier load for the plunger to lift. Target: below 0.5 bbl."
    },
    liquidColumnPsi: {
        title: "Liquid Column Pressure",
        content: "Backpressure created by liquid in the tubing. About 118 psi per barrel for water in 2-3/8\" tubing. This adds to the load the plunger must overcome."
    },

    // Alarms
    ctStatus: {
        title: "C=T Status (Casing = Tubing)",
        content: "Alarm that triggers when casing and tubing pressures are nearly equal. This indicates communication problems, tubing leak, or severe liquid loading. Requires investigation."
    },
    stallThreshold: {
        title: "Stall Threshold",
        content: "Load factor percentage above which the plunger is likely to stall. Set at 70%. If load factor exceeds this at opening, the lift attempt is aborted to prevent a stuck plunger."
    },

    // Afterflow Control
    minAfterflow: {
        title: "Minimum Afterflow",
        content: "Minimum time the well must flow after plunger arrival before close triggers are evaluated. Ensures some production even if flow drops quickly. Typical: 5-15 minutes."
    },
    maxAfterflow: {
        title: "Maximum Afterflow",
        content: "Maximum time the well can flow before forced closure. Prevents excessive liquid fallback during extended low-rate flow. Typical: 30-90 minutes depending on well."
    },
    closeTrigDelay: {
        title: "Close Trigger Delay",
        content: "Additional wait time after Min Afterflow before close triggers activate. Allows flow to stabilize before evaluating closure conditions."
    },
    closeFlowTrigger: {
        title: "Low Flow Close Trigger",
        content: "Closes the well when flow rate drops below this value. Set near or slightly above critical rate to prevent liquid loading. Typical: 150-300 Mcfd."
    },
    closeDPTrigger: {
        title: "Low DP Close Trigger",
        content: "Closes the well when Tubing-Line differential drops below this value. Low DP means insufficient velocity to keep lifting liquid. Typical: 20-50 psi."
    },

    // Unarmed Shut-in
    plungerDrop: {
        title: "Plunger Drop Time (Safety Timer)",
        content: "Safety backup timer — arms the controller after this many minutes even if the plunger hasn't physically reached bottom. With physics-based fall, the plunger lands when it reaches well depth. If this timer fires first, the controller arms 'blind' (plunger still falling). Set longer than expected fall time for normal operation, or shorter to simulate a real RL800 that can't see downhole."
    },
    deviationAngle: {
        title: "Well Deviation Angle",
        content: "Average wellbore angle from vertical. 0° = vertical well. Increases plunger fall time due to wall friction. At ~79° the plunger stalls completely. Marcellus horizontals with bumper springs in the build section may be 20-40° average. Typical vertical well: 0-10°."
    },
    mandatorySI: {
        title: "Mandatory Shut-in (Penalty)",
        content: "Extended shut-in time imposed after a non-arrival. Allows extra pressure buildup to overcome whatever caused the failure. Typical: 60-180 minutes."
    },

    // Armed Shut-in
    maxShutIn: {
        title: "Maximum Shut-in Time",
        content: "Maximum time the well stays closed before opening regardless of pressure. Prevents indefinite shut-in if pressure trigger is set too high. Typical: 60-180 minutes."
    },
    maxWait: {
        title: "Maximum Wait / Lift Time",
        content: "Maximum time allowed for plunger to arrive after opening. If exceeded, declares non-arrival and closes well. Typical: 30-60 minutes (2-4× expected rise time)."
    },
    casingTrigger: {
        title: "Casing Pressure Trigger",
        content: "Opens the well when casing pressure reaches this value. Higher = more energy but longer shut-in. Tune to achieve 500-800 ft/min rise velocity."
    },
    loadFactorTrigger: {
        title: "Load Factor Permissive",
        content: "Well won't open if load factor exceeds this value, even if pressure trigger is met. Prevents opening when liquid load is too high. Acts as a safety check."
    },
    diffTrigger: {
        title: "Differential Pressure Trigger",
        content: "Alternative open trigger based on Casing-Tubing differential instead of absolute casing pressure. Useful when line pressure varies. Opens when differential exceeds setpoint."
    },

    // Close Triggers (new)
    closeOnTimeHelp: {
        title: "Close: ON Time >=",
        content: "Closes the well when total on-time (lifting + afterflow) exceeds this setpoint. Prevents extended flowing periods that deplete casing energy."
    },
    closeCasingHelp: {
        title: "Close: Casing <=",
        content: "Closes the well when casing pressure drops to or below this setpoint during flow. Protects against over-depleting stored casing energy."
    },
    closeTubingHelp: {
        title: "Close: Tubing <=",
        content: "Closes the well when tubing pressure drops to or below this setpoint. Indicates the well is struggling to maintain flow against line pressure."
    },
    closeCsgTbgHelp: {
        title: "Close: Csg - Tbg >=",
        content: "Closes the well when the casing-tubing differential exceeds this setpoint during flow. A rising differential during afterflow can indicate liquid loading in the tubing."
    },
    closeCsgLineHelp: {
        title: "Close: Csg - Line <=",
        content: "Closes the well when the casing-line differential drops to or below this setpoint. Indicates insufficient stored energy remaining to sustain production or lift the next plunger cycle."
    },

    // Open Triggers (new)
    openOffTimeHelp: {
        title: "Open: Off Time >=",
        content: "Opens the well when total off-time (drop + mandatory + armed shut-in) exceeds this setpoint. Ensures the well eventually opens even if pressure triggers aren't met."
    },
    openArmedTimeHelp: {
        title: "Open: Armed Time >=",
        content: "Opens the well when time in armed shut-in state exceeds this setpoint. More specific than Off Time — only counts time after the plunger has landed and mandatory shut-in has passed."
    },
    openTubingHelp: {
        title: "Open: Tubing >=",
        content: "Opens the well when tubing pressure rises to this setpoint during shut-in. Rising tubing pressure during shut-in indicates gas migration past the plunger or liquid unloading."
    },
    openTbgLineHelp: {
        title: "Open: Tbg - Line >=",
        content: "Opens the well when the tubing-line differential exceeds this setpoint. Indicates enough tubing pressure above line to establish initial flow when the valve opens."
    },
    openCsgRateHelp: {
        title: "Open: Csg Rate of Change >=",
        content: "Opens the well when the casing pressure rate of change (psi/min) exceeds the setpoint for the specified duration. Detects when the reservoir is actively building pressure, indicating readiness to flow."
    },

    // Daily Production
    simHours: {
        title: "Simulation Hours",
        content: "Total simulated time elapsed. Use the speed control to fast-forward. 24 hours of simulation gives a good daily production estimate."
    },
    todayMcf: {
        title: "Today's Gas Production",
        content: "Cumulative gas produced in the current simulation day (resets every 24 sim hours). Compare to yesterday to see if changes improved production."
    },
    todayBbl: {
        title: "Today's Liquid Production",
        content: "Cumulative liquid (water/condensate) produced today. Higher liquid with stable gas production is good. Liquid with declining gas may indicate loading."
    },
    yesterdayMcf: {
        title: "Yesterday's Gas Production",
        content: "Gas produced in the previous 24-hour simulation period. Use for comparison when tuning settings."
    },
    yesterdayBbl: {
        title: "Yesterday's Liquid Production",
        content: "Liquid produced in the previous 24-hour period. Compare to today to track changes."
    },
    cycles: {
        title: "Completed Cycles",
        content: "Total number of complete plunger cycles (shut-in → lift → afterflow → close). More cycles generally means more production, but too many means short cycles."
    },
    avgMcfCycle: {
        title: "Average Mcf per Cycle",
        content: "Gas produced per cycle on average. Balance this against cycle frequency. Longer cycles produce more per cycle but fewer cycles per day."
    },
    projectedMcfDay: {
        title: "Projected Daily Production",
        content: "Estimated 24-hour production based on current rate. Key optimization target. Compare different settings to maximize this value."
    },
    cyclesPerDay: {
        title: "Cycles per Day Pace",
        content: "Projected number of cycles in 24 hours at current pace. Typical healthy wells run 8-20 cycles/day. Too few = long cycles. Too many = short inefficient cycles."
    }
};

function showHelpPopover(element, helpKey) {
    const def = HELP_DEFINITIONS[helpKey];
    if (!def) return;

    const popover = document.getElementById('helpPopover');
    const titleEl = document.getElementById('helpPopoverTitle');
    const contentEl = document.getElementById('helpPopoverContent');

    titleEl.innerText = def.title;
    contentEl.innerText = def.content;

    // Position near the clicked element
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    popover.style.top = (rect.bottom + scrollTop + 5) + 'px';
    popover.style.left = (rect.left + scrollLeft) + 'px';

    popover.classList.remove('hidden');
}

function closeHelpPopover() {
    document.getElementById('helpPopover').classList.add('hidden');
}

// Attach click handlers to all elements with data-help
document.addEventListener('click', function(e) {
    const helpEl = e.target.closest('[data-help]');
    if (helpEl) {
        e.stopPropagation();
        showHelpPopover(helpEl, helpEl.dataset.help);
    } else if (!e.target.closest('#helpPopover')) {
        closeHelpPopover();
    }
});
