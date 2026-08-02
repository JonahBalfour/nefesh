'use strict';
// Confirmation run (spec §7 step 5, follow-up to nefesh-rule-sweep.js): the
// sweep's 15-games/combo pass was fast but noisy. This re-runs just the
// promising candidates it surfaced, plus the current live ruleset for
// comparison, at a much bigger sample so the comparison is actually
// trustworthy before anyone decides anything from it.
//
//   node nefesh-rule-confirm.js [gamesPerCombo] [iterations]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES_PER_COMBO = parseInt(process.argv[2] || '60', 10);
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
      break;
    }
    const action = mcts.mctsChooseAction(s, {iterations:ITERATIONS, maxRolloutPlies:MAX_ROLLOUT_PLIES});
    s = sim.applyMove(s, action);
    steps++;
    if(steps>MAX_ROUNDS*20) break;
  }
  return {winner: sim.getWinner(s), winType: sim.getWinType(s), rounds: s.round};
}

function scoreRuleset(label, ruleOpts, gamesCount){
  sim.setRuleFlags(ruleOpts);
  let draws=0, infiniteWins=0, soulCaptureWins=0, errors=0;
  const roundCounts = [];
  const t0 = Date.now();
  for(let i=0;i<gamesCount;i++){
    try{
      const r = playOneGame();
      roundCounts.push(r.rounds);
      if(r.winner==null || r.winner==='draw'){ draws++; continue; }
      if(r.winType==='infinite') infiniteWins++;
      else if(r.winType==='soul_capture') soulCaptureWins++;
    } catch(e){
      errors++;
      console.log('GAME THREW AN ERROR:', e.message);
    }
  }
  const decisive = infiniteWins+soulCaptureWins;
  roundCounts.sort((a,b)=>a-b);
  const avgRounds = roundCounts.length ? roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length : NaN;
  const median = roundCounts.length ? roundCounts[Math.floor(roundCounts.length/2)] : NaN;
  const infinitePct = decisive ? 100*infiniteWins/decisive : NaN;
  const soulCapturePct = decisive ? 100*soulCaptureWins/decisive : NaN;
  const drawPct = 100*draws/gamesCount;
  console.log(`\n--- ${label}: ${JSON.stringify(ruleOpts)} ---`);
  console.log(`${gamesCount} games, avgRounds=${avgRounds.toFixed(1)} (median ${median})  Infinite%=${infinitePct.toFixed(1)}  Soul-capture%=${soulCapturePct.toFixed(1)}  draw%=${drawPct.toFixed(1)}  errors=${errors}`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return {label, ruleOpts, avgRounds, median, infinitePct, soulCapturePct, drawPct, errors};
}

const CANDIDATES = [
  {label:'LIVE (current shipped ruleset)', rules:{diceMenu:'sum-only', bonusMode:'fixed', preplaceRace:true, placeAndMove:'off'}},
  {label:'#1 no-diff/flex/no-preplace/off', rules:{diceMenu:'no-diff', bonusMode:'flex', preplaceRace:false, placeAndMove:'off'}},
  {label:'#2 sum-only/flex/preplace/optional', rules:{diceMenu:'sum-only', bonusMode:'flex', preplaceRace:true, placeAndMove:'optional'}},
  {label:'#3 no-diff/fixed/no-preplace/mandatory', rules:{diceMenu:'no-diff', bonusMode:'fixed', preplaceRace:false, placeAndMove:'mandatory'}},
  {label:'#4 full/fixed/no-preplace/optional', rules:{diceMenu:'full', bonusMode:'fixed', preplaceRace:false, placeAndMove:'optional'}},
  {label:'#5 no-diff/fixed/no-preplace/off', rules:{diceMenu:'no-diff', bonusMode:'fixed', preplaceRace:false, placeAndMove:'off'}},
];

console.log(`=== Confirmation run: ${CANDIDATES.length} configs, ${GAMES_PER_COMBO} games each, ${ITERATIONS} MCTS iterations/move ===`);
const t0 = Date.now();
const results = CANDIDATES.map(c => scoreRuleset(c.label, c.rules, GAMES_PER_COMBO));
console.log(`\nTotal time: ${((Date.now()-t0)/1000).toFixed(1)}s`);

console.log(`\n=== Summary (sorted by distance from targets: 50 rounds, 50/50 win-path) ===`);
const ranked = [...results].sort((a,b)=>{
  const gapA = Math.abs(a.avgRounds-50)/50 + Math.abs(a.infinitePct-50)/50 + a.drawPct/100;
  const gapB = Math.abs(b.avgRounds-50)/50 + Math.abs(b.infinitePct-50)/50 + b.drawPct/100;
  return gapA-gapB;
});
ranked.forEach((r,i)=>{
  console.log(`${i+1}. ${r.label}: avgRounds=${r.avgRounds.toFixed(1)} Infinite%=${r.infinitePct.toFixed(1)} draw%=${r.drawPct.toFixed(1)}`);
});
