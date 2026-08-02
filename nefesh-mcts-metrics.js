'use strict';
// Metrics harness (spec §5) - the actual deliverable for rule search. Run
// once here on the CURRENT ruleset to get baseline numbers before any rule
// variant sweeping starts (spec §7 step 4).
//
//   node nefesh-mcts-metrics.js [selfPlayGames] [strongIters] [weakIters] [gapGames]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const SELF_PLAY_GAMES = parseInt(process.argv[2] || '30', 10);
const STRONG_ITERS = parseInt(process.argv[3] || '150', 10);
const WEAK_ITERS = parseInt(process.argv[4] || '20', 10);
const GAP_GAMES = parseInt(process.argv[5] || '30', 10);
const MAX_ROLLOUT_PLIES = 250;
const MAX_ROUNDS = 400;

sim.setRuleFlags(sim.LIVE_RULES);

// All pickers share the (state, legalActions) signature that playOneGame
// calls them with below - this one just ignores `state`.
function pickRandomAction(s, actions){
  return actions[Math.floor(Math.random()*actions.length)];
}

// General game runner: `pickers` maps color -> a function(state, legalActions) -> action.
// Passing null for a color's picker means "uniform random".
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
  return {winner: sim.getWinner(s), winType: sim.getWinType(s), rounds: s.round};
}

function mctsPicker(iterations){
  return (s) => mcts.mctsChooseAction(s, {iterations, maxRolloutPlies:MAX_ROLLOUT_PLIES});
}

// ---------- 1. Strategy-vs-luck: strong MCTS vs weak MCTS, same ruleset ----------
function runStrategyVsLuck(gamesCount, strongIters, weakIters){
  let strongWins=0, weakWins=0, undecided=0;
  const t0 = Date.now();
  for(let i=0;i<gamesCount;i++){
    const strongColor = i%2===0 ? 'white' : 'black';
    const weakColor = strongColor==='white' ? 'black' : 'white';
    const r = playOneGame({[strongColor]: mctsPicker(strongIters), [weakColor]: mctsPicker(weakIters)});
    if(r.winner==null || r.winner==='draw') undecided++;
    else if(r.winner===strongColor) strongWins++;
    else weakWins++;
  }
  const decisive = strongWins+weakWins;
  console.log(`\n--- Strategy-vs-luck: strong MCTS (${strongIters} iters) vs weak MCTS (${weakIters} iters), ${gamesCount} games ---`);
  console.log(`Strong wins: ${strongWins} (${decisive?(100*strongWins/decisive).toFixed(1):'n/a'}% of decisive games)  Weak wins: ${weakWins}  Undecided: ${undecided}`);
  console.log(`(Closer to 100% = skill dominates; closer to 50% = ruleset is luck-dominated regardless of search strength.)`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
}

// ---------- 1b. Strategy-vs-luck reference point: strong MCTS vs pure random ----------
// Separates "the ruleset rewards skill only moderately" from "even a weak
// search is already a fairly capable player" - the strong-vs-weak-MCTS
// number alone can't distinguish those two explanations.
function runStrategyVsRandom(gamesCount, strongIters){
  let strongWins=0, randomWins=0, undecided=0;
  const t0 = Date.now();
  for(let i=0;i<gamesCount;i++){
    const strongColor = i%2===0 ? 'white' : 'black';
    const randomColor = strongColor==='white' ? 'black' : 'white';
    const r = playOneGame({[strongColor]: mctsPicker(strongIters), [randomColor]: pickRandomAction});
    if(r.winner==null || r.winner==='draw') undecided++;
    else if(r.winner===strongColor) strongWins++;
    else randomWins++;
  }
  const decisive = strongWins+randomWins;
  console.log(`\n--- Strategy-vs-luck reference: strong MCTS (${strongIters} iters) vs pure random, ${gamesCount} games ---`);
  console.log(`Strong wins: ${strongWins} (${decisive?(100*strongWins/decisive).toFixed(1):'n/a'}% of decisive games)  Random wins: ${randomWins}  Undecided: ${undecided}`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
}

// ---------- 2/3/4. Self-play (same strength both sides): game length, win-path balance, draw rate ----------
function runSelfPlay(gamesCount, iterations){
  const picker = mctsPicker(iterations);
  let wins={white:0, black:0}, draws=0, infiniteWins=0, soulCaptureWins=0;
  const roundCounts = [];
  const t0 = Date.now();
  for(let i=0;i<gamesCount;i++){
    const r = playOneGame({white:picker, black:picker});
    roundCounts.push(r.rounds);
    if(r.winner==null || r.winner==='draw'){ draws++; continue; }
    wins[r.winner]++;
    if(r.winType==='infinite') infiniteWins++;
    else if(r.winType==='soul_capture') soulCaptureWins++;
  }
  roundCounts.sort((a,b)=>a-b);
  const median = roundCounts[Math.floor(roundCounts.length/2)];
  const avg = (roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length).toFixed(1);
  const p90 = roundCounts[Math.floor(roundCounts.length*0.9)];
  const decisive = infiniteWins+soulCaptureWins;

  console.log(`\n--- Self-play (MCTS vs MCTS, ${iterations} iters both sides): ${gamesCount} games ---`);
  console.log(`White wins: ${wins.white}  Black wins: ${wins.black}  Draws: ${draws} (${(100*draws/gamesCount).toFixed(1)}%)`);
  console.log(`Average game length: ${avg} rounds (median ${median}, 90th pct ${p90})  -- target ~50 rounds`);
  console.log(`Win-path balance: Infinite ${infiniteWins} (${decisive?(100*infiniteWins/decisive).toFixed(1):'n/a'}%)  Soul-capture ${soulCaptureWins} (${decisive?(100*soulCaptureWins/decisive).toFixed(1):'n/a'}%)  -- target ~50/50`);
  console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
}

console.log(`=== Baseline metrics on LIVE_RULES (current shipped ruleset) ===`);
runStrategyVsRandom(GAP_GAMES, STRONG_ITERS);
runStrategyVsLuck(GAP_GAMES, STRONG_ITERS, WEAK_ITERS);
runSelfPlay(SELF_PLAY_GAMES, STRONG_ITERS);
