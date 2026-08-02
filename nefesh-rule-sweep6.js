'use strict';
// Testing the refined Infinite-entry idea: instead of an exact landing
// (current rules) or any overshoot winning (easyInfiniteEntry, which
// overshot the target the other way, to 69% Infinite), this allows landing
// on either of the last 2 progress values before/at completing the lap
// (which correspond to the hub square right before home, and home itself -
// physically the same spot as "the Infinite"), plus caps the Soul from
// passing the Infinite threshold at all before its own Body is captured.
//
//   node nefesh-rule-sweep6.js [gamesPerConfig] [iterations]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES = parseInt(process.argv[2] || '200', 10);
const ITERATIONS = parseInt(process.argv[3] || '100', 10);
const MAX_ROLLOUT_PLIES = 250;
const MAX_ROUNDS = 400;

function playOneGame(){
  sim.resetState();
  let s = sim.getState();
  let steps = 0;
  while(!sim.isTerminal(s) && s.round<=MAX_ROUNDS){
    if(s.dice===null){
      const roll = sim.sampleDiceRoll();
      s = sim.applyDiceRoll(s, roll.d1, roll.d2);
      continue;
    }
    const mover = mcts.getCurrentMoverPure(s);
    const legal = sim.getLegalActions(s, mover);
    if(legal.length===0){
      s = sim.cloneState(s);
      s.winner = 'draw'; s.isDraw = true; s.winType = null;
      s.winReason = `${mover} had no legal placement or move - draw.`;
      break;
    }
    const action = mcts.mctsChooseAction(s, {iterations:ITERATIONS, maxRolloutPlies:MAX_ROLLOUT_PLIES});
    s = sim.applyMove(s, action);
    steps++;
    if(steps>MAX_ROUNDS*20) break;
  }
  return s;
}

function scoreConfig(label, ruleOpts, gamesCount){
  sim.setRuleFlags({...sim.LIVE_RULES, allowLooping:false, easyInfiniteEntry:false, infiniteWindow:0, capSoulBeforeBodyCaptured:false, ...ruleOpts});
  let draws=0, infiniteWins=0, soulCaptureWins=0, errors=0;
  let noLegalActionDraws=0, eightyRoundDraws=0;
  const roundCounts = [];
  const t0 = Date.now();
  for(let i=0;i<gamesCount;i++){
    try{
      const s = playOneGame();
      roundCounts.push(s.round);
      if(s.winner==null || s.winner==='draw'){
        draws++;
        if(s.winReason && s.winReason.includes('no legal placement or move')) noLegalActionDraws++;
        else if(s.winReason && s.winReason.includes('rounds with neither Body captured')) eightyRoundDraws++;
        continue;
      }
      if(s.winType==='infinite') infiniteWins++;
      else if(s.winType==='soul_capture') soulCaptureWins++;
    } catch(e){
      errors++;
      console.log('GAME THREW AN ERROR:', e.message, e.stack);
    }
  }
  const decisive = infiniteWins+soulCaptureWins;
  const avgRounds = roundCounts.length ? roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length : NaN;
  const infinitePct = decisive ? 100*infiniteWins/decisive : NaN;
  const soulCapturePct = decisive ? 100*soulCaptureWins/decisive : NaN;
  const drawPct = 100*draws/gamesCount;
  const p = decisive ? infiniteWins/decisive : NaN;
  const se = decisive ? Math.sqrt(p*(1-p)/decisive)*100 : NaN;
  console.log(`\n--- ${label} ---`);
  console.log(`ruleOpts: ${JSON.stringify(ruleOpts)}`);
  console.log(`${gamesCount} games, avgRounds=${avgRounds.toFixed(1)}  Infinite%=${infinitePct.toFixed(1)}±${se.toFixed(1)} (n=${decisive} decisive)  Soul-capture%=${soulCapturePct.toFixed(1)}  draw%=${drawPct.toFixed(1)}  errors=${errors}`);
  console.log(`  of ${draws} draws: no-legal-action=${noLegalActionDraws}  80-round-rule=${eightyRoundDraws}`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return {label, avgRounds, infinitePct, se, soulCapturePct, drawPct, draws};
}

const CONFIGS = [
  {label:'LIVE (baseline)', rules:{}},
  {label:'window:1 + cap alone', rules:{infiniteWindow:1, capSoulBeforeBodyCaptured:true}},
  {label:'window:1 + cap + allowLooping', rules:{infiniteWindow:1, capSoulBeforeBodyCaptured:true, allowLooping:true}},
];

console.log(`=== Sweep 6 (hub-window + cap hypothesis test): ${CONFIGS.length} configs, ${GAMES} games each, ${ITERATIONS} iterations/move ===`);
const t0 = Date.now();
const results = CONFIGS.map(c => scoreConfig(c.label, c.rules, GAMES));
console.log(`\nTotal time: ${((Date.now()-t0)/1000).toFixed(1)}s`);

console.log(`\n=== Summary (± is one standard error on the Infinite% estimate) ===`);
results.forEach(r=>{
  console.log(`${r.label}: avgRounds=${r.avgRounds.toFixed(1)} Infinite%=${r.infinitePct.toFixed(1)}±${r.se.toFixed(1)} draw%=${r.drawPct.toFixed(1)}`);
});
