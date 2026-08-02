'use strict';
// Combined test: allowLooping eliminated draws but didn't help win-path
// balance; soulBonus (1-3) helped win-path balance but made draws worse.
// This tests whether combining allowLooping:true with a few soulBonus
// values gets both benefits at once - checked against the LIVE baseline and
// allowLooping alone as reference points.
//
//   node nefesh-rule-sweep3.js [gamesPerConfig] [iterations]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES = parseInt(process.argv[2] || '60', 10);
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
  sim.setRuleFlags({...sim.LIVE_RULES, allowLooping:false, soulBonus:0, ...ruleOpts});
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
      console.log('GAME THREW AN ERROR:', e.message);
    }
  }
  const decisive = infiniteWins+soulCaptureWins;
  const avgRounds = roundCounts.length ? roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length : NaN;
  const infinitePct = decisive ? 100*infiniteWins/decisive : NaN;
  const soulCapturePct = decisive ? 100*soulCaptureWins/decisive : NaN;
  const drawPct = 100*draws/gamesCount;
  console.log(`\n--- ${label} ---`);
  console.log(`ruleOpts: ${JSON.stringify(ruleOpts)}`);
  console.log(`${gamesCount} games, avgRounds=${avgRounds.toFixed(1)}  Infinite%=${infinitePct.toFixed(1)}  Soul-capture%=${soulCapturePct.toFixed(1)}  draw%=${drawPct.toFixed(1)}  errors=${errors}`);
  console.log(`  of ${draws} draws: no-legal-action=${noLegalActionDraws} (${draws?(100*noLegalActionDraws/draws).toFixed(0):0}%)  80-round-rule=${eightyRoundDraws} (${draws?(100*eightyRoundDraws/draws).toFixed(0):0}%)`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return {label, avgRounds, infinitePct, soulCapturePct, drawPct, draws};
}

const CONFIGS = [
  {label:'LIVE (baseline)', rules:{}},
  {label:'allowLooping:true alone', rules:{allowLooping:true}},
  {label:'allowLooping:true + soulBonus:1', rules:{allowLooping:true, soulBonus:1}},
  {label:'allowLooping:true + soulBonus:2', rules:{allowLooping:true, soulBonus:2}},
  {label:'allowLooping:true + soulBonus:3', rules:{allowLooping:true, soulBonus:3}},
];

console.log(`=== Sweep 3 (combined test): ${CONFIGS.length} configs, ${GAMES} games each, ${ITERATIONS} iterations/move ===`);
const t0 = Date.now();
const results = CONFIGS.map(c => scoreConfig(c.label, c.rules, GAMES));
console.log(`\nTotal time: ${((Date.now()-t0)/1000).toFixed(1)}s`);

console.log(`\n=== Summary ===`);
results.forEach(r=>{
  console.log(`${r.label}: avgRounds=${r.avgRounds.toFixed(1)} Infinite%=${r.infinitePct.toFixed(1)} draw%=${r.drawPct.toFixed(1)}`);
});
