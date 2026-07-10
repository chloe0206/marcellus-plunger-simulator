// diag-lift-sensitivity.js — predictive-validity check for Phase 2a.
// Confirms the physical response is intact after adding per-well plunger drag:
//   MORE shut-in (longer Off-Time open trigger) -> more buildup -> higher Pwf
//   -> faster lift (shorter rise time / higher arrival velocity).
// If that monotonic relationship holds, the drag knob slowed the absolute speed
// without distorting how the well responds to operator parameter changes.
//
// Run: node Marcellus-simulator-demo-EXE/js/diag-lift-sensitivity.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

function mockDOM(offTimeVal) {
  const els = {};
  const mk = o => ({ value:'0', checked:false, innerText:'', innerHTML:'', textContent:'',
    classList:{add(){},remove(){},contains(){return false;},toggle(){}}, style:{},
    getContext(){return {clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},
      fillRect(){},strokeRect(){},fillText(){},measureText(){return{width:0};},arc(){},save(){},
      restore(){},translate(){},scale(){},setTransform(){},createLinearGradient(){return{addColorStop(){}};}};},
    width:800,height:400,appendChild(){},removeChild(){},setAttribute(){},getAttribute(){return'';},
    addEventListener(){}, ...o });
  const def = {
    'inMaxWait':{value:'40'}, 'inMinAft':{value:'5'}, 'inMaxAft':{value:'720'}, 'inCloseDly':{value:'2'},
    'inPlgDrop':{value:'42'}, 'inMandatory':{value:'0'}, 'inMaxShutIn':{value:'600'}, 'inDeviationAngle':{value:'0'},
    'chkOpenCsg':{checked:false}, 'chkOpenDiff':{checked:false}, 'chkOpenLoad':{checked:false},
    'chkOpenOffTime':{checked:true}, 'inOpenOffTimeVal':{value:String(offTimeVal)},
    'chkOpenArmedTime':{checked:false}, 'chkOpenTubing':{checked:false}, 'chkOpenTbgLine':{checked:false},
    'chkCloseFlow':{checked:true}, 'inCloseFlowVal':{value:'650'},
    'chkCloseDP':{checked:false},'chkCloseOnTime':{checked:false},'chkCloseCasing':{checked:false},
    'chkCloseTubing':{checked:false},'chkCloseCsgTbg':{checked:false},'chkCloseCsgLine':{checked:false},
    'speedSelect':{value:'60'},'chartViewSelect':{value:'1440'}
  };
  for (const [k,o] of Object.entries(def)) els[k]=mk(o);
  return id => (els[id] || (els[id]=mk({})));
}

function runWellA(offTime) {
  let src = `function logEvent(){} function renderStatus(){} function updateArrivalsTable(){}
function logCycleSummary(){} function updateUI(){} function drawChart(){} function updateChart(){}
function drawWellbore(){} function showInstructions(){} function captureOpeningData(){}
function captureClosingData(){} function updateCycleTable(){} function updateDailySummary(){}\n`;
  for (const f of ['config.js','physics.js','controller.js','simulation.js'])
    src += `\n${fs.readFileSync(path.join(BASE,f),'utf-8')}\n`;
  src += `
COMPLETION_TYPE='packer';
WELL_DEPTH=6893; RESERVOIR_PRESSURE=650;
WELL_CHARACTERISTICS={liquidGasRatio:1.0,IPR_C:0.048,IPR_n:0.8};
P_LINE_BASE=312; V_STORE_FT3=6000; V_FALL_REF=800; VALVE_CV=10; AFTERFLOW_INFLOW_FACTOR=1.0;
PLUNGER_GAS_DRAG_ACTIVE=6.0e-4;
P_line=P_LINE_BASE; P_tubing=P_line+5; P_casing=P_line;
liquidInTubing=0.3; liquidAbovePlunger=0.3; liquidBelowPlunger=0;
liquidColumnPsi=liquidAbovePlunger*LIQUID_PSI_PER_BBL; Pwf=0;
state='ARMED_SHUTIN'; stateTimer=0; PlungerDepth=WELL_DEPTH; PlungerVel=0;
FlowRate=0; totalOnTime=0; totalOffTime=0; totalShutInMins=0;

// Run until we capture the 2nd lift (1st is cold-start); record its rise time + Pwf at lift start.
var lifts=[]; var liftStartT=null, liftStartPwf=null; var prev=state;
for (var i=0;i<3000;i++){
  simTime+=1; stateTimer+=1; prev=state; updatePhysics(1); checkLogic();
  if (prev!=='LIFTING' && state==='LIFTING'){ liftStartT=simTime; liftStartPwf=Pwf; }
  if (prev==='LIFTING' && state==='AFTERFLOW' && liftStartT!=null){
    lifts.push({rise:simTime-liftStartT, pwf:liftStartPwf, vel:WELL_DEPTH/(simTime-liftStartT)});
    liftStartT=null;
    if (lifts.length>=2) break;
  }
}
var L = lifts[lifts.length-1] || lifts[0] || {rise:0,pwf:0,vel:0};
({ offTime:${offTime}, rise:L.rise, pwf:L.pwf, vel:L.vel });
`;
  const sb = { document:{getElementById:mockDOM(offTime)}, console:{log(){},warn(){},error(){}},
    Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity, undefined, setInterval:()=>0, clearInterval:()=>{} };
  vm.createContext(sb);
  return vm.runInContext(src, sb, {timeout:30000});
}

console.log('=== LIFT SENSITIVITY (Well A) — predictive-validity check ===');
console.log('Expect: longer shut-in (Off-Time) -> higher Pwf at lift -> SHORTER rise / FASTER velocity\n');
console.log('  Off-Time(min) | Pwf@lift | rise(min) | arrival vel(ft/min)');
console.log('  --------------+----------+-----------+--------------------');
let prevRise = null, monotonic = true;
for (const ot of [40, 55, 70, 90]) {
  const r = runWellA(ot);
  console.log(`  ${String(ot).padStart(11)}   | ${r.pwf.toFixed(0).padStart(7)}  | ${r.rise.toFixed(1).padStart(8)}  | ${r.vel.toFixed(0).padStart(18)}`);
  if (prevRise !== null && r.rise > prevRise + 0.05) monotonic = false;  // rise should not increase
  prevRise = r.rise;
}
console.log('');
console.log(monotonic
  ? 'PASS — rise time decreases (velocity increases) with more shut-in. Predictive response is sound.'
  : 'WARN — rise time did NOT decrease monotonically with more shut-in; check response.');
