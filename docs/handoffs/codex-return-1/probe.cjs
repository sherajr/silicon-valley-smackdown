const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Usage: node probe.cjs /path/to/silicon-valley-smackdown
const root = path.resolve(process.argv[2] || process.cwd());
const ts = require(require.resolve('typescript', {paths:[root]}));
const cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = {exports:{}};
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  function req(name) {
    if (name==='phaser') return {TintModes:{FILL:1,MULTIPLY:0}};
    if (file.endsWith('/FighterView.ts') && name==='./SpriteFactory') return {};
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file),name+'.ts'));
    return require(name);
  }
  vm.runInThisContext('(function(require,module,exports){'+js+'\n})',{filename:file})(req,mod,mod.exports);
  return mod.exports;
}
const {CombatSim}=load('src/sim/CombatSim.ts');
const {HUNTER}=load('src/data/characters/hunter.ts');
const {KEVIN}=load('src/data/characters/kevin.ts');
const {neutralFrameInput}=load('src/sim/types.ts');
const {FighterView}=load('src/render/FighterView.ts');
function simFor(hunter=HUNTER) {
  const s=new CombatSim({p1Def:hunter,p2Def:KEVIN,powerupsEnabled:false,seed:1});
  Object.assign(s.p1,{x:200,state:'idle',stateTimer:0,introDone:true});
  Object.assign(s.p2,{x:239,state:'idle',stateTimer:0,introDone:true});
  return s;
}
function viewFor() {
  const v=Object.create(FighterView.prototype);
  const no=()=>{};
  Object.assign(v,{lastState:null,stateElapsedMs:0,blockImpactMs:0,flashTimer:0,paletteTint:null,currentKey:'',sprite:{setFlipX:no,setTint:no,setTintMode:no,clearTint:no},shadow:{setScale:no,setAlpha:no},visuals:{blockFrames:['block0','block1'],crouchFrames:['crouch0','crouch1'],hitstunFrames:['hitstun0','hitstun1'],knockdownFrames:['down0','down1'],wakeupFrames:['wake0','wake1'],jumpFrames:['rise','apex','fall'],idleAnim:'idle',walkAnim:'walk'}});
  v.setFrame=(key)=>{v.selected=key};v.playAnim=(key)=>{v.selected=key};
  return v;
}
const results={scope:'Actual current CombatSim and FighterView methods; Phaser drawing is mocked. No browser-input, live-play, or audible QA claimed.'};
for (const low of [false,true]) {
  const s=simFor();let e;
  for(let i=0;i<20;i++) {
    const a=neutralFrameInput(); if(i===0){a.basicPressed=true;a.basicHeld=true;}
    const b=neutralFrameInput();b.blockHeld=true;b.down=low;
    const ev=s.step(a,b); e=ev.find(x=>x.type==='blocked');if(e)break;
  }
  const v=viewFor();v.update(s.p2,0,false,1000/60);
  results[low?'crouchBlock':'standingBlock']={event:e,state:s.p2.state,selectedFrame:v.selected,blockImpactTimer:v.blockImpactMs};
}
{
 const s=simFor();const v=viewFor(); Object.assign(s.p2,{state:'hitstun',stateTimer:20});s.freezeFrames=9;
 v.update(s.p2,0,true,1000/60);const before={simFrame:s.frameCount,stateTimer:s.p2.stateTimer,selected:v.selected};
 for(let i=0;i<9;i++){s.step(neutralFrameInput(),neutralFrameInput());v.update(s.p2,0,false,1000/60);}
 results.freezeClock={before,after:{simFrame:s.frameCount,stateTimer:s.p2.stateTimer,selected:v.selected,elapsedMs:v.stateElapsedMs}};
 v.stateElapsedMs=180;v.lastState='hitstun';s.p2.state='hitstun';s.p2.stateTimer=20;v.update(s.p2,0,true,1000/60);
 results.repeatHit={state:s.p2.state,selected:v.selected,elapsedMs:v.stateElapsedMs};
}
function chain(hunter) {
 const s=simFor(hunter);let requests=0;const events=[];
 for(let wall=0;wall<150;wall++){
  const a=neutralFrameInput();if(requests<3 && s.p1.state==='idle' && s.freezeFrames===0){a.basicPressed=true;a.basicHeld=true;requests++;}
  for(const e of s.step(a,neutralFrameInput())) if(['moveStarted','hit'].includes(e.type)) events.push({wallFrame:wall,simFrame:s.frameCount,distance:+Math.abs(s.p2.x-s.p1.x).toFixed(3),...e});
 }
 return {healthLost:KEVIN.maxHealth-s.p2.health,events};
}
results.baselineString=chain(HUNTER);
const candidate=structuredClone(HUNTER);
candidate.moves.basic1.hits[0].effect.knockback.x=1.5;
candidate.moves.basic2.hits[0].effect.knockback.x=1.8;
results.candidateString=chain(candidate);
results.nominalHitFlashMs={hz60:4*1000/60,hz144:4*1000/144};
console.log(JSON.stringify(results,null,2));
