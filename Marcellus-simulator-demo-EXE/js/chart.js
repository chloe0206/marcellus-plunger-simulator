// --- CHARTING (Simple Canvas Implementation) ---
const ctx = els.canvas.getContext('2d');

// --- CROSSHAIR / TOOLTIP on hover ---
// Store last filtered data so mouse handler can find nearest point
let _lastFilteredData = [];
let _lastMapX = null;
let _lastMinTime = 0;
let _lastTimeRange = 1;
let _lastChartLeft = 0;
let _lastChartRight = 0;

els.canvas.addEventListener('mousemove', function(e) {
    const rect = els.canvas.getBoundingClientRect();
    const scaleX = els.canvas.width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;

    if (mx < _lastChartLeft || mx > _lastChartRight || _lastFilteredData.length === 0) {
        chartHoverIndex = -1;
        return;
    }

    // Convert pixel to time, then binary search for nearest data point
    const t = _lastMinTime + ((mx - _lastChartLeft) / (_lastChartRight - _lastChartLeft)) * _lastTimeRange;
    let best = 0;
    let bestDist = Math.abs(_lastFilteredData[0].time - t);
    for (let i = 1; i < _lastFilteredData.length; i++) {
        const dist = Math.abs(_lastFilteredData[i].time - t);
        if (dist < bestDist) { best = i; bestDist = dist; }
        else break; // data is sorted by time, so once dist increases we're past it
    }
    chartHoverIndex = best;
});

els.canvas.addEventListener('mouseleave', function() {
    chartHoverIndex = -1;
});

function updateChart() {
    // Push Data with timestamp (every minute of sim time)
    // Using explicit time tracking instead of modulo to avoid issues when speed changes
    if (simTime >= lastChartPushTime + 1) { // Push data every 1 minute of sim time
        chartData.push({
            time: simTime,
            casing: P_casing,
            tubing: P_tubing,
            pwf: Pwf,
            flow: FlowRate,
            line: P_line
        });
        lastChartPushTime = simTime;

        // Keep maximum of 48 hours of data (in case they run multi-day sims)
        // At 1 data point per minute, 48 hours = 2880 points
        if (chartData.length > 2880) {
            chartData.shift();
        }
    }
    drawChart();
}

function drawChart() {
    const w = els.canvas.width = els.canvas.clientWidth;
    const h = els.canvas.height = els.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Chart margins for dual Y-axis labels (increased bottom for time labels)
    const leftMargin = 45;
    const rightMargin = 50;
    const topMargin = 25;
    const bottomMargin = 25;
    const chartW = w - leftMargin - rightMargin;
    const chartH = h - topMargin - bottomMargin;

    // Filter data based on selected time window
    const currentTime = simTime;
    const windowStart = Math.max(0, currentTime - chartViewWindowMinutes);
    const filteredData = chartData.filter(d => d.time >= windowStart);

    // If no data, draw empty chart
    if (filteredData.length === 0) {
        _lastFilteredData = [];
        ctx.fillStyle = '#666';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet - start simulation', w / 2, h / 2);
        return;
    }

    // Calculate time range for X-axis
    const minTime = filteredData[0].time;
    const maxTime = Math.max(filteredData[filteredData.length - 1].time, minTime + 60); // At least 1 hour range
    const timeRange = maxTime - minTime;

    // --- Auto-scale Y-axes based on visible data ---
    // Find max values in visible window
    let dataMaxP = 0;
    let dataMaxFlow = 0;
    const isPackerScale = (typeof COMPLETION_TYPE !== 'undefined' && COMPLETION_TYPE === 'packer');
    filteredData.forEach(d => {
        // In packer mode include Pwf in the axis scale (and exclude dead casing)
        const pMax = isPackerScale
            ? Math.max(d.pwf || 0, d.tubing, d.line)
            : Math.max(d.casing, d.tubing, d.line);
        if (pMax > dataMaxP) dataMaxP = pMax;
        if (d.flow > dataMaxFlow) dataMaxFlow = d.flow;
    });

    // Pick nice round axis max with headroom
    function niceAxisMax(dataMax, minMax, headroom) {
        if (dataMax <= 0) return minMax;
        const raw = dataMax * (1 + headroom);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const niceSteps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
        const ratio = raw / mag;
        let nice = niceSteps.find(s => s >= ratio) * mag;
        return Math.max(nice, minMax);
    }

    const maxP = niceAxisMax(dataMaxP, 200, 0.2);
    const maxFlow = niceAxisMax(dataMaxFlow, 100, 0.1);

    // Generate evenly-spaced tick values (4 intervals = 5 ticks including 0)
    function makeTickSteps(axisMax, numIntervals) {
        const step = axisMax / numIntervals;
        const steps = [];
        for (let i = 0; i <= numIntervals; i++) steps.push(Math.round(step * i));
        return steps;
    }

    const pressureSteps = makeTickSteps(maxP, 4);
    const flowSteps = makeTickSteps(maxFlow, 5);

    // Pressure scale (left Y-axis)
    const mapYPressure = (val) => topMargin + chartH - (val / maxP * chartH);

    // Flow scale (right Y-axis)
    const mapYFlow = (val) => topMargin + chartH - (val / maxFlow * chartH);

    // X-axis mapping based on time
    const mapX = (time) => leftMargin + ((time - minTime) / timeRange) * chartW;

    // Store layout for mouse handler
    _lastFilteredData = filteredData;
    _lastMapX = mapX;
    _lastMinTime = minTime;
    _lastTimeRange = timeRange;
    _lastChartLeft = leftMargin;
    _lastChartRight = leftMargin + chartW;

    // Draw left Y-axis scale (Pressure - psi)
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    pressureSteps.forEach(val => {
        const y = mapYPressure(val);
        // Grid line
        ctx.strokeStyle = '#ddd';
        ctx.beginPath();
        ctx.moveTo(leftMargin, y);
        ctx.lineTo(leftMargin + chartW, y);
        ctx.stroke();
        // Label
        ctx.fillStyle = '#666';
        ctx.fillText(val, leftMargin - 5, y + 3);
    });
    // Left axis title
    ctx.fillStyle = '#666';
    ctx.fillText('psi', leftMargin - 5, topMargin - 5);

    // Draw right Y-axis scale (Flow - Mcfd)
    ctx.textAlign = 'left';
    flowSteps.forEach(val => {
        const y = mapYFlow(val);
        // Label (green to match flow line)
        ctx.fillStyle = '#008800';
        ctx.fillText(val, leftMargin + chartW + 5, y + 3);
    });
    // Right axis title
    ctx.fillStyle = '#008800';
    ctx.fillText('Mcfd', leftMargin + chartW + 5, topMargin - 5);

    // Draw chart border
    ctx.strokeStyle = '#999';
    ctx.strokeRect(leftMargin, topMargin, chartW, chartH);

    // Draw X-axis time labels
    ctx.font = '10px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    const numTimeLabels = Math.min(Math.ceil(timeRange / 60), 12); // Label every hour, max 12 labels
    for (let i = 0; i <= numTimeLabels; i++) {
        const time = minTime + (i / numTimeLabels) * timeRange;
        const x = mapX(time);
        const hours = Math.floor(time / 60);
        const label = hours + 'h';
        ctx.fillText(label, x, topMargin + chartH + 15);

        // Draw tick mark
        ctx.strokeStyle = '#999';
        ctx.beginPath();
        ctx.moveTo(x, topMargin + chartH);
        ctx.lineTo(x, topMargin + chartH + 5);
        ctx.stroke();
    }

    // Draw Casing (Red) — skipped in packer mode (annulus is dead, no trace to show)
    const isPackerChart = (typeof COMPLETION_TYPE !== 'undefined' && COMPLETION_TYPE === 'packer');
    if (!isPackerChart) {
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.beginPath();
        filteredData.forEach((d, i) => {
            const x = mapX(d.time);
            const y = mapYPressure(d.casing);
            if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.stroke();
    }

    // Draw Tubing (Blue)
    ctx.strokeStyle = 'blue';
    ctx.beginPath();
    filteredData.forEach((d, i) => {
        const x = mapX(d.time);
        const y = mapYPressure(d.tubing);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // Draw Pwf bottomhole pressure (Purple) — packer mode only
    if (isPackerChart) {
        ctx.strokeStyle = '#9933cc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        filteredData.forEach((d, i) => {
            const x = mapX(d.time);
            const y = mapYPressure(d.pwf || 0);
            if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.stroke();
    }

    // Draw Flow (Green) - uses right Y-axis scale
    ctx.strokeStyle = 'green';
    ctx.beginPath();
    filteredData.forEach((d, i) => {
        const x = mapX(d.time);
        const y = mapYFlow(d.flow);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // Draw Line Pressure (Orange) - reference line for backpressure
    ctx.strokeStyle = 'orange';
    ctx.beginPath();
    filteredData.forEach((d, i) => {
        const x = mapX(d.time);
        const y = mapYPressure(d.line);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // Legend (top of chart area) — Casing replaced by Pwf in packer mode
    ctx.textAlign = 'left';
    let legendX = leftMargin + 5;
    if (isPackerChart) {
        ctx.fillStyle = '#9933cc'; ctx.fillText("Pwf BH", legendX, topMargin + 12); legendX += 60;
    } else {
        ctx.fillStyle = 'red';     ctx.fillText("Casing", legendX, topMargin + 12); legendX += 50;
    }
    ctx.fillStyle = 'blue';   ctx.fillText("Tubing", legendX, topMargin + 12); legendX += 50;
    ctx.fillStyle = 'green';  ctx.fillText("Flow",   legendX, topMargin + 12); legendX += 40;
    ctx.fillStyle = 'orange'; ctx.fillText("Line",   legendX, topMargin + 12);

    // --- CROSSHAIR + TOOLTIP ---
    if (chartHoverIndex >= 0 && chartHoverIndex < filteredData.length) {
        const d = filteredData[chartHoverIndex];
        const cx = mapX(d.time);

        // Vertical crosshair line
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, topMargin);
        ctx.lineTo(cx, topMargin + chartH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dots on each trace (packer mode replaces casing dot with Pwf)
        const dots = [];
        if (isPackerChart) dots.push({ y: mapYPressure(d.pwf || 0), color: '#9933cc' });
        else               dots.push({ y: mapYPressure(d.casing), color: 'red' });
        dots.push({ y: mapYPressure(d.tubing), color: 'blue' });
        dots.push({ y: mapYFlow(d.flow),       color: 'green' });
        dots.push({ y: mapYPressure(d.line),   color: 'orange' });
        dots.forEach(dot => {
            ctx.fillStyle = dot.color;
            ctx.beginPath();
            ctx.arc(cx, dot.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        // Tooltip box — drop Csg line in packer mode
        const hours = Math.floor(d.time / 60);
        const mins = Math.round(d.time % 60);
        const timeStr = hours + 'h ' + (mins < 10 ? '0' : '') + mins + 'm';
        const lines = [timeStr];
        if (isPackerChart) lines.push('Pwf: ' + (d.pwf || 0).toFixed(0) + ' psi');
        else               lines.push('Csg: ' + d.casing.toFixed(0) + ' psi');
        lines.push('Tbg: ' + d.tubing.toFixed(0) + ' psi');
        lines.push('Flow: ' + d.flow.toFixed(0) + ' Mcfd');
        lines.push('Line: ' + d.line.toFixed(0) + ' psi');

        ctx.font = '11px monospace';
        const lineH = 15;
        const pad = 6;
        const boxW = 130;
        const boxH = lines.length * lineH + pad * 2;

        // Position tooltip: flip to left side if too close to right edge
        let tx = cx + 10;
        if (tx + boxW > leftMargin + chartW) tx = cx - boxW - 10;
        let ty = topMargin + 20;

        // Background
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.fillRect(tx, ty, boxW, boxH);
        ctx.strokeRect(tx, ty, boxW, boxH);

        // Text — colors must match lines order (Pwf replaces Csg in packer mode)
        ctx.textAlign = 'left';
        const colors = isPackerChart
            ? ['#333', '#9933cc', 'blue', 'green', 'orange']
            : ['#333', 'red',     'blue', 'green', 'orange'];
        lines.forEach((line, i) => {
            ctx.fillStyle = colors[i];
            ctx.fillText(line, tx + pad, ty + pad + (i + 1) * lineH - 2);
        });

        ctx.restore();
    }
}
