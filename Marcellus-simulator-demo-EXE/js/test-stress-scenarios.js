// test-stress-scenarios.js — READ-ONLY rigorous probe of the packer models.
// Runs Well A & B under baseline, deliberately-bad settings, tweaks, and an
// optimization sweep. Reports cycles/day, production, liquid loading, non-arrivals,
// stalls, arrival velocity, final state. NO model changes.
//
// Run: node Marcellus-simulator-demo-EXE/js/test-stress-scenarios.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

// --- Calibrated well knob sets (mirror config.js WELL_PRESETS) ---
const WELL_A = {
  COMPLETION_TYPE:'packer', WELL_DEPTH:6893, RESERVOIR_PRESSURE:650,
  liquidGasRatio:1.0, IPR_C:0.048, IPR_n:0.8, P_LINE_BASE:312,
  V_STORE_FT3:6000, V_FALL_REF:800, VALVE_CV:10, AFTERFLOW_INFLOW_FACTOR:1.0,
  TUBING_AREA_FT2:0.0217, TUBING_ID_FT:0.166, FT_PER_BBL:259, LIQUID_PSI_PER_BBL:118,
  plungerGasDrag:6.0e-4,
  INITIAL:{P_casing:312, P_tubing:320, liquidInTubing:0.3},
};
const WELL_B = {
  COMPLETION_TYPE:'packer', WELL_DEPTH:8034, RESERVOIR_PRESSURE:1800,
  liquidGasRatio:0.4, IPR_C:0.017, IPR_n:0.8, P_LINE_BASE:990,
  V_STORE_FT3:8000, V_FALL_REF:1000, VALVE_CV:10, AFTERFLOW_INFLOW_FACTOR:0.98,
  TUBING_AREA_FT2:0.0325, TUBING_ID_FT:0.2034, FT_PER_BBL:172.8, LIQUID_PSI_PER_BBL:78.6,
  plungerGasDrag:3.6e-3,
  INITIAL:{P_casing:990, P_tubing:1000, liquidInTubing:0.2},
};

// Baseline controller settings (operator values per well)
const CTRL_A = { inMaxWait:30, inMinAft:5, inMaxAft:720, inCloseDly:2, inPlgDrop:42,
  inMandatory:0, inMaxShutIn:120, openOffTime:50, closeFlow:650 };
const CTRL_B = { inMaxWait:30, inMinAft:5, inMaxAft:300, inCloseDly:10, inPlgDrop:55,
  inMandatory:0, inMaxShutIn:180, openOffTime:90, closeFlow:1600 };

function buildDOM(ctrl) {
  const els = {};
  const mk = o => ({ value:'0', checked:false, innerText:'', innerHTML:'', textContent:'',
    classList:{add(){},remove(){},contains(){return false;},toggle(){}}, style:{},
    getContext(){return {clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},
      fillRect(){},strokeRect(){},fillText(){},measureText(){return{width:0};},arc(){},save(){},
      restore(){},translate(){},scale(){},setTransform(){},createLinearGradient(){return{addColorStop(){}};}};},
    width:800,height:400,appendChild(){},removeChild(){},setAttribute(){},getAttribute(){return'';},
    addEventListener(){}, ...o });
  const d = {
    'inMaxWait':{value:String(ctrl.inMaxWait)}, 'inMinAft':{value:String(ctrl.inMinAft)},
    'inMaxAft':{value:String(ctrl.inMaxAft)}, 'inCloseDly':{value:String(ctrl.inCloseDly)},
    'inPlgDrop':{value:String(ctrl.inPlgDrop)}, 'inMandatory':{value:String(ctrl.inMandatory)},
    'inMaxShutIn':{value:String(ctrl.inMaxShutIn)}, 'inDeviationAngle':{value:'0'},
    'chkOpenCsg':{checked:false}, 'inOpenCsgVal':{value:'9999'},
    'chkOpenDiff':{checked:false}, 'inOpenDiffVal':{value:'0'},
    'chkOpenLoad':{checked:false}, 'inOpenLoadVal':{value:'0'},
    'chkOpenOffTime':{checked:true}, 'inOpenOffTimeVal':{value:String(ctrl.openOffTime)},
    'chkOpenArmedTime':{checked:false}, 'inOpenArmedTimeVal':{value:'9999'},
    'chkOpenTubing':{checked:false}, 'inOpenTubingVal':{value:'9999'},
    'chkOpenTbgLine':{checked:false}, 'inOpenTbgLineVal':{value:'9999'},
    'chkCloseFlow':{checked: ctrl.closeFlow > 0}, 'inCloseFlowVal':{value:String(ctrl.closeFlow)},
    'chkCloseDP':{checked:false}, 'inCloseDPVal':{value:'0'},
    'chkCloseOnTime':{checked:false}, 'inCloseOnTimeVal':{value:'9999'},
    'chkCloseCasing':{checked:false}, 'inCloseCasingVal':{value:'0'},
    'chkCloseTubing':{checked:false}, 'inCloseTubingVal':{value:'0'},
    'chkCloseCsgTbg':{checked:false}, 'inCloseCsgTbgVal':{value:'9999'},
    'chkCloseCsgLine':{checked:false}, 'inCloseCsgLineVal':{value:'0'},
    'speedSelect':{value:'60'}, 'chartViewSelect':{value:'1440'}
  };
  for (const [k,o] of Object.entries(d)) els[k]=mk(o);
  return id => (els[id] || (els[id]=mk({})));
}

let CORE = 'function logEvent(){}function renderStatus(){}function updateArrivalsTable(){}function logCycleSummary(){}function updateUI(){}function drawChart(){}function updateChart(){}function drawWellbore(){}function showInstructions(){}function captureOpeningData(){}function captureClosingData(){}function updateCycleTable(){}function updateDailySummary(){}\n';
for (const f of ['config.js','physics.js','controller.js','simulation.js'])
  CORE += fs.readFileSync(path.join(BASE,f),'utf-8')+'\n';

function run(well, ctrl, hours) {
  const setup = `
COMPLETION_TYPE='${well.COMPLETION_TYPE}';
WELL_DEPTH=${well.WELL_DEPTH}; RESERVOIR_PRESSURE=${well.RESERVOIR_PRESSURE};
WELL_CHARACTERISTICS={liquidGasRatio:${well.liquidGasRatio},IPR_C:${well.IPR_C},IPR_n:${well.IPR_n}};
P_LINE_BASE=${well.P_LINE_BASE}; V_STORE_FT3=${well.V_STORE_FT3}; V_FALL_REF=${well.V_FALL_REF};
VALVE_CV=${well.VALVE_CV}; AFTERFLOW_INFLOW_FACTOR=${well.AFTERFLOW_INFLOW_FACTOR};
TUBING_AREA_FT2=${well.TUBING_AREA_FT2}; TUBING_ID_FT=${well.TUBING_ID_FT};
FT_PER_BBL=${well.FT_PER_BBL}; LIQUID_PSI_PER_BBL=${well.LIQUID_PSI_PER_BBL};
TUBING_VOLUME_FT3=TUBING_AREA_FT2*WELL_DEPTH; PLUNGER_GAS_DRAG_ACTIVE=${well.plungerGasDrag};
P_line=P_LINE_BASE; P_tubing=${well.INITIAL.P_tubing}; P_casing=${well.INITIAL.P_casing};
liquidInTubing=${well.INITIAL.liquidInTubing}; liquidAbovePlunger=${well.INITIAL.liquidInTubing}; liquidBelowPlunger=0;
liquidColumnPsi=liquidAbovePlunger*LIQUID_PSI_PER_BBL; Pwf=0;
state='ARMED_SHUTIN'; stateTimer=0; PlungerDepth=WELL_DEPTH; PlungerVel=0; FlowRate=0;
totalOnTime=0; totalOffTime=0; totalShutInMins=0;

var N=${hours*60};
var arrivals=0, nonArrivals=0, stallTicks=0, maxLiq=0, maxConsec=0, prev=state, velSum=0, velN=0, liftT=null;
for (var i=0;i<N;i++){
  simTime+=1; stateTimer+=1; prev=state; updatePhysics(1); checkLogic();
  if (prev!=='LIFTING' && state==='LIFTING') liftT=simTime;
  if (prev==='LIFTING' && state==='AFTERFLOW'){ arrivals++; if(liftT){var rt=simTime-liftT; if(rt>0){velSum+=WELL_DEPTH/rt; velN++;}} }
  if (prev==='LIFTING' && state==='MANDATORY_SHUTIN') nonArrivals++;
  if (typeof isStalled!=='undefined' && isStalled) stallTicks++;
  if (liquidInTubing>maxLiq) maxLiq=liquidInTubing;
  if (typeof consecutiveFailures!=='undefined' && consecutiveFailures>maxConsec) maxConsec=consecutiveFailures;
}
({
  cycles: completedCycleCount||0,
  prodMcf: totalProductionMcf||0,
  liqBbl: totalLiquidProducedBbl||0,
  arrivals: arrivals, nonArrivals: nonArrivals, stallTicks: stallTicks,
  maxLiqInTubing: maxLiq, maxConsecFail: maxConsec,
  avgVel: velN? velSum/velN : 0,
  finalState: state, days: ${hours}/24
});`;
  const sb = { document:{getElementById:buildDOM(ctrl)}, console:{log(){},warn(){},error(){}},
    Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity, undefined, setInterval:()=>0, clearInterval:()=>{} };
  vm.createContext(sb);
  return vm.runInContext(CORE+setup, sb, {timeout:30000});
}

function row(label, r) {
  const perDay = (r.prodMcf / r.days);
  const bblDay = (r.liqBbl / r.days);
  console.log(
    label.padEnd(34) +
    String(r.arrivals).padStart(5) +
    String(r.nonArrivals).padStart(7) +
    perDay.toFixed(0).padStart(10) +
    bblDay.toFixed(2).padStart(8) +
    r.avgVel.toFixed(0).padStart(8) +
    r.maxLiqInTubing.toFixed(2).padStart(9) +
    ('  ' + r.finalState)
  );
}
function header(title) {
  console.log('\n=== ' + title + ' ===');
  console.log('scenario'.padEnd(34)+'arvls'.padStart(5)+'nonArv'.padStart(7)+'Mcf/day'.padStart(10)+'bbl/d'.padStart(8)+'vel'.padStart(8)+'maxLiq'.padStart(9)+'  final');
}

const HRS = 72;

// ---- WELL A scenarios ----
header('WELL A — baseline + stress (72h each)');
row('baseline (off50, close650)', run(WELL_A, {...CTRL_A}, HRS));
row('open too early (off-time 5)', run(WELL_A, {...CTRL_A, openOffTime:5}, HRS));
row('starve buildup (maxShutIn 8)', run(WELL_A, {...CTRL_A, openOffTime:9999, inMaxShutIn:8}, HRS));
row('drop timer too short (drop 2)', run(WELL_A, {...CTRL_A, inPlgDrop:2}, HRS));
row('close instantly (closeFlow 5000)', run(WELL_A, {...CTRL_A, closeFlow:5000}, HRS));
row('never close (closeFlow 0,maxAft1440)', run(WELL_A, {...CTRL_A, closeFlow:0, inMaxAft:1440}, HRS));
row('very short afterflow (maxAft 20)', run(WELL_A, {...CTRL_A, inMaxAft:20}, HRS));
row('long shut-in (off-time 240)', run(WELL_A, {...CTRL_A, openOffTime:240, inMaxShutIn:300}, HRS));
// Genuinely dangerous: arm blind (drop 2) AND force open at 5 min — plunger still falling
row('blind-arm open mid-fall (drop2,SI5)', run(WELL_A, {...CTRL_A, inPlgDrop:2, openOffTime:9999, inMaxShutIn:5}, HRS));

// ---- WELL B scenarios ----
header('WELL B — baseline + stress (72h each)');
row('baseline (off90, close1600)', run(WELL_B, {...CTRL_B}, HRS));
row('open too early (off-time 5)', run(WELL_B, {...CTRL_B, openOffTime:5}, HRS));
row('starve buildup (maxShutIn 8)', run(WELL_B, {...CTRL_B, openOffTime:9999, inMaxShutIn:8}, HRS));
row('drop timer too short (drop 2)', run(WELL_B, {...CTRL_B, inPlgDrop:2}, HRS));
row('never close (closeFlow 0,maxAft1440)', run(WELL_B, {...CTRL_B, closeFlow:0, inMaxAft:1440}, HRS));
row('very short afterflow (maxAft 20)', run(WELL_B, {...CTRL_B, inMaxAft:20}, HRS));

// ---- WELL A optimization sweep: off-time x close-flow ----
console.log('\n=== WELL A — optimization sweep: Mcf/day ===');
const offs = [20, 35, 50, 70, 90, 120];
const closes = [450, 550, 650, 750];
let best = {mcf:0};
process.stdout.write('off-time\\close'.padEnd(15));
closes.forEach(c => process.stdout.write(('cf' + c).padStart(9)));
console.log();
for (const off of offs) {
  process.stdout.write(String(off).padEnd(15));
  for (const cf of closes) {
    const r = run(WELL_A, {...CTRL_A, openOffTime:off, closeFlow:cf}, 48);
    const mcfDay = r.prodMcf / (48/24);
    process.stdout.write(mcfDay.toFixed(0).padStart(9));
    if (mcfDay > best.mcf && r.nonArrivals === 0) best = {mcf:mcfDay, off, cf, vel:r.avgVel};
  }
  console.log();
}
console.log(`\nBest sustainable (0 non-arrivals): ${best.mcf.toFixed(0)} Mcf/day @ off-time=${best.off}, close-flow=${best.cf}, vel=${best.vel?best.vel.toFixed(0):'?'} ft/min`);
console.log(`Baseline reference: off-time=50, close-flow=650`);
