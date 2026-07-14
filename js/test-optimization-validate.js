// test-optimization-validate.js — READ-ONLY rigorous validation of the Well A
// optimization finding (off-time 90 / close-flow 450 ≈ +14%). Removes cold-start
// bias (discards day 1), checks stability over 30 days, refines the grid, and
// reports per-cycle breakdown + sustainability. NO model changes.
//
// Run: node Marcellus-simulator-demo-EXE/js/test-optimization-validate.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

const WELL_A = {
  WELL_DEPTH:6893, RESERVOIR_PRESSURE:650, liquidGasRatio:1.0, IPR_C:0.048, IPR_n:0.8,
  P_LINE_BASE:312, V_STORE_FT3:6000, V_FALL_REF:800, VALVE_CV:10, AFTERFLOW_INFLOW_FACTOR:1.0,
  TUBING_AREA_FT2:0.0217, TUBING_ID_FT:0.166, FT_PER_BBL:259, LIQUID_PSI_PER_BBL:118,
  plungerGasDrag:6.0e-4, INITIAL:{P_casing:312, P_tubing:320, liquidInTubing:0.3},
};
const CTRL_A = { inMaxWait:30, inMinAft:5, inMaxAft:720, inCloseDly:2, inPlgDrop:42,
  inMandatory:0, inMaxShutIn:600, openOffTime:50, closeFlow:650 };

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
    'inMaxWait':{value:String(ctrl.inMaxWait)},'inMinAft':{value:String(ctrl.inMinAft)},
    'inMaxAft':{value:String(ctrl.inMaxAft)},'inCloseDly':{value:String(ctrl.inCloseDly)},
    'inPlgDrop':{value:String(ctrl.inPlgDrop)},'inMandatory':{value:String(ctrl.inMandatory)},
    'inMaxShutIn':{value:String(ctrl.inMaxShutIn)},'inDeviationAngle':{value:'0'},
    'chkOpenCsg':{checked:false},'inOpenCsgVal':{value:'9999'},'chkOpenDiff':{checked:false},'inOpenDiffVal':{value:'0'},
    'chkOpenLoad':{checked:false},'inOpenLoadVal':{value:'0'},
    'chkOpenOffTime':{checked:true},'inOpenOffTimeVal':{value:String(ctrl.openOffTime)},
    'chkOpenArmedTime':{checked:false},'inOpenArmedTimeVal':{value:'9999'},
    'chkOpenTubing':{checked:false},'inOpenTubingVal':{value:'9999'},
    'chkOpenTbgLine':{checked:false},'inOpenTbgLineVal':{value:'9999'},
    'chkCloseFlow':{checked: ctrl.closeFlow>0},'inCloseFlowVal':{value:String(ctrl.closeFlow)},
    'chkCloseDP':{checked:false},'inCloseDPVal':{value:'0'},'chkCloseOnTime':{checked:false},'inCloseOnTimeVal':{value:'9999'},
    'chkCloseCasing':{checked:false},'inCloseCasingVal':{value:'0'},'chkCloseTubing':{checked:false},'inCloseTubingVal':{value:'0'},
    'chkCloseCsgTbg':{checked:false},'inCloseCsgTbgVal':{value:'9999'},'chkCloseCsgLine':{checked:false},'inCloseCsgLineVal':{value:'0'},
    'speedSelect':{value:'60'},'chartViewSelect':{value:'1440'}
  };
  for (const [k,o] of Object.entries(d)) els[k]=mk(o);
  return id => (els[id] || (els[id]=mk({})));
}

let CORE = 'function logEvent(){}function renderStatus(){}function updateArrivalsTable(){}function logCycleSummary(){}function updateUI(){}function drawChart(){}function updateChart(){}function drawWellbore(){}function showInstructions(){}function captureOpeningData(){}function captureClosingData(){}function updateCycleTable(){}function updateDailySummary(){}\n';
for (const f of ['config.js','physics.js','controller.js','simulation.js']) CORE += fs.readFileSync(path.join(BASE,f),'utf-8')+'\n';

function run(ctrl, days) {
  const w = WELL_A;
  const setup = `
COMPLETION_TYPE='packer';
WELL_DEPTH=${w.WELL_DEPTH}; RESERVOIR_PRESSURE=${w.RESERVOIR_PRESSURE};
WELL_CHARACTERISTICS={liquidGasRatio:${w.liquidGasRatio},IPR_C:${w.IPR_C},IPR_n:${w.IPR_n}};
P_LINE_BASE=${w.P_LINE_BASE}; V_STORE_FT3=${w.V_STORE_FT3}; V_FALL_REF=${w.V_FALL_REF};
VALVE_CV=${w.VALVE_CV}; AFTERFLOW_INFLOW_FACTOR=${w.AFTERFLOW_INFLOW_FACTOR};
TUBING_AREA_FT2=${w.TUBING_AREA_FT2}; TUBING_ID_FT=${w.TUBING_ID_FT};
FT_PER_BBL=${w.FT_PER_BBL}; LIQUID_PSI_PER_BBL=${w.LIQUID_PSI_PER_BBL};
TUBING_VOLUME_FT3=TUBING_AREA_FT2*WELL_DEPTH; PLUNGER_GAS_DRAG_ACTIVE=${w.plungerGasDrag};
P_line=P_LINE_BASE; P_tubing=${w.INITIAL.P_tubing}; P_casing=${w.INITIAL.P_casing};
liquidInTubing=${w.INITIAL.liquidInTubing}; liquidAbovePlunger=${w.INITIAL.liquidInTubing}; liquidBelowPlunger=0;
liquidColumnPsi=liquidAbovePlunger*LIQUID_PSI_PER_BBL; Pwf=0;
state='ARMED_SHUTIN'; stateTimer=0; PlungerDepth=WELL_DEPTH; PlungerVel=0; FlowRate=0;
totalOnTime=0; totalOffTime=0; totalShutInMins=0;

var DAYS=${days}, dailyMcf=[], lastTotal=0, arrivals=0, nonArr=0, maxLiq=0, prev=state, velSum=0, velN=0, liftT=null;
for (var d=0; d<DAYS; d++){
  for (var i=0;i<1440;i++){
    simTime+=1; stateTimer+=1; prev=state; updatePhysics(1); checkLogic();
    if (prev!=='LIFTING' && state==='LIFTING') liftT=simTime;
    if (prev==='LIFTING' && state==='AFTERFLOW'){ arrivals++; if(liftT){var rt=simTime-liftT; if(rt>0){velSum+=WELL_DEPTH/rt; velN++;}} }
    if (prev==='LIFTING' && state==='MANDATORY_SHUTIN') nonArr++;
    if (liquidInTubing>maxLiq) maxLiq=liquidInTubing;
  }
  dailyMcf.push((totalProductionMcf||0) - lastTotal);
  lastTotal = totalProductionMcf||0;
}
({ dailyMcf, arrivals, nonArr, maxLiq, avgVel: velN? velSum/velN:0, cyclesPerDay: arrivals/DAYS });`;
  const sb = { document:{getElementById:buildDOM(ctrl)}, console:{log(){},warn(){},error(){}},
    Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity, undefined, setInterval:()=>0, clearInterval:()=>{} };
  vm.createContext(sb);
  return vm.runInContext(CORE+setup, sb, {timeout:60000});
}

function steady(r) { // mean daily Mcf excluding day 1 (cold-start)
  const d = r.dailyMcf.slice(1);
  return d.reduce((a,b)=>a+b,0)/d.length;
}
function spread(r) { const d=r.dailyMcf.slice(1); return {min:Math.min(...d), max:Math.max(...d)}; }

console.log('=== VALIDATION 1: cold-start removed, 30-day steady-state ===');
console.log('config'.padEnd(28)+'day1'.padStart(8)+'steady/d'.padStart(10)+'range(d2-30)'.padStart(16)+'cyc/d'.padStart(7)+'nonArr'.padStart(7)+'vel'.padStart(6));
for (const [lbl, ctrl] of [
  ['baseline off50/close650', {...CTRL_A}],
  ['candidate off90/close450', {...CTRL_A, openOffTime:90, closeFlow:450}],
]) {
  const r = run(ctrl, 30);
  const s = steady(r), sp = spread(r);
  console.log(lbl.padEnd(28)+r.dailyMcf[0].toFixed(0).padStart(8)+s.toFixed(0).padStart(10)
    +`${sp.min.toFixed(0)}-${sp.max.toFixed(0)}`.padStart(16)+r.cyclesPerDay.toFixed(1).padStart(7)
    +String(r.nonArr).padStart(7)+r.avgVel.toFixed(0).padStart(6));
}

console.log('\n=== VALIDATION 2: stability across run length (steady/day) ===');
console.log('config'.padEnd(28)+'7d'.padStart(8)+'14d'.padStart(8)+'30d'.padStart(8));
for (const [lbl, ctrl] of [
  ['baseline off50/close650', {...CTRL_A}],
  ['candidate off90/close450', {...CTRL_A, openOffTime:90, closeFlow:450}],
]) {
  const r7=run(ctrl,7), r14=run(ctrl,14), r30=run(ctrl,30);
  console.log(lbl.padEnd(28)+steady(r7).toFixed(0).padStart(8)+steady(r14).toFixed(0).padStart(8)+steady(r30).toFixed(0).padStart(8));
}

console.log('\n=== VALIDATION 3: fine grid around optimum (30-day steady/day) ===');
const offs=[50,70,90,110,130], closes=[400,450,550];
process.stdout.write('off\\close'.padEnd(10)); closes.forEach(c=>process.stdout.write(('cf'+c).padStart(8))); console.log();
let best={mcf:0};
for (const off of offs){
  process.stdout.write(String(off).padEnd(10));
  for (const cf of closes){
    const r=run({...CTRL_A, openOffTime:off, closeFlow:cf}, 30);
    const s=steady(r);
    process.stdout.write(s.toFixed(0).padStart(8));
    if (s>best.mcf && r.nonArr===0) best={mcf:s, off, cf, vel:r.avgVel, cyc:r.cyclesPerDay};
  }
  console.log();
}
const baseR = run({...CTRL_A}, 30); const baseS = steady(baseR);
console.log(`\nBaseline steady (30d, off50/close650): ${baseS.toFixed(0)} Mcf/day`);
console.log(`Best steady (0 non-arr): ${best.mcf.toFixed(0)} Mcf/day @ off${best.off}/close${best.cf}, ${best.cyc.toFixed(1)} cyc/d, ${best.vel.toFixed(0)} ft/min`);
console.log(`Uplift: ${((best.mcf/baseS-1)*100).toFixed(1)}%`);
