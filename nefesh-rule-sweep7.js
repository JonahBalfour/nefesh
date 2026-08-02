'use strict';
// Comprehensive sweep, built on top of the validated Candidate 1 changes
// (infiniteWindow:1, capSoulBeforeBodyCaptured:true, allowLooping:true -
// held fixed), grid-searching the remaining variables that individual
// testing hadn't ruled out combining with each other or with Candidate 1:
//   diceMenu:     'full' | 'no-diff' | 'sum-only' | 'dice-only'   (4)
//   preplaceRace: true | false                                    (2)
//   placeAndMove: 'off' | 'mandatory' | 'optional'                (3)
//   soulBonus:    0, 1, 2, 3, 4                                   (5)
// = 120 combinations. Fast pass (small game count) to rank candidates,
// followed by a confirmation pass on the top few at a much bigger sample.
//
//   node nefesh-rule-sweep7.js [gamesPerCombo] [iterations] [confirmGames] [topN]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES_PER_COMBO = parseInt(process.argv[2] || '60', 10);
const ITERATIONS = parseInt(process.argv[3] || '100', 10);
const CONFIRM_GAMES = parseInt(process.argv[4] || '200', 10);
const TOP_N = parseInt(process.argv[5] || '8', 10);
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

function scoreRuleset(ruleOpts, gamesCount){
  sim.setRuleFlags({...sim.RULE_CANDIDATE_1, ...ruleOpts});
  let draws=0, infiniteWins=0, soulCaptureWins=0, errors=0;
  const roundCounts = [];
  for(let i=0;i<gamesCount;i++){
    try{
      const s = playOneGame();
      roundCounts.push(s.round);
      if(s.winner==null || s.winner==='draw'){ draws++; continue; }
      if(s.winType==='infinite') infiniteWins++;
      else if(s.winType==='soul_capture') soulCaptureWins++;
    } catch(e){
      errors++;
    }
  }
  const decisive = infiniteWins+soulCaptureWins;
  const avgRounds = roundCounts.length ? roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length : NaN;
  const infinitePct = decisive ? 100*infiniteWins/decisive : NaN;
  const drawPct = 100*draws/gamesCount;
  const lengthGap = Math.abs(avgRounds-50)/50;
  const balanceGap = Math.abs(infinitePct-50)/50;
  const compositeGap = lengthGap + balanceGap + drawPct/100;
  return {avgRounds, infinitePct, soulCapturePct: decisive?100*soulCaptureWins/decisive:NaN, drawPct, errors, compositeGap};
}

const DICE_MENUS = ['full','no-diff','sum-only','dice-only'];
const PREPLACE_OPTIONS = [true,false];
const PLACE_AND_MOVE_MODES = ['off','mandatory','optional'];
const SOUL_BONUS_VALUES = [0,1,2,3,4];

const combos = [];
for(const diceMenu of DICE_MENUS){
  for(const preplaceRace of PREPLACE_OPTIONS){
    for(const placeAndMove of PLACE_AND_MOVE_MODES){
      for(const soulBonus of SOUL_BONUS_VALUES){
        combos.push({diceMenu, preplaceRace, placeAndMove, soulBonus});
      }
    }
  }
}

console.log(`=== Comprehensive sweep on top of Candidate 1: ${combos.length} combinations, ${GAMES_PER_COMBO} games/combo, ${ITERATIONS} MCTS iterations/move ===`);
console.log(`Base (held fixed): ${JSON.stringify(sim.RULE_CANDIDATE_1)}\n`);

const t0 = Date.now();
const results = combos.map((combo, i)=>{
  const r = scoreRuleset(combo, GAMES_PER_COMBO);
  process.stdout.write(`[${i+1}/${combos.length}] ${JSON.stringify(combo)} -> avgRounds=${r.avgRounds?.toFixed(1)} infinite%=${r.infinitePct?.toFixed(1)} draw%=${r.drawPct.toFixed(1)} gap=${r.compositeGap.toFixed(3)}${r.errors?` (${r.errors} errors)`:''}\n`);
  return {combo, ...r};
});
console.log(`\nFast pass total time: ${((Date.now()-t0)/1000).toFixed(1)}s`);

const ranked = [...results].sort((a,b)=>a.compositeGap-b.compositeGap);
console.log(`\n=== Top ${TOP_N} candidates from the fast pass (about to re-check at ${CONFIRM_GAMES} games each) ===`);
ranked.slice(0,TOP_N).forEach((r,i)=>{
  console.log(`${i+1}. ${JSON.stringify(r.combo)} - avgRounds=${r.avgRounds?.toFixed(1)} infinite%=${r.infinitePct?.toFixed(1)} draw%=${r.drawPct.toFixed(1)} gap=${r.compositeGap.toFixed(3)}`);
});

console.log(`\n=== Confirmation pass: ${TOP_N} candidates, ${CONFIRM_GAMES} games each ===`);
const t1 = Date.now();
const confirmed = ranked.slice(0,TOP_N).map((r,i)=>{
  const cr = scoreRuleset(r.combo, CONFIRM_GAMES);
  const p = cr.infinitePct/100;
  const decisiveN = Math.round(CONFIRM_GAMES*(1-cr.drawPct/100));
  const se = decisiveN>0 ? Math.sqrt(p*(1-p)/decisiveN)*100 : NaN;
  console.log(`[${i+1}/${TOP_N}] ${JSON.stringify(r.combo)} -> avgRounds=${cr.avgRounds.toFixed(1)} infinite%=${cr.infinitePct.toFixed(1)}±${se.toFixed(1)} draw%=${cr.drawPct.toFixed(1)} gap=${cr.compositeGap.toFixed(3)}`);
  return {combo:r.combo, ...cr, se};
});
console.log(`\nConfirmation pass total time: ${((Date.now()-t1)/1000).toFixed(1)}s`);

const finalRanked = [...confirmed].sort((a,b)=>a.compositeGap-b.compositeGap);
console.log(`\n=== FINAL ranking (after confirmation at ${CONFIRM_GAMES} games each) ===`);
finalRanked.forEach((r,i)=>{
  console.log(`${i+1}. ${JSON.stringify(r.combo)} - avgRounds=${r.avgRounds.toFixed(1)} infinite%=${r.infinitePct.toFixed(1)}±${r.se.toFixed(1)} soulCapture%=${r.soulCapturePct.toFixed(1)} draw%=${r.drawPct.toFixed(1)}`);
});

console.log(`\n=== Candidate 1 itself, for comparison (base config, i.e. diceMenu:sum-only, preplaceRace:true, placeAndMove:off, soulBonus:0) ===`);
const candidate1Score = scoreRuleset({}, CONFIRM_GAMES);
console.log(`avgRounds=${candidate1Score.avgRounds.toFixed(1)} infinite%=${candidate1Score.infinitePct.toFixed(1)} soulCapture%=${candidate1Score.soulCapturePct.toFixed(1)} draw%=${candidate1Score.drawPct.toFixed(1)} gap=${candidate1Score.compositeGap.toFixed(3)}`);

console.log(`\nGrand total time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
