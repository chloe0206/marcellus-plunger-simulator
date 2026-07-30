// --- GUIDED TUTORIAL / TOUR ---
// A lightweight, dependency-free walkthrough. It dims the screen, spotlights one
// area at a time, and shows a tooltip with Back / Next / Skip. No libraries.
//
// Each step points at a real element on the page (by CSS selector). A step with
// target: null is a centered "card" (used for the welcome and closing screens).

const TUTORIAL_STEPS = [
    {
        target: null,
        title: "Welcome to the Plunger Lift Simulator",
        body: "This is a hands-on model of a plunger lift gas well. You tune the controller, then watch how the well responds &mdash; production, pressures, and whether each lift reaches the surface.<br><br>This quick tour points out the main areas. It takes about a minute, and you can skip anytime."
    },
    {
        target: "#wellPresetSelect",
        title: "1. Pick a well",
        body: "Start here. Each preset is a gas well with its own depth, pressure, and behavior. The default Marcellus well is a good place to begin &mdash; or use <strong>+ Add Well</strong> right next to this menu to build your own from real field numbers."
    },
    {
        target: "#speedSelect",
        title: "2. Fast-forward time",
        body: "A real plunger cycle takes hours. Bump the speed up to <strong>60x</strong> or <strong>300x</strong> and you'll watch full cycles play out in seconds instead of waiting in real time."
    },
    {
        target: "#statusDisplay",
        title: "3. What the well is doing",
        body: "This box always shows the well's current phase &mdash; it moves through <em>shut-in &rarr; lifting &rarr; afterflow</em> and back again. Watch it change as the simulation runs."
    },
    {
        target: '[data-help="flowRate"]',
        title: "4. Live readouts (and a handy tip)",
        body: "These numbers update in real time as the well runs &mdash; flow rate, pressures, plunger depth, and more.<br><br><strong>Tip:</strong> click any label like this one to get a plain-English explanation of what it means."
    },
    {
        target: ".section-afterflow",
        title: "5. The controls you tune",
        body: "This is where the real work happens. These setpoints and triggers decide when the well opens and closes. Adjusting them is the whole game &mdash; good tuning means more gas and fewer failed lifts; poor tuning loads the well with liquid."
    },
    {
        target: ".visualizer-panel",
        title: "6. See it happen",
        body: "The chart and wellbore view show pressure and flow over time, and the plunger travelling up and down the well. It's the easiest way to see the effect of a change you just made."
    },
    {
        target: "#btnStart",
        title: "You're ready",
        body: "That's the tour! Under the hood this uses real petroleum-engineering physics, but you don't need the math to use it &mdash; just tune and observe.<br><br>Click <strong>START SIMULATION</strong> whenever you're ready to begin."
    }
];

let _tourIndex = 0;
let _tourActive = false;

function startTutorial() {
    if (_tourActive) endTutorial();
    _tourActive = true;
    _tourIndex = 0;

    // Build the tour DOM once
    if (!document.getElementById('tourBlocker')) {
        const blocker = document.createElement('div');
        blocker.id = 'tourBlocker';

        const spotlight = document.createElement('div');
        spotlight.id = 'tourSpotlight';

        const tip = document.createElement('div');
        tip.id = 'tourTooltip';
        tip.innerHTML =
            '<button class="tour-skip-x" onclick="endTutorial()" title="Close tour" aria-label="Close tour">&times;</button>' +
            '<div class="tour-step-count" id="tourCount"></div>' +
            '<div class="tour-title" id="tourTitle"></div>' +
            '<div class="tour-body" id="tourBody"></div>' +
            '<div class="tour-actions">' +
                '<button class="tour-btn ghost" id="tourBack" onclick="tourBack()">Back</button>' +
                '<span class="tour-spacer"></span>' +
                '<button class="tour-btn ghost" id="tourSkip" onclick="endTutorial()">Skip</button>' +
                '<button class="tour-btn" id="tourNext" onclick="tourNext()">Next</button>' +
            '</div>';

        document.body.appendChild(blocker);
        document.body.appendChild(spotlight);
        document.body.appendChild(tip);
    }
    document.getElementById('tourBlocker').style.display = 'block';
    document.getElementById('tourSpotlight').style.display = 'block';
    document.getElementById('tourTooltip').style.display = 'block';

    window.addEventListener('resize', positionTour);
    window.addEventListener('scroll', positionTour, true);
    document.addEventListener('keydown', tourKeyHandler);

    tourGoto(0);
}

function tourKeyHandler(e) {
    if (!_tourActive) return;
    if (e.key === 'Escape') endTutorial();
    else if (e.key === 'ArrowRight') tourNext();
    else if (e.key === 'ArrowLeft') tourBack();
}

function tourGoto(i) {
    _tourIndex = Math.max(0, Math.min(i, TUTORIAL_STEPS.length - 1));
    const step = TUTORIAL_STEPS[_tourIndex];

    document.getElementById('tourCount').textContent =
        'Step ' + (_tourIndex + 1) + ' of ' + TUTORIAL_STEPS.length;
    document.getElementById('tourTitle').innerHTML = step.title;
    document.getElementById('tourBody').innerHTML = step.body;

    // Back button hidden on first step
    document.getElementById('tourBack').style.visibility = _tourIndex === 0 ? 'hidden' : 'visible';
    // Next becomes "Done" on the last step, where Skip is no longer needed
    const isLast = _tourIndex === TUTORIAL_STEPS.length - 1;
    document.getElementById('tourNext').textContent = isLast ? 'Done' : 'Next';
    document.getElementById('tourSkip').style.display = isLast ? 'none' : '';

    positionTour();
}

function tourNext() {
    if (_tourIndex >= TUTORIAL_STEPS.length - 1) { endTutorial(); return; }
    tourGoto(_tourIndex + 1);
}

function tourBack() {
    tourGoto(_tourIndex - 1);
}

function positionTour() {
    if (!_tourActive) return;
    const step = TUTORIAL_STEPS[_tourIndex];
    const spot = document.getElementById('tourSpotlight');
    const tip = document.getElementById('tourTooltip');
    if (!spot || !tip) return;

    const el = step.target ? document.querySelector(step.target) : null;
    let rect = null;

    if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        rect = el.getBoundingClientRect();
        const pad = 6;
        spot.classList.remove('no-target');
        spot.style.width = (rect.width + pad * 2) + 'px';
        spot.style.height = (rect.height + pad * 2) + 'px';
        spot.style.top = (rect.top - pad) + 'px';
        spot.style.left = (rect.left - pad) + 'px';
    } else {
        // Centered card: shrink the spotlight to nothing so the whole screen dims.
        spot.classList.add('no-target');
        spot.style.width = '0px';
        spot.style.height = '0px';
        spot.style.top = '50%';
        spot.style.left = '50%';
    }

    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const m = 12;
    let top, left;

    if (!rect) {
        top = (window.innerHeight - tipH) / 2;
        left = (window.innerWidth - tipW) / 2;
    } else {
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow > tipH + m + 10) {
            top = rect.bottom + m;
        } else if (spaceAbove > tipH + m + 10) {
            top = rect.top - tipH - m;
        } else {
            top = window.innerHeight - tipH - m; // pin to bottom
        }
        left = rect.left + rect.width / 2 - tipW / 2; // center on target
    }

    // Keep the tooltip on screen
    left = Math.max(m, Math.min(left, window.innerWidth - tipW - m));
    top = Math.max(m, Math.min(top, window.innerHeight - tipH - m));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
}

function endTutorial() {
    _tourActive = false;
    const blocker = document.getElementById('tourBlocker');
    const spot = document.getElementById('tourSpotlight');
    const tip = document.getElementById('tourTooltip');
    if (blocker) blocker.style.display = 'none';
    if (spot) spot.style.display = 'none';
    if (tip) tip.style.display = 'none';
    window.removeEventListener('resize', positionTour);
    window.removeEventListener('scroll', positionTour, true);
    document.removeEventListener('keydown', tourKeyHandler);
}
