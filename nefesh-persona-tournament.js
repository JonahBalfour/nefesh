'use strict';
// Persona round-robin tournament, using the SAME engine now shipped in
// nefesh.html: MCTS with persona-weighted rollouts (rolloutBias, driven by
// scoreOption/SCORE_PROFILES/BOT_PROFILE), not the old research-only
// uniform-random engine. Two parts:
//   1. Full round-robin: all 10 personas vs each other at Normal difficulty
//      (60 iterations, matching the shipped default), N games/pairing.
//   2. Difficulty ladder: a handful of stylistically distinct personas vs
//      Balanced, at Easy/Normal/Hard, to see whether persona flavor grows
//      or shrinks as search depth increases.
//
//   node nefesh-persona-tournament.js [roundRobinGamesPerPair] [ladderGamesPerConfig]

const sim = require('./nefesh-sim.js');
const mcts = require('./nefesh-mcts.js');

const RR_GAMES = parseInt(process.argv[2] || '10', 10);
const LADDER_GAMES = parseInt(process.argv[3] || '15', 10);
const MAX_ROLLOUT_PLIES = 200;
const MAX_ROUNDS = 400;
const ROLLOUT_BIAS = 0.65; // matches nefesh.html's MCTS_ROLLOUT_BIAS

// Difficulty tiers, matching nefesh.html's DIFFICULTIES exactly.
const DIFFICULTIES = { easy:15, normal:60, hard:180 };

sim.setRuleFlags(sim.LIVE_RULES);

function playOneGame(personaWhite, personaBlack, iterations){
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
    sim.setBotProfile({white:personaWhite, black:personaBlack});
    const action = mcts.mctsChooseAction(s, {iterations, maxRolloutPlies:MAX_ROLLOUT_PLIES, rolloutBias:ROLLOUT_BIAS});
    s = sim.applyMove(s, action);
    steps++;
    if(steps>MAX_ROUNDS*20) break;
  }
  return {winner: sim.getWinner(s), rounds: s.round};
}

const PERSONAS = Object.keys(sim.SCORE_PROFILES);

// ---------- Part 1: full round-robin at Normal difficulty ----------
function runRoundRobin(gamesPerPair){
  const wins = {}; // persona -> total wins across all its games
  const played = {}; // persona -> total games played
  PERSONAS.forEach(p=>{ wins[p]=0; played[p]=0; });
  const pairwise = {}; // "a vs b" -> {aWins, bWins, draws}

  const t0 = Date.now();
  let pairIdx = 0;
  const totalPairs = PERSONAS.length*(PERSONAS.length-1)/2;
  for(let i=0;i<PERSONAS.length;i++){
    for(let j=i+1;j<PERSONAS.length;j++){
      const a = PERSONAS[i], b = PERSONAS[j];
      pairIdx++;
      let aWins=0, bWins=0, draws=0;
      for(let g=0; g<gamesPerPair; g++){
        const aIsWhite = g%2===0;
        const r = aIsWhite
          ? playOneGame(a, b, DIFFICULTIES.normal)
          : playOneGame(b, a, DIFFICULTIES.normal);
        played[a]++; played[b]++;
        if(r.winner==null || r.winner==='draw'){ draws++; continue; }
        const winnerIsA = aIsWhite ? r.winner==='white' : r.winner==='black';
        if(winnerIsA){ aWins++; wins[a]++; } else { bWins++; wins[b]++; }
      }
      pairwise[`${a} vs ${b}`] = {aWins, bWins, draws};
      process.stdout.write(`[${pairIdx}/${totalPairs}] ${a} vs ${b}: ${a}=${aWins} ${b}=${bWins} draws=${draws}\n`);
    }
  }
  console.log(`\nRound-robin time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return {wins, played, pairwise};
}

// ---------- Part 2: difficulty ladder for a few distinct personas vs Balanced ----------
function runDifficultyLadder(personas, gamesPerConfig){
  const results = [];
  const t0 = Date.now();
  personas.forEach(persona=>{
    Object.entries(DIFFICULTIES).forEach(([diffName, iters])=>{
      let personaWins=0, balancedWins=0, draws=0;
      for(let g=0; g<gamesPerConfig; g++){
        const personaIsWhite = g%2===0;
        const r = personaIsWhite
          ? playOneGame(persona, 'balanced', iters)
          : playOneGame('balanced', persona, iters);
        if(r.winner==null || r.winner==='draw'){ draws++; continue; }
        const personaWon = personaIsWhite ? r.winner==='white' : r.winner==='black';
        if(personaWon) personaWins++; else balancedWins++;
      }
      const decisive = personaWins+balancedWins;
      const pct = decisive ? 100*personaWins/decisive : NaN;
      results.push({persona, difficulty:diffName, personaWins, balancedWins, draws, pct});
      console.log(`${persona} (${diffName}, ${iters} iters) vs balanced: ${persona}=${personaWins} balanced=${balancedWins} draws=${draws} (${pct.toFixed(1)}% of decisive)`);
    });
  });
  console.log(`\nDifficulty ladder time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return results;
}

console.log(`=== Persona round-robin: ${PERSONAS.length} personas, ${RR_GAMES} games/pair (${PERSONAS.length*(PERSONAS.length-1)/2} pairs), Normal difficulty (${DIFFICULTIES.normal} iters) ===\n`);
const rr = runRoundRobin(RR_GAMES);

console.log(`\n=== Overall win rate by persona (aggregated across all matchups) ===`);
const ranked = PERSONAS.map(p=>({persona:p, wins:rr.wins[p], played:rr.played[p], pct: 100*rr.wins[p]/rr.played[p]}))
  .sort((a,b)=>b.pct-a.pct);
ranked.forEach((r,i)=>console.log(`${i+1}. ${r.persona}: ${r.wins}/${r.played} (${r.pct.toFixed(1)}%)`));

console.log(`\n=== Full pairwise results ===`);
console.log(JSON.stringify(rr.pairwise, null, 1));

console.log(`\n\n=== Difficulty ladder: 5 distinct personas vs Balanced, across Easy/Normal/Hard ===\n`);
const ladder = runDifficultyLadder(['aggressive','guardian','racer','zealot','turtle'], LADDER_GAMES);

console.log(`\n=== Ladder results (JSON, for downstream charting) ===`);
console.log(JSON.stringify(ladder, null, 1));
