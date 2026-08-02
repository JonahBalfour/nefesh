'use strict';
// Sanity check that the new combined ruleset (infiniteWindow:1 +
// capSoulBeforeBodyCaptured:true + allowLooping:true) still rewards skill,
// not just luck - reusing the exact same strong-vs-random and
// strong-vs-weak-MCTS methodology from the very first baseline run
// (nefesh-mcts-metrics.js), at the same 100-game/150-iteration settings, so
// the numbers are directly comparable to what we already trust:
//   LIVE ruleset:  strong vs random = 93.6%   strong vs weak MCTS = 69.7%
//
//   node nefesh-strategy-check.js [games] [strongIters] [weakIters]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const GAMES = parseInt(process.argv[2] || '100', 10);
const STRONG_ITERS = parseInt(process.argv[3] || '150', 10);
const WEAK_ITERS = parseInt(process.argv[4] || '20', 10);
const MAX_ROLLOUT_PLIES = 250;
const MAX_ROUNDS = 400;

const NEW_RULES = {...sim.LIVE_RULES, infiniteWindow:1, capSoulBeforeBodyCaptured:true, allowLooping:true};

function pickRandomAction(s, actions){
  return actions[Math.floor(Math.random()*actions.length)];
}
function mctsPicker(iterations){
  return (s) => mcts.mctsChooseAction(s, {iterations, maxRolloutPlies:MAX_ROLLOUT_PLIES});
}

function playOneGame(pickers){
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
    const pick = pickers[mover] || pickRandomAction;
    const action = pick(s, legal);
    s = sim.applyMove(s, action);
    steps++;
    if(steps>MAX_ROUNDS*20) break;
  }
  return {winner: sim.getWinner(s)};
}

function runMatch(label, strongPicker, weakPicker, ruleOpts, gamesCount){
  sim.setRuleFlags(ruleOpts);
  let strongWins=0, weakWins=0, undecided=0;
  const t0 = Date.now();
  for(let i=0;i<gamesCount;i++){
    const strongColor = i%2===0 ? 'white' : 'black';
    const weakColor = strongColor==='white' ? 'black' : 'white';
    const r = playOneGame({[strongColor]:strongPicker, [weakColor]:weakPicker});
    if(r.winner==null || r.winner==='draw') undecided++;
    else if(r.winner===strongColor) strongWins++;
    else weakWins++;
  }
  const decisive = strongWins+weakWins;
  console.log(`\n--- ${label} ---`);
  console.log(`Strong wins: ${strongWins} (${decisive?(100*strongWins/decisive).toFixed(1):'n/a'}% of decisive games)  Weak wins: ${weakWins}  Undecided: ${undecided}`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return decisive ? 100*strongWins/decisive : NaN;
}

console.log(`=== Strategy-vs-luck check on the NEW combined ruleset: ${JSON.stringify(NEW_RULES)} ===`);
console.log(`${GAMES} games per matchup, strong=${STRONG_ITERS} iterations, weak=${WEAK_ITERS} iterations`);

const vsRandom = runMatch('NEW ruleset: strong MCTS vs pure random', mctsPicker(STRONG_ITERS), pickRandomAction, NEW_RULES, GAMES);
const vsWeak = runMatch('NEW ruleset: strong MCTS vs weak MCTS', mctsPicker(STRONG_ITERS), mctsPicker(WEAK_ITERS), NEW_RULES, GAMES);

console.log(`\n=== Comparison to the original LIVE-ruleset baseline ===`);
console.log(`LIVE:  strong vs random = 93.6%    strong vs weak MCTS = 69.7%`);
console.log(`NEW:   strong vs random = ${vsRandom.toFixed(1)}%    strong vs weak MCTS = ${vsWeak.toFixed(1)}%`);
