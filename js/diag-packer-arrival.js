// diag-packer-arrival.js — READ-ONLY diagnostic (no model changes)
// Dumps the per-tick afterflow transient (Pwf, P_tubing, FlowRate) for the first
// complete afterflow phase of Well A and Well B, so we can see the actual
// arrival-spike decay shape instead of reasoning from endpoints.
//
// Run: node Marcellus-simulator-demo-EXE/js/diag-packer-arrival.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname);

function buildMockDOM(ctrl) {
    const mockElements = {};
    function createMockElement(o) {
        return {
            value: '0', checked: false, innerText: '', innerHTML: '', textContent: '',
            classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
            style: {},
            getContext() { return {
                clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
                fillRect(){}, strokeRect(){}, fillText(){}, measureText(){ return {width:0}; },
                arc(){}, save(){}, restore(){}, translate(){}, scale(){}, setTransform(){},
                createLinearGradient(){ return { addColorStop(){} }; }
            }; },
            width: 800, height: 400,
            appendChild(){}, removeChild(){}, setAttribute(){}, getAttribute(){ return ''; },
            addEventListener(){}, ...o
        };
    }
    const defaults = Object.assign({
        'inMaxWait': {value:'30'}, 'inMinAft':{value:'5'}, 'inMaxAft':{value:'720'},
        'inCloseDly':{value:'2'}, 'inPlgDrop':{value:'42'}, 'inMandatory':{value:'0'},
        'inMaxShutIn':{value:'120'}, 'inDeviationAngle':{value:'0'},
        'chkOpenCsg':{checked:false}, 'inOpenCsgVal':{value:'999'},
        'chkOpenDiff':{checked:false}, 'inOpenDiffVal':{value:'0'},
        'chkOpenLoad':{checked:false}, 'inOpenLoadVal':{value:'0'},
        'chkOpenOffTime':{checked:true}, 'inOpenOffTimeVal':{value:'50'},
        'chkOpenArmedTime':{checked:false}, 'inOpenArmedTimeVal':{value:'60'},
        'chkOpenTubing':{checked:false}, 'inOpenTubingVal':{value:'999'},
        'chkOpenTbgLine':{checked:false}, 'inOpenTbgLineVal':{value:'0'},
        'chkCloseFlow':{checked:true}, 'inCloseFlowVal':{value:'650'},
        'chkCloseDP':{checked:false}, 'inCloseDPVal':{value:'0'},
        'chkCloseOnTime':{checked:false}, 'inCloseOnTimeVal':{value:'180'},
        'chkCloseCasing':{checked:false}, 'inCloseCasingVal':{value:'0'},
        'chkCloseTubing':{checked:false}, 'inCloseTubingVal':{value:'0'},
        'chkCloseCsgTbg':{checked:false}, 'inCloseCsgTbgVal':{value:'0'},
        'chkCloseCsgLine':{checked:false}, 'inCloseCsgLineVal':{value:'0'},
        'speedSelect':{value:'60'}, 'chartViewSelect':{value:'1440'}
    }, ctrl);
    for (const [id, o] of Object.entries(defaults)) mockElements[id] = createMockElement(o);
    return function(id) {
        if (!mockElements[id]) mockElements[id] = createMockElement();
        return mockElements[id];
    };
}

function runWell(name, CAL, ctrl) {
    let combined = `
function logEvent(){} function renderStatus(){} function updateArrivalsTable(){}
function logCycleSummary(){} function updateUI(){} function drawChart(){}
function updateChart(){} function drawWellbore(){} function showInstructions(){}
function captureOpeningData(){} function captureClosingData(){} function updateCycleTable(){}
function updateDailySummary(){}
`;
    for (const f of ['config.js','physics.js','controller.js','simulation.js']) {
        combined += `\n// --- ${f} ---\n` + fs.readFileSync(path.join(BASE, f),'utf-8') + '\n';
    }
    combined += `
COMPLETION_TYPE = 'packer';
var __C = ${JSON.stringify(CAL)};
WELL_DEPTH=__C.WELL_DEPTH; RESERVOIR_PRESSURE=__C.RESERVOIR_PRESSURE;
WELL_CHARACTERISTICS={liquidGasRatio:__C.liquidGasRatio,IPR_C:__C.IPR_C,IPR_n:__C.IPR_n};
P_LINE_BASE=__C.P_LINE_BASE; V_STORE_FT3=__C.V_STORE_FT3; V_FALL_REF=__C.V_FALL_REF;
VALVE_CV=__C.VALVE_CV; AFTERFLOW_INFLOW_FACTOR=__C.AFTERFLOW_INFLOW_FACTOR;
if(__C.TUBING_AREA_FT2){TUBING_AREA_FT2=__C.TUBING_AREA_FT2; TUBING_ID_FT=__C.TUBING_ID_FT;
FT_PER_BBL=__C.FT_PER_BBL; LIQUID_PSI_PER_BBL=__C.LIQUID_PSI_PER_BBL;}
TUBING_VOLUME_FT3=TUBING_AREA_FT2*WELL_DEPTH;

P_line=P_LINE_BASE; P_tubing=P_line+5; P_casing=P_line;
liquidInTubing=0.3; liquidAbovePlunger=0.3; liquidBelowPlunger=0;
liquidColumnPsi=liquidAbovePlunger*LIQUID_PSI_PER_BBL; Pwf=0;
state='ARMED_SHUTIN'; stateTimer=0; PlungerDepth=WELL_DEPTH; PlungerVel=0;
FlowRate=0; totalOnTime=0; totalOffTime=0; totalShutInMins=0;

var trace=[]; var capturing=false; var afterflowTicks=0; var prevState=state;
for (var i=0; i<2000; i++){
    simTime+=1.0; stateTimer+=1.0;
    prevState=state;
    updatePhysics(1.0); checkLogic();
    // Begin capturing at the FIRST lift->afterflow arrival
    if (prevState==='LIFTING' && state==='AFTERFLOW' && !capturing){ capturing=true; afterflowTicks=0; }
    if (capturing && state==='AFTERFLOW'){
        afterflowTicks++;
        if (afterflowTicks<=20) trace.push({t:afterflowTicks, Pwf:Pwf, Ptbg:P_tubing, flow:FlowRate});
    }
    if (capturing && state!=='AFTERFLOW' && afterflowTicks>0) break;  // afterflow ended
}
({name:'${name}', line:P_LINE_BASE, trace:trace});
`;
    const sandbox = {
        document:{getElementById: buildMockDOM(ctrl)},
        console:{log(){},warn(){},error(){}},
        Math, parseFloat, parseInt, isNaN, isFinite, NaN, Infinity, undefined,
        setInterval:()=>0, clearInterval:()=>{}
    };
    vm.createContext(sandbox);
    return vm.runInContext(combined, sandbox, {timeout:60000});
}

const WELL_A = {
    WELL_DEPTH:6893, RESERVOIR_PRESSURE:650, IPR_C:0.040, IPR_n:0.8, liquidGasRatio:1.0,
    P_LINE_BASE:312, V_STORE_FT3:6000, V_FALL_REF:800, VALVE_CV:10, AFTERFLOW_INFLOW_FACTOR:1.0
};
const WELL_B = {
    WELL_DEPTH:8034, RESERVOIR_PRESSURE:1800, IPR_C:0.017, IPR_n:0.8, liquidGasRatio:0.4,
    P_LINE_BASE:990, V_STORE_FT3:8000, V_FALL_REF:1000, VALVE_CV:10, AFTERFLOW_INFLOW_FACTOR:0.98,
    TUBING_AREA_FT2:0.0325, TUBING_ID_FT:0.2034, FT_PER_BBL:172.8, LIQUID_PSI_PER_BBL:78.6
};
const CTRL_A = { 'inOpenOffTimeVal':{value:'50'}, 'inCloseFlowVal':{value:'650'}, 'inPlgDrop':{value:'42'}, 'inMaxAft':{value:'720'}, 'inCloseDly':{value:'2'} };
const CTRL_B = { 'inOpenOffTimeVal':{value:'90'}, 'inCloseFlowVal':{value:'1600'}, 'inPlgDrop':{value:'55'}, 'inMaxAft':{value:'300'}, 'inCloseDly':{value:'10'}, 'inMaxShutIn':{value:'180'} };

for (const [nm, CAL, CTRL, trendNote] of [
    ['WELL A', WELL_A, CTRL_A, 'TREND: flow resumes ~780, NO spike; tubing flat ~325'],
    ['WELL B', WELL_B, CTRL_B, 'TREND: flow spikes >4500 then settles ~1500; tubing ~1000-1100']
]) {
    const r = runWell(nm, CAL, CTRL);
    console.log(`\n=== ${nm} — first afterflow phase (per minute) ===`);
    console.log(`Line=${r.line} psi | ${trendNote}`);
    console.log('  min |   Pwf  |  P_tbg | ΔP(tbg-line) |  Flow(Mcfd)');
    console.log('  ----+--------+--------+--------------+-----------');
    for (const s of r.trace) {
        console.log(`  ${String(s.t).padStart(3)} | ${s.Pwf.toFixed(0).padStart(6)} | ${s.Ptbg.toFixed(0).padStart(6)} | ${(s.Ptbg-r.line).toFixed(0).padStart(12)} | ${s.flow.toFixed(0).padStart(10)}`);
    }
}
