'use strict';
// Rule-variant grid search (spec §6/§7 step 5). Sweeps the discrete,
// small-cardinality rule knobs nefesh-sim.js already supports:
//   diceMenu:  'full' | 'no-diff' | 'sum-only' | 'dice-only'   (spec's diceMode)
//   bonusMode: 'flex' | 'fixed'
//   preplaceRace: true | false                                 (spec's startingPositions, coarse)
//   placeAndMove: 'off' | 'mandatory' | 'optional'
// against the three target metrics from §1: game length (~50 rounds),
// win-path balance (~50/50 Infinite vs Soul-capture), and draw rate - via
// MCTS self-play (same strength both sides) under each combination.
//
// This is deliberately a FAST, low-confidence first pass to find promising
// candidates (small game count, modest MCTS iteration budget) - not a final
// verdict. Anything that looks promising should get a slower, larger-sample
// confirmation run (like nefesh-mcts-metrics.js) before deciding anything.
// bonusSystem values and startingPositions layouts (the higher-cardinality
// parts of §6) aren't swept here - the spec calls for hand-picked candidates
// or an optimizer for those, once this discrete pass has run.
//
//   node nefesh-rule-sweep.js [gamesPerCombo] [iterations]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES_PER_COMBO = parseInt(process.argv[2] || '15', 10);
const ITERATIONS = parseInt(process.argv[3] || '50', 10);
const MAX_ROLLOUT_PLIES = 200;
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

function scoreRuleset(ruleOpts, gamesCount){
  sim.setRuleFlags(ruleOpts);
  let draws=0, infiniteWins=0, soulCaptureWins=0, errors=0;
  const roundCounts = [];
  for(let i=0;i<gamesCount;i++){
    try{
      const r = playOneGame();
      roundCounts.push(r.rounds);
      if(r.winner==null || r.winner==='draw'){ draws++; continue; }
      if(r.winType==='infinite') infiniteWins++;
      else if(r.winType==='soul_capture') soulCaptureWins++;
    } catch(e){
      errors++;
    }
  }
  const decisive = infiniteWins+soulCaptureWins;
  const avgRounds = roundCounts.length ? roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length : NaN;
  const infinitePct = decisive ? 100*infiniteWins/decisive : NaN;
  const drawPct = 100*draws/gamesCount;
  // Distance-from-target composite (lower is better) - just for ranking the
  // sweep output, not a claim about "correctness": how far game length sits
  // from 50 rounds (normalized), how far win-path sits from 50/50, plus the
  // draw rate directly (target is low, not a specific number).
  const lengthGap = Math.abs(avgRounds-50)/50;
  const balanceGap = Math.abs(infinitePct-50)/50;
  const compositeGap = lengthGap + balanceGap + drawPct/100;
  return {avgRounds, infinitePct, soulCapturePct: decisive?100*soulCaptureWins/decisive:NaN, drawPct, errors, compositeGap};
}

const DICE_MENUS = ['full','no-diff','sum-only','dice-only'];
const BONUS_MODES = ['flex','fixed'];
const PREPLACE_OPTIONS = [true,false];
const PLACE_AND_MOVE_MODES = ['off','mandatory','optional'];

const combos = [];
for(const diceMenu of DICE_MENUS){
  for(const bonusMode of BONUS_MODES){
    for(const preplaceRace of PREPLACE_OPTIONS){
      for(const placeAndMove of PLACE_AND_MOVE_MODES){
        combos.push({diceMenu, bonusMode, preplaceRace, placeAndMove});
      }
    }
  }
}

console.log(`=== Rule sweep: ${combos.length} combinations, ${GAMES_PER_COMBO} games/combo, ${ITERATIONS} MCTS iterations/move ===`);
console.log(`(Fast, low-confidence pass - re-check any promising result with a bigger sample before acting on it.)\n`);

const t0 = Date.now();
const results = combos.map((combo, i)=>{
  const r = scoreRuleset(combo, GAMES_PER_COMBO);
  process.stdout.write(`[${i+1}/${combos.length}] ${JSON.stringify(combo)} -> avgRounds=${r.avgRounds?.toFixed(1)} infinite%=${r.infinitePct?.toFixed(1)} draw%=${r.drawPct.toFixed(1)} gap=${r.compositeGap.toFixed(3)}${r.errors?` (${r.errors} errors)`:''}\n`);
  return {combo, ...r};
});
console.log(`\nTotal time: ${((Date.now()-t0)/1000).toFixed(1)}s`);

const ranked = [...results].sort((a,b)=>a.compositeGap-b.compositeGap);
console.log(`\n=== Top 5 candidates (closest to all three targets) ===`);
ranked.slice(0,5).forEach((r,i)=>{
  console.log(`${i+1}. ${JSON.stringify(r.combo)} - avgRounds=${r.avgRounds?.toFixed(1)} infinite%=${r.infinitePct?.toFixed(1)} soulCapture%=${r.soulCapturePct?.toFixed(1)} draw%=${r.drawPct.toFixed(1)}`);
});

console.log(`\n=== Current live ruleset for comparison ===`);
const live = combos.find(c => c.diceMenu==='sum-only' && c.bonusMode==='fixed' && c.preplaceRace===true && c.placeAndMove==='off');
const liveResult = results.find(r => r.combo===live);
if(liveResult){
  console.log(`${JSON.stringify(live)} - avgRounds=${liveResult.avgRounds?.toFixed(1)} infinite%=${liveResult.infinitePct?.toFixed(1)} soulCapture%=${liveResult.soulCapturePct?.toFixed(1)} draw%=${liveResult.drawPct.toFixed(1)} gap=${liveResult.compositeGap.toFixed(3)}`);
}
