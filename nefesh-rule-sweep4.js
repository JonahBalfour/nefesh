'use strict';
// Big confirmation run: the last few 60-game batches showed the LIVE
// baseline itself swinging 30% -> 41% -> 48% on Infinite-win-rate across
// identical repeated measurements - too noisy to trust any conclusion about
// win-path balance at that sample size. This runs 200 games/config instead
// of 60 (~3.3x), specifically to get a trustworthy read on:
//   - LIVE baseline (stable reference point)
//   - allowLooping alone (already confirmed to kill draws - checking its
//     real win-path number without 60-game noise)
//   - soulBonus:2 alone, no allowLooping (isolates whether soulBonus really
//     helps win-path balance on its own)
//   - allowLooping + soulBonus:2 together (does the combination help,
//     hurt, or cancel out - the 60-game run suggested "hurt", unclear if
//     that was real or noise)
//
//   node nefesh-rule-sweep4.js [gamesPerConfig] [iterations]

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
    if((i+1)%25===0) process.stdout.write(`  [${label}] ${i+1}/${gamesCount}\r\n`);
  }
  const decisive = infiniteWins+soulCaptureWins;
  const avgRounds = roundCounts.length ? roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length : NaN;
  const infinitePct = decisive ? 100*infiniteWins/decisive : NaN;
  const soulCapturePct = decisive ? 100*soulCaptureWins/decisive : NaN;
  const drawPct = 100*draws/gamesCount;
  // Wilson-ish quick standard error estimate for the Infinite% proportion,
  // over decisive games only, so the reader can see how much to trust it.
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
  {label:'allowLooping:true alone', rules:{allowLooping:true}},
  {label:'soulBonus:2 alone (no looping)', rules:{soulBonus:2}},
  {label:'allowLooping:true + soulBonus:2', rules:{allowLooping:true, soulBonus:2}},
];

console.log(`=== Sweep 4 (big confirmation run): ${CONFIGS.length} configs, ${GAMES} games each, ${ITERATIONS} iterations/move ===`);
const t0 = Date.now();
const results = CONFIGS.map(c => scoreConfig(c.label, c.rules, GAMES));
console.log(`\nTotal time: ${((Date.now()-t0)/1000).toFixed(1)}s`);

console.log(`\n=== Summary (± is one standard error on the Infinite% estimate) ===`);
results.forEach(r=>{
  console.log(`${r.label}: avgRounds=${r.avgRounds.toFixed(1)} Infinite%=${r.infinitePct.toFixed(1)}±${r.se.toFixed(1)} draw%=${r.drawPct.toFixed(1)}`);
});
