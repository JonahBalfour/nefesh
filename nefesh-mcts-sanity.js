'use strict';
// Sanity check (spec §7 step 3): MCTS-player vs a uniform-random player,
// same ruleset, alternating who plays which color so first-mover advantage
// doesn't bias the result. Expect a lopsided win rate (>90%) for MCTS - if
// not, something's wrong with the engine before any rule-optimization work
// starts on top of it.

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES = parseInt(process.argv[2] || '40', 10);
const ITERATIONS = parseInt(process.argv[3] || '150', 10);
const MAX_ROLLOUT_PLIES = parseInt(process.argv[4] || '250', 10);
const MAX_ROUNDS = 400;

sim.setRuleFlags(sim.LIVE_RULES);

function pickRandomAction(actions){
  return actions[Math.floor(Math.random()*actions.length)];
}

// Plays one game entirely through the pure interface - mctsColor uses MCTS,
// the other color picks uniformly among its legal actions every turn.
function playOneGame(mctsColor){
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
    const action = mover===mctsColor
      ? mcts.mctsChooseAction(s, {iterations:ITERATIONS, maxRolloutPlies:MAX_ROLLOUT_PLIES})
      : pickRandomAction(legal);
    s = sim.applyMove(s, action);
    steps++;
    if(steps>MAX_ROUNDS*20) break; // safety valve
  }
  return {winner: sim.getWinner(s), rounds: s.round};
}

let mctsWins=0, randomWins=0, draws=0;
const t0 = Date.now();
for(let i=0;i<GAMES;i++){
  const mctsColor = i%2===0 ? 'white' : 'black';
  const r = playOneGame(mctsColor);
  if(r.winner==='draw' || r.winner==null) draws++;
  else if(r.winner===mctsColor) mctsWins++;
  else randomWins++;
  process.stdout.write(`game ${i+1}/${GAMES}: MCTS played ${mctsColor}, winner ${r.winner}, ${r.rounds} rounds\r\n`);
}
const t1 = Date.now();

const decisive = mctsWins+randomWins;
console.log(`\n=== MCTS vs random: ${GAMES} games, ${ITERATIONS} iterations/move, cap ${MAX_ROLLOUT_PLIES} rollout plies ===`);
console.log(`MCTS wins: ${mctsWins} (${decisive?(100*mctsWins/decisive).toFixed(1):'n/a'}% of decisive games)`);
console.log(`Random wins: ${randomWins}`);
console.log(`Draws/undecided: ${draws}`);
console.log(`Total time: ${((t1-t0)/1000).toFixed(1)}s, ${((t1-t0)/GAMES).toFixed(0)}ms/game average`);
