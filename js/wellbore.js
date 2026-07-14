// === WELLBORE VISUALIZER ===
// Canvas-based wellbore cross-section with animated plunger, liquid pools,
// gas flow arrows, and schematic wellhead equipment.

// --- Color palette ---
const VIZ = {
    bg:             '#111820',
    tubingWall:     '#999',
    casingWall:     '#666',
    liquid:         'rgba(30, 120, 220, 0.75)',
    liquidLight:    'rgba(30, 120, 220, 0.40)',
    plunger:        '#aaa',
    plungerStall:   '#ff3333',
    arrowGreen:     '#00cc44',
    arrowOrange:    '#ff8800',
    valveOpen:      '#00cc44',
    valveClosed:    '#cc3333',
    valveStall:     '#ff8800',
    lubBlue:        '#4488cc',
    treeGold:       '#c8a84e',
    handleRed:      '#cc3333',
    calloutBg:      'rgba(0,0,0,0.65)',
    text:           '#bbb',
    textBright:     '#eee'
};

// --- Toggle visualizer column ---
function toggleVisualizer() {
    visualizerOpen = !visualizerOpen;
    const container = document.querySelector('.main-container');
    const btn = document.getElementById('btnToggleViz');
    if (visualizerOpen) {
        container.classList.remove('viz-collapsed');
        btn.classList.add('viz-active');
        drawWellbore();
    } else {
        container.classList.add('viz-collapsed');
        btn.classList.remove('viz-active');
    }
}

// ============================================================
//  MASTER DRAW
// ============================================================
function drawWellbore() {
    if (!visualizerOpen) return;
    const canvas = els.wellboreCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 40) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Layout object shared by all sub-functions
    const L = {
        w: w,
        h: h,
        surfaceY: h * 0.22,
        bottomY:  h * 0.93,
        cx:       w * 0.45,
        thw:      Math.max(w * 0.035, 5),   // tubing half-width
        chw:      Math.max(w * 0.075, 10),   // casing half-width
        depthToY: function (d) {
            return this.surfaceY + (d / WELL_DEPTH) * (this.bottomY - this.surfaceY);
        }
    };
    L.py = L.depthToY(PlungerDepth);

    // Background
    c.fillStyle = VIZ.bg;
    c.fillRect(0, 0, w, h);

    // Draw order: back → front
    _drawCasingShading(c, L);
    _drawTubingWalls(c, L);
    _drawLiquidPools(c, L);
    _drawPlunger(c, L);
    _drawGasArrows(c, L);
    _drawWellheadSchematic(c, L);
    _drawValveIndicator(c, L);
    _drawDepthScale(c, L);
    _drawCallouts(c, L);
    _drawInfoLabels(c, L);
}

// ============================================================
//  1. CASING SHADING — pressure-mapped annulus fill
// ============================================================
function _drawCasingShading(c, L) {
    var t = Math.min(Math.max((P_casing - 200) / 550, 0), 1);
    var alpha = 0.08 + 0.35 * t;
    c.fillStyle = 'rgba(40, 80, 140, ' + alpha + ')';
    // Left annulus strip
    c.fillRect(L.cx - L.chw, L.surfaceY, L.chw - L.thw, L.bottomY - L.surfaceY);
    // Right annulus strip
    c.fillRect(L.cx + L.thw, L.surfaceY, L.chw - L.thw, L.bottomY - L.surfaceY);
}

// ============================================================
//  2. TUBING & CASING WALLS + perforations
// ============================================================
function _drawTubingWalls(c, L) {
    // Casing walls (outer)
    c.strokeStyle = VIZ.casingWall;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(L.cx - L.chw, L.surfaceY); c.lineTo(L.cx - L.chw, L.bottomY);
    c.moveTo(L.cx + L.chw, L.surfaceY); c.lineTo(L.cx + L.chw, L.bottomY);
    c.stroke();

    // Tubing walls (inner)
    c.strokeStyle = VIZ.tubingWall;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(L.cx - L.thw, L.surfaceY); c.lineTo(L.cx - L.thw, L.bottomY);
    c.moveTo(L.cx + L.thw, L.surfaceY); c.lineTo(L.cx + L.thw, L.bottomY);
    c.stroke();

    // Perforations at TD
    c.strokeStyle = '#556';
    c.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
        var y = L.bottomY - 4 - i * 7;
        c.beginPath();
        c.moveTo(L.cx - L.thw - 4, y); c.lineTo(L.cx - L.thw + 3, y);
        c.moveTo(L.cx + L.thw - 3, y); c.lineTo(L.cx + L.thw + 4, y);
        c.stroke();
    }
}

// ============================================================
//  3. LIQUID POOLS — above-plunger slug + bottom pool
// ============================================================
function _drawLiquidPools(c, L) {
    var tw = L.thw * 2 - 2;
    var x  = L.cx - L.thw + 1;

    if (state === 'LIFTING') {
        // Slug riding above plunger
        if (liquidAbovePlunger > 0.01) {
            var slugFt = liquidAbovePlunger * FT_PER_BBL;
            var topY   = L.depthToY(Math.max(0, PlungerDepth - slugFt));
            c.fillStyle = VIZ.liquid;
            c.fillRect(x, topY, tw, L.py - topY);
        }
        // New liquid entering below plunger
        if (liquidBelowPlunger > 0.01) {
            var poolFt = liquidBelowPlunger * FT_PER_BBL;
            var pTopY  = L.depthToY(Math.max(0, WELL_DEPTH - poolFt));
            c.fillStyle = VIZ.liquidLight;
            c.fillRect(x, pTopY, tw, L.bottomY - pTopY);
        }
    } else {
        // SHUTIN or AFTERFLOW — pool at bottom = liquidInTubing
        if (liquidInTubing > 0.01) {
            var poolFt2 = liquidInTubing * FT_PER_BBL;
            var topY2   = L.depthToY(Math.max(0, WELL_DEPTH - poolFt2));
            c.fillStyle = VIZ.liquid;
            c.fillRect(x, topY2, tw, L.bottomY - topY2);
        }
    }
}

// ============================================================
//  4. PLUNGER — metallic rectangle, flashes red when stalled
// ============================================================
function _drawPlunger(c, L) {
    var pw = L.thw * 1.7;
    var ph = 8;
    var px = L.cx - pw / 2;
    var py = L.py - ph / 2;

    // Body
    c.fillStyle = '#999';
    c.fillRect(px, py, pw, ph);
    // Highlight
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.fillRect(px, py, pw, ph * 0.45);
    // Border
    c.strokeStyle = '#666';
    c.lineWidth = 1;
    c.strokeRect(px, py, pw, ph);

    // Stall flash
    if (isStalled) {
        var flash = Math.sin(Date.now() / 150);
        if (flash > 0) {
            c.strokeStyle = VIZ.plungerStall;
            c.lineWidth = 2;
            c.strokeRect(px - 1, py - 1, pw + 2, ph + 2);
        }
    }
}

// ============================================================
//  5. GAS FLOW ARROWS — animated triangles (Date.now driven)
// ============================================================
function _drawGasArrows(c, L) {
    var isFlowing = (state === 'LIFTING' || state === 'AFTERFLOW');
    if (!isFlowing && !isStalled) return;

    var now     = Date.now();
    var speed   = 0.06;          // px per ms
    var spacing = 24;
    var phase   = (now * speed) % spacing;

    if (state === 'LIFTING' && !isStalled) {
        _drawArrowColumn(c, L.cx, L.bottomY - 10, L.py + 8, phase, VIZ.arrowGreen, 1.0);
    } else if (state === 'AFTERFLOW') {
        var alpha = Math.max(0.15, Math.min(FlowRate / 400, 1.0));
        _drawArrowColumn(c, L.cx, L.bottomY - 10, L.surfaceY + 5, phase, VIZ.arrowGreen, alpha);
    }

    // Stall: orange bypass arcs around plunger
    if (isStalled) {
        c.strokeStyle = VIZ.arrowOrange;
        c.lineWidth = 1.5;
        c.globalAlpha = 0.6 + 0.4 * Math.sin(now / 200);
        c.beginPath();
        c.arc(L.cx - L.thw - 5, L.py, 10, 0.5 * Math.PI, -0.5 * Math.PI, true);
        c.stroke();
        c.beginPath();
        c.arc(L.cx + L.thw + 5, L.py, 10, -0.5 * Math.PI, 0.5 * Math.PI, true);
        c.stroke();
        c.globalAlpha = 1.0;
    }
}

function _drawArrowColumn(c, cx, startY, endY, phase, color, alpha) {
    var spacing = 24;
    var sz = 5;
    c.fillStyle = color;
    c.globalAlpha = alpha;
    for (var y = startY - phase; y > endY; y -= spacing) {
        if (y > startY) continue;
        c.beginPath();
        c.moveTo(cx, y - sz);
        c.lineTo(cx - sz * 0.6, y + sz * 0.3);
        c.lineTo(cx + sz * 0.6, y + sz * 0.3);
        c.closePath();
        c.fill();
    }
    c.globalAlpha = 1.0;
}

// ============================================================
//  6. WELLHEAD SCHEMATIC — drawn from knowledge + reference
// ============================================================
function _drawWellheadSchematic(c, L) {
    var cx    = L.cx;
    var baseY = L.surfaceY;
    var top   = 6;
    var avail = baseY - top;

    // --- Component dimensions ---
    var lubW = 22, lubH = avail * 0.40;
    var lubTopY = top + avail * 0.12;
    var lubBotY = lubTopY + lubH;
    var lubCapH = 5;
    var lubCapY = lubTopY - lubCapH;

    var flangeW  = L.chw * 2 + 6;
    var masterW  = 24, masterH = avail * 0.11;
    var masterTopY = lubBotY + 4;
    var masterBotY = masterTopY + masterH;

    var whFlangeH = 5;
    var whFlangeY = baseY - whFlangeH;

    var flowTeeY = lubBotY - lubH * 0.25;

    // --- Grade line (dashed) ---
    c.strokeStyle = '#444';
    c.lineWidth = 1;
    c.setLineDash([4, 3]);
    c.beginPath();
    c.moveTo(0, baseY);
    c.lineTo(L.w, baseY);
    c.stroke();
    c.setLineDash([]);

    // --- Vertical stem from wellhead flange to lubricator base ---
    c.strokeStyle = VIZ.treeGold;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(cx, whFlangeY);
    c.lineTo(cx, lubBotY);
    c.stroke();
    c.strokeStyle = '#8a7530';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx - 2, whFlangeY); c.lineTo(cx - 2, lubBotY);
    c.moveTo(cx + 2, whFlangeY); c.lineTo(cx + 2, lubBotY);
    c.stroke();

    // --- Wellhead flange ---
    c.fillStyle = VIZ.treeGold;
    c.fillRect(cx - flangeW / 2, whFlangeY, flangeW, whFlangeH);
    c.strokeStyle = '#8a7530';
    c.lineWidth = 1;
    c.strokeRect(cx - flangeW / 2, whFlangeY, flangeW, whFlangeH);
    // Bolt dots
    c.fillStyle = '#8a7530';
    var boltY = whFlangeY + whFlangeH / 2;
    for (var bi = -2; bi <= 2; bi++) {
        if (bi === 0) continue;
        c.beginPath();
        c.arc(cx + bi * (flangeW / 5), boltY, 1.2, 0, Math.PI * 2);
        c.fill();
    }

    // --- Master valve body ---
    c.fillStyle = VIZ.treeGold;
    c.fillRect(cx - masterW / 2, masterTopY, masterW, masterH);
    c.strokeStyle = '#8a7530';
    c.lineWidth = 1;
    c.strokeRect(cx - masterW / 2, masterTopY, masterW, masterH);
    // Handwheel (right)
    _drawHandwheel(c, cx + masterW / 2 + 9, masterTopY + masterH / 2, 4);
    // Stem
    c.strokeStyle = '#777';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx + masterW / 2, masterTopY + masterH / 2);
    c.lineTo(cx + masterW / 2 + 5, masterTopY + masterH / 2);
    c.stroke();

    // --- Lubricator base flange ---
    var lubFlgW = lubW + 8;
    c.fillStyle = VIZ.treeGold;
    c.fillRect(cx - lubFlgW / 2, lubBotY - 3, lubFlgW, 4);
    c.strokeStyle = '#8a7530';
    c.strokeRect(cx - lubFlgW / 2, lubBotY - 3, lubFlgW, 4);

    // --- Lubricator body (blue) ---
    c.fillStyle = VIZ.lubBlue;
    c.fillRect(cx - lubW / 2, lubTopY, lubW, lubH);
    c.strokeStyle = '#2a5a8a';
    c.lineWidth = 1;
    c.strokeRect(cx - lubW / 2, lubTopY, lubW, lubH);
    // Highlight stripe
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(cx - lubW / 2 + 2, lubTopY + 1, lubW * 0.3, lubH - 2);

    // --- Lubricator cap (tapered) ---
    c.fillStyle = VIZ.lubBlue;
    c.beginPath();
    c.moveTo(cx - lubW / 2 - 1, lubTopY);
    c.lineTo(cx - lubW / 2 + 3, lubCapY);
    c.lineTo(cx + lubW / 2 - 3, lubCapY);
    c.lineTo(cx + lubW / 2 + 1, lubTopY);
    c.closePath();
    c.fill();
    c.strokeStyle = '#2a5a8a';
    c.stroke();

    // --- Tubing PT (on top of lubricator) ---
    var ptR = 5;
    var ptY = lubCapY - 10;
    c.fillStyle = '#5599dd';
    c.beginPath();
    c.arc(cx, ptY, ptR, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#2a5a8a';
    c.lineWidth = 1;
    c.stroke();
    // Stem
    c.strokeStyle = '#888';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx, ptY + ptR);
    c.lineTo(cx, lubCapY);
    c.stroke();
    // Store position for TBG callout
    L._tbgPtX = cx + ptR + 3;
    L._tbgPtY = ptY - 8;

    // --- Flow tee + flowline going right ---
    var flowStartX = cx + lubW / 2;
    var flowEndX   = L.w - 8;

    // Horizontal pipe
    c.strokeStyle = VIZ.treeGold;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(flowStartX, flowTeeY);
    c.lineTo(flowEndX, flowTeeY);
    c.stroke();
    // Pipe edges
    c.strokeStyle = '#8a7530';
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(flowStartX, flowTeeY - 2); c.lineTo(flowEndX, flowTeeY - 2);
    c.moveTo(flowStartX, flowTeeY + 2); c.lineTo(flowEndX, flowTeeY + 2);
    c.stroke();

    // Wing valve
    var wvX = flowStartX + 28;
    c.fillStyle = VIZ.treeGold;
    c.fillRect(wvX - 7, flowTeeY - 5, 14, 10);
    c.strokeStyle = '#8a7530';
    c.lineWidth = 1;
    c.strokeRect(wvX - 7, flowTeeY - 5, 14, 10);
    _drawHandwheel(c, wvX, flowTeeY - 9, 3);

    // Motor valve (larger body)
    var mvX = wvX + 42;
    c.fillStyle = VIZ.treeGold;
    c.fillRect(mvX - 9, flowTeeY - 7, 18, 14);
    c.strokeStyle = '#8a7530';
    c.strokeRect(mvX - 9, flowTeeY - 7, 18, 14);
    // State-colored handwheel
    var mvColor;
    if (isStalled) {
        mvColor = Math.sin(Date.now() / 200) > 0 ? VIZ.valveStall : '#553300';
    } else if (state === 'LIFTING' || state === 'AFTERFLOW') {
        mvColor = VIZ.valveOpen;
    } else {
        mvColor = VIZ.valveClosed;
    }
    L._mvColor = mvColor;
    _drawHandwheel(c, mvX, flowTeeY - 11, 4.5, mvColor);
    // Stem
    c.strokeStyle = '#777';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(mvX, flowTeeY - 7);
    c.lineTo(mvX, flowTeeY - 7.5);
    c.stroke();
    L._mvX = mvX;
    L._mvY = flowTeeY;

    // Flow arrow at pipe exit (when flowing)
    if (FlowRate > 5) {
        c.fillStyle = VIZ.arrowGreen;
        c.globalAlpha = Math.min(FlowRate / 300, 1.0);
        var ax = flowEndX - 2;
        c.beginPath();
        c.moveTo(ax + 4, flowTeeY);
        c.lineTo(ax - 3, flowTeeY - 3);
        c.lineTo(ax - 3, flowTeeY + 3);
        c.closePath();
        c.fill();
        c.globalAlpha = 1.0;
    }

    // --- Casing PT (left side, connected to casing) ---
    var csgPtX = cx - L.chw - 22;
    var csgPtY = masterTopY + masterH * 0.5;
    c.fillStyle = '#5599dd';
    c.beginPath();
    c.arc(csgPtX, csgPtY, ptR, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#2a5a8a';
    c.lineWidth = 1;
    c.stroke();
    // Stem to casing
    c.strokeStyle = '#888';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(csgPtX + ptR, csgPtY);
    c.lineTo(cx - L.chw + 1, csgPtY);
    c.stroke();
    // Store position for CSG callout
    L._csgPtX = csgPtX - ptR - 3;
    L._csgPtY = csgPtY - 8;
}

// Helper: handwheel circle (default red, or custom color)
function _drawHandwheel(c, x, y, r, color) {
    c.fillStyle = color || VIZ.handleRed;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#222';
    c.lineWidth = 0.5;
    c.stroke();
}

// ============================================================
//  7. VALVE INDICATOR — green/red/orange circle at surface
// ============================================================
function _drawValveIndicator(c, L) {
    // Label below the motor valve — handwheel color handled by gate valve helper
    var vx = L._mvX !== undefined ? L._mvX : L.cx + 60;
    var vy = L._mvY !== undefined ? L._mvY : L.surfaceY * 0.5;
    var color = L._mvColor || VIZ.valveClosed;

    var label;
    if (isStalled) label = 'STALL';
    else if (state === 'LIFTING' || state === 'AFTERFLOW') label = 'OPEN';
    else label = 'SHUT';

    c.fillStyle = color;
    c.font = 'bold 9px sans-serif';
    c.textAlign = 'center';
    c.fillText(label, vx, vy + 20);
}

// ============================================================
//  8. CALLOUT BOXES — live pressure/rate on diagram
// ============================================================
function _drawCallouts(c, L) {
    // Casing pressure — at the casing PT location
    var csgX = L._csgPtX !== undefined ? L._csgPtX : 3;
    var csgY = L._csgPtY !== undefined ? L._csgPtY : (L.surfaceY + L.bottomY) / 2;
    _drawCalloutBox(c, csgX, csgY, 'CSG', P_casing.toFixed(0) + ' psi', '#ff6666', 'right');

    // Tubing pressure — at the tubing PT location
    var tbgX = L._tbgPtX !== undefined ? L._tbgPtX : L.cx + L.chw + 6;
    var tbgY = L._tbgPtY !== undefined ? L._tbgPtY : L.surfaceY + 25;
    _drawCalloutBox(c, tbgX, tbgY, 'TBG', P_tubing.toFixed(0) + ' psi', '#6699ff', 'left');

    // Line pressure — above the flowline
    var flowAreaY = L.surfaceY * 0.18;
    _drawCalloutBox(c, L.w - 72, flowAreaY, 'LINE', P_line.toFixed(0) + ' psi', '#ffaa44');

    // Flow rate — below the flowline
    var flowBelowY = L.surfaceY * 0.72;
    _drawCalloutBox(c, L.w - 72, flowBelowY, 'FLOW', FlowRate.toFixed(0) + ' Mcfd', '#44cc66');
}

function _drawCalloutBox(c, x, y, label, value, color, align) {
    c.font = '10px monospace';
    var text = label + ' ' + value;
    var tw = c.measureText(text).width;
    var bw = tw + 8;
    var bh = 15;

    // 'right' alignment: box extends leftward from x
    var bx = (align === 'right') ? x - bw : x;

    c.fillStyle = VIZ.calloutBg;
    c.fillRect(bx, y, bw, bh);
    c.strokeStyle = color;
    c.lineWidth = 0.5;
    c.strokeRect(bx, y, bw, bh);

    c.fillStyle = color;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text, bx + 4, y + bh / 2);
    c.textBaseline = 'alphabetic';
}

// ============================================================
//  9. INFO LABELS — state, plunger, liquid, load factor
// ============================================================
function _drawInfoLabels(c, L) {
    c.font = '10px monospace';

    // State name — upper right of wellbore area
    var sc = '#ccc';
    if (state === 'LIFTING')           sc = '#00ffff';
    else if (state === 'AFTERFLOW')    sc = '#aaaaaa';
    else if (state === 'ARMED_SHUTIN') sc = '#ff9999';
    else                               sc = '#ffcc00';

    c.fillStyle = sc;
    c.textAlign = 'right';
    c.fillText(state.replace(/_/g, ' '), L.w - 6, L.surfaceY + 50);

    // Plunger depth + velocity — beside plunger
    if (state === 'LIFTING' || PlungerDepth < WELL_DEPTH - 50) {
        c.fillStyle = VIZ.text;
        c.textAlign = 'left';
        c.fillText(Math.round(PlungerDepth) + ' ft', L.cx + L.thw + 8, L.py - 3);
        c.fillText(Math.abs(Math.round(PlungerVel)) + ' fpm', L.cx + L.thw + 8, L.py + 9);
    }

    // Liquid load — near bottom pool
    var totalLiq = (state === 'LIFTING')
        ? (liquidAbovePlunger + liquidBelowPlunger)
        : liquidInTubing;
    if (totalLiq > 0.01) {
        c.fillStyle = '#6699ff';
        c.textAlign = 'left';
        c.fillText(totalLiq.toFixed(2) + ' bbl', L.cx + L.chw + 6, L.bottomY - 12);
        c.fillText(liquidColumnPsi.toFixed(0) + ' psi liq', L.cx + L.chw + 6, L.bottomY);
    }

    // Load Factor — bottom right, color-coded
    var lfColor = '#44cc66';
    if (LoadFactor > 60)      lfColor = '#ff4444';
    else if (LoadFactor > 40) lfColor = '#ffaa44';
    c.fillStyle = lfColor;
    c.textAlign = 'right';
    c.fillText('LF ' + LoadFactor.toFixed(0) + '%', L.w - 6, L.bottomY + 16);
}

// ============================================================
//  10. DEPTH SCALE — tick marks on left margin
// ============================================================
function _drawDepthScale(c, L) {
    c.fillStyle = '#555';
    c.strokeStyle = '#333';
    c.lineWidth = 0.5;
    c.font = '8px sans-serif';
    c.textAlign = 'right';

    var step = WELL_DEPTH <= 5000 ? 1000 : 2000;
    for (var d = 0; d <= WELL_DEPTH; d += step) {
        var y = L.depthToY(d);
        c.beginPath();
        c.moveTo(L.cx - L.chw - 2, y);
        c.lineTo(L.cx - L.chw - 7, y);
        c.stroke();
        c.fillText(d === 0 ? '0\'' : (d / 1000).toFixed(0) + 'k\'', L.cx - L.chw - 9, y + 3);
    }
    // Always label TD if not on a step
    if (WELL_DEPTH % step !== 0) {
        var tdY = L.depthToY(WELL_DEPTH);
        c.beginPath();
        c.moveTo(L.cx - L.chw - 2, tdY);
        c.lineTo(L.cx - L.chw - 7, tdY);
        c.stroke();
        c.fillText('TD', L.cx - L.chw - 9, tdY + 3);
    }
}
