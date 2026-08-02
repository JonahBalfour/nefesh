'use strict';
// Follow-up to the confirmation run: the four discrete knobs (dice mode,
// bonus mode, pre-placement, place-and-move) didn't move the win-path
// balance metric at all - every variant sat around 70-80% Soul-capture,
// same as live. This sweeps SOUL_BONUS_AFTER_OWN_BODY_CAPTURED instead -
// currently 0 (the Soul gets no bonus at all once its own Body is captured
// and the Infinite becomes reachable), which may be why the Infinite path
// is structurally slower than just capturing the opposing Soul directly.
// Held fixed at the LIVE ruleset's other settings so this isolates the one
// variable, since that's what's actually shipped.
//
//   node nefesh-soulbonus-sweep.js [gamesPerValue] [iterations]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES_PER_VALUE = parseInt(process.argv[2] || '60', 10);
const ITERATIONS = parseInt(process.argv[3] || '100', 10);
const MAX_ROLLOUT_PLIES = 250;
const MAX_ROUNDS = 400;

const BASE_RULES = {diceMenu:'sum-only', bonusMode:'fixed', preplaceRace:true, placeAndMove:'off'}; // matches LIVE_RULES
const SOUL_BONUS_VALUES = [0,1,2,3,4,6,8];

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

function scoreSoulBonus(soulBonus, gamesCount){
  sim.setRuleFlags({...BASE_RULES, soulBonus});
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
  const avgRounds = roundCounts.length ? roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length : NaN;
  const infinitePct = decisive ? 100*infiniteWins/decisive : NaN;
  const soulCapturePct = decisive ? 100*soulCaptureWins/decisive : NaN;
  const drawPct = 100*draws/gamesCount;
  console.log(`\n--- soulBonus=${soulBonus} (base: ${JSON.stringify(BASE_RULES)}) ---`);
  console.log(`${gamesCount} games, avgRounds=${avgRounds.toFixed(1)}  Infinite%=${infinitePct.toFixed(1)}  Soul-capture%=${soulCapturePct.toFixed(1)}  draw%=${drawPct.toFixed(1)}  errors=${errors}`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return {soulBonus, avgRounds, infinitePct, soulCapturePct, drawPct, errors};
}

console.log(`=== Soul-bonus-after-own-Body-captured sweep: ${SOUL_BONUS_VALUES.length} values, ${GAMES_PER_VALUE} games each, ${ITERATIONS} iterations/move ===`);
const t0 = Date.now();
const results = SOUL_BONUS_VALUES.map(v => scoreSoulBonus(v, GAMES_PER_VALUE));
console.log(`\nTotal time: ${((Date.now()-t0)/1000).toFixed(1)}s`);

console.log(`\n=== Summary ===`);
results.forEach(r=>{
  console.log(`soulBonus=${r.soulBonus}: avgRounds=${r.avgRounds.toFixed(1)} Infinite%=${r.infinitePct.toFixed(1)} draw%=${r.drawPct.toFixed(1)}`);
});
