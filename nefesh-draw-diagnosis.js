'use strict';
// What's actually causing draws? There are exactly two ways a game can end
// in a draw:
//   (a) "no legal action" - the player to move has nothing they can place or
//       do, at all (rare - confirmed <1% back when this was added)
//   (b) the 80-round rule: neither side's Body has EVER been captured, for
//       80 straight rounds
// This tags every drawn game by which of the two actually fired, plus how
// far the game got (rounds) and whether either Body was ever exposed to a
// near-miss, so we're diagnosing rather than guessing at the cause.
//
//   node nefesh-draw-diagnosis.js [games] [iterations]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES = parseInt(process.argv[2] || '80', 10);
const ITERATIONS = parseInt(process.argv[3] || '100', 10);
const MAX_ROLLOUT_PLIES = 250;
const MAX_ROUNDS = 400;

sim.setRuleFlags(sim.LIVE_RULES);

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

let draws = [];
let decisive = 0;
const t0 = Date.now();
for(let i=0;i<GAMES;i++){
  const s = playOneGame();
  if(s.winner==='draw'){
    draws.push({
      rounds: s.round,
      bodyCapturedWhite: s.bodyCaptured.white,
      bodyCapturedBlack: s.bodyCaptured.black,
      winReason: s.winReason,
      hitRoundCap: s.round > MAX_ROUNDS, // ran out of the harness's own cap without either draw rule firing - a bug if it happens
    });
  } else {
    decisive++;
  }
  process.stdout.write(`${i+1}/${GAMES}\r`);
}
console.log(`\nTotal time: ${((Date.now()-t0)/1000).toFixed(1)}s\n`);

console.log(`=== Draw diagnosis: ${GAMES} games, ${draws.length} draws (${(100*draws.length/GAMES).toFixed(1)}%), ${decisive} decisive ===\n`);

const noLegalAction = draws.filter(d => d.winReason.includes('no legal placement or move'));
const eightyRoundRule = draws.filter(d => d.winReason.includes('rounds with neither Body captured'));
const other = draws.filter(d => !noLegalAction.includes(d) && !eightyRoundRule.includes(d));

console.log(`"No legal action" draws: ${noLegalAction.length} (${draws.length?(100*noLegalAction.length/draws.length).toFixed(1):0}% of draws)`);
console.log(`80-round "neither Body ever captured" draws: ${eightyRoundRule.length} (${draws.length?(100*eightyRoundRule.length/draws.length).toFixed(1):0}% of draws)`);
if(other.length) console.log(`Other/unclassified draws: ${other.length} - ${JSON.stringify(other.slice(0,3))}`);

if(eightyRoundRule.length>0){
  const bothUnexposed = eightyRoundRule.filter(d => !d.bodyCapturedWhite && !d.bodyCapturedBlack).length;
  console.log(`\nOf the 80-round draws, ${bothUnexposed}/${eightyRoundRule.length} had NEITHER Body ever captured for the entire game`);
  console.log(`(this should be ALL of them by definition of the rule - a mismatch here would mean a real bug)`);
}

if(noLegalAction.length>0){
  console.log(`\n"No legal action" draws - rounds reached: ${noLegalAction.map(d=>d.rounds).join(', ')}`);
}
