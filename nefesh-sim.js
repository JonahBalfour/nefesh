'use strict';
// Headless Nefesh simulator - reuses the EXACT game logic from nefesh.html
// (copy-pasted verbatim from the <script> block, only render()/log() stubbed
// out and a bot + simulation loop added at the bottom). Used to sanity-check
// the ruleset itself: does the game always end, is it roughly fair, are all
// the rules actually reachable.

const TRACK_LEN = 36;
const LOOP_LEN = 16;

const PIECE_DEFS = [
  {id:'creature', label:'Creature', abbr:'C', category:'race', bonus:0},
  {id:'dwarf',    label:'Dwarf',    abbr:'D', category:'race', bonus:1},
  {id:'man',      label:'Man',      abbr:'M', category:'race', bonus:2},
  {id:'elf',      label:'Elf',      abbr:'E', category:'race', bonus:3},
  {id:'mind',     label:'Mind',     abbr:'Mi', category:'person', bonus:1},
  {id:'will',     label:'Will',     abbr:'W', category:'person', bonus:2},
  {id:'body',     label:'Body',     abbr:'B', category:'person', bonus:3},
  {id:'soul',     label:'Soul',     abbr:'S', category:'person', bonus:0},
];
function getDef(id){ return PIECE_DEFS.find(p=>p.id===id); }

const PATH_ORDER = [16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0,19,17,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,18];
const START_MASTER = {white:18, black:16};
function pathToMaster(color, progress){
  const p = ((progress % TRACK_LEN)+TRACK_LEN)%TRACK_LEN;
  if(color==='black') return PATH_ORDER[p];
  return PATH_ORDER[((TRACK_LEN-1-p)%TRACK_LEN+TRACK_LEN)%TRACK_LEN];
}

function freshPieces(){
  const obj={};
  PIECE_DEFS.forEach(d=>{ obj[d.id] = {status:'bench', progress:0, completedCircuit:false, inEndgame:false}; });
  return obj;
}
let state;
function resetState(){
  state = {
    round:1,
    firstMover:'white',
    dice:null,
    acted:{white:false, black:false},
    bodyCaptured:{white:false, black:false},
    roundsWithNoBodyCaptured:0,
    winner:null,
    winReason:'',
    isDraw:false,
    log:[],
    pieces:{ white:freshPieces(), black:freshPieces() }
  };
}

const STALEMATE_ROUNDS_NO_BODY = 80;

function currentMover(){
  const order = state.firstMover==='white' ? ['white','black'] : ['black','white'];
  if(!state.acted[order[0]]) return order[0];
  if(!state.acted[order[1]]) return order[1];
  return null;
}

function log(msg){ state.log.push(msg); }

function occupantsAtMaster(masterIdx){
  const res=[];
  for(const color of ['white','black']){
    for(const d of PIECE_DEFS){
      const p = state.pieces[color][d.id];
      if(p.status==='onboard'){
        const m = p.inEndgame ? null : pathToMaster(color,p.progress);
        if(m===masterIdx) res.push({color, pieceId:d.id});
      }
    }
  }
  return res;
}

function diceBaseOptions(){
  if(!state.dice) return [];
  const {d1,d2} = state.dice;
  const set = new Set([d1,d2,d1+d2,Math.abs(d1-d2)]);
  return [...set].filter(v=>v>0);
}

function getLegalMoves(color, pieceId){
  if(state.winner) return [];
  const def = getDef(pieceId);
  const p = state.pieces[color][pieceId];
  if(p.status!=='onboard' || !state.dice) return [];
  const bases = diceBaseOptions();
  const deltaMagnitudes = new Set();
  bases.forEach(b=>{ for(let bonus=0; bonus<=def.bonus; bonus++){ deltaMagnitudes.add(b+bonus); } });
  const deltas = new Set();
  deltaMagnitudes.forEach(v=>{
    deltas.add(v);
    if(def.category==='person') deltas.add(-v);
  });

  const legal=[];
  const oppColor = color==='white'?'black':'white';

  deltas.forEach(delta=>{
    const newProgress = p.progress + delta;

    if(def.id!=='soul'){
      if(delta<0 && newProgress<0) return;
      if(newProgress>=TRACK_LEN){
        legal.push({delta, newProgress, kind:'self-lap-capture'});
        return;
      }
      const masterIdx = pathToMaster(color, newProgress);
      const occ = occupantsAtMaster(masterIdx);
      const oppSoulThere = occ.some(o=>o.color===oppColor && o.pieceId==='soul');
      if(oppSoulThere && !state.bodyCaptured[oppColor]) return;
      legal.push({delta, newProgress, kind:'normal', masterIdx, occ});
      return;
    }

    if(!p.completedCircuit){
      if(delta<0 && newProgress<0) return;
      if(newProgress>=TRACK_LEN){
        legal.push({delta, newProgress, kind:'soul-enter-endgame'});
        return;
      }
      const masterIdx = pathToMaster(color, newProgress);
      const occ = occupantsAtMaster(masterIdx);
      const oppSoulThere = occ.some(o=>o.color===oppColor && o.pieceId==='soul');
      if(oppSoulThere && !state.bodyCaptured[oppColor]) return;
      legal.push({delta, newProgress, kind:'normal', masterIdx, occ});
    } else {
      if(newProgress === TRACK_LEN){
        if(!state.bodyCaptured[color]) return;
        legal.push({delta, newProgress, kind:'soul-win'});
        return;
      }
      if(newProgress <= -TRACK_LEN){
        legal.push({delta, newProgress, kind:'soul-overshoot-capture'});
        return;
      }
      legal.push({delta, newProgress, kind:'soul-endgame-shuffle'});
    }
  });

  return legal;
}

function hasAnyLegalAction(color){
  const bench = PIECE_DEFS.some(d=> state.pieces[color][d.id].status==='bench');
  if(bench) return true;
  return PIECE_DEFS.some(d=>{
    const p = state.pieces[color][d.id];
    return p.status==='onboard' && getLegalMoves(color,d.id).length>0;
  });
}

function placePiece(color, pieceId){
  const mover = currentMover();
  if(mover!==color || state.winner) return;
  const p = state.pieces[color][pieceId];
  if(p.status!=='bench') return;
  const startMaster = START_MASTER[color];
  const occ = occupantsAtMaster(startMaster).filter(o=>o.color===color);
  occ.forEach(o=>{
    state.pieces[o.color][o.pieceId].status='captured';
    log(`${color} self-captures ${getDef(o.pieceId).label} while placing on the starting spot.`);
    if(o.pieceId==='soul'){
      const winner = o.color==='white' ? 'black' : 'white';
      state.winner = winner;
      state.winReason = `${color} self-captured its own Soul while placing a piece - ${winner} wins.`;
    }
  });
  p.status='onboard';
  p.progress=0;
  log(`${color} places ${getDef(pieceId).label} on the starting spot.`);
  finishAction(color);
}

function performMove(color, pieceId, move){
  const p = state.pieces[color][pieceId];
  const def = getDef(pieceId);

  if(move.kind==='self-lap-capture'){
    p.status='captured';
    log(`${def.label} (${color}) completes a full circuit and is captured.`);
  } else if(move.kind==='soul-enter-endgame'){
    p.progress = move.newProgress;
    p.completedCircuit = true;
    p.inEndgame = true;
    log(`${def.label} (${color}) completes the circuit and passes the Infinite.`);
  } else if(move.kind==='soul-win'){
    p.progress = move.newProgress;
    state.winner = color;
    state.winReason = `${color}'s Soul entered the Infinite.`;
  } else if(move.kind==='soul-overshoot-capture'){
    p.status='captured';
    const winner = color==='white' ? 'black' : 'white';
    state.winner = winner;
    state.winReason = `${color}'s Soul overshot and was lost - ${winner} wins.`;
  } else if(move.kind==='soul-endgame-shuffle'){
    p.progress = move.newProgress;
  } else if(move.kind==='normal'){
    p.progress = move.newProgress;
    move.occ.forEach(o=>{
      state.pieces[o.color][o.pieceId].status='captured';
      if(o.pieceId==='body'){ state.bodyCaptured[o.color]=true; }
      if(o.pieceId==='soul'){
        const winner = o.color==='white' ? 'black' : 'white';
        state.winner = winner;
        state.winReason = o.color===color ? `${color} self-captured its own Soul - ${winner} wins.` : `${color} captured the opposing Soul.`;
      }
    });
  }
  finishAction(color);
}

function finishAction(color){
  state.acted[color]=true;
  if(state.winner){ return; }
  if(currentMover()===null){
    if(!state.bodyCaptured.white && !state.bodyCaptured.black){
      state.roundsWithNoBodyCaptured++;
      if(state.roundsWithNoBodyCaptured >= STALEMATE_ROUNDS_NO_BODY){
        state.winner = 'draw';
        state.isDraw = true;
        state.winReason = `${STALEMATE_ROUNDS_NO_BODY} rounds with neither Body captured - draw.`;
        return;
      }
    } else {
      state.roundsWithNoBodyCaptured = 0;
    }
    state.round += 1;
    state.firstMover = state.firstMover==='white' ? 'black' : 'white';
    state.acted = {white:false, black:false};
    state.dice=null;
  }
}

// ============ bot + simulation harness (new - not from the prototype) ============
function rollDice(){
  const d1 = 1+Math.floor(Math.random()*6);
  const d2 = 1+Math.floor(Math.random()*6);
  state.dice = {d1,d2};
}

const PIECE_VALUE = { soul: 100000, body: 80, mind: 20, will: 25, elf: 30, man: 22, dwarf: 16, creature: 10 };

let SACRIFICE_OWN_BODY = false; // toggled by the CLI harness to compare against baseline

function scoreOption(color, opt){
  const oppColor = color==='white'?'black':'white';
  let score = Math.random()*3; // small jitter so equally-good options aren't always picked in the same order

  if(opt.type==='place'){
    const startMaster = START_MASTER[color];
    const occ = occupantsAtMaster(startMaster).filter(o=>o.color===color);
    const hitsOwnSoul = occ.some(o=>o.pieceId==='soul');
    const hitsOwnOther = occ.some(o=>o.pieceId!=='soul');
    if(hitsOwnSoul) score -= 100000; // never place on top of your own unmoved Soul
    else if(hitsOwnOther) score -= 15; // wastes a piece, mildly bad
    else score += 6; // otherwise, getting pieces onto the board is good
    // if this piece IS the soul, placing it isn't urgent by itself - no extra bonus
    return score;
  }

  // type === 'move'
  const move = opt.move;
  const pieceId = opt.pieceId;
  const p = state.pieces[color][pieceId];

  if(move.kind==='soul-win') return score + 1000000; // immediate win
  if(move.kind==='soul-overshoot-capture') return score - 200000; // self-destructs own Soul
  if(move.kind==='self-lap-capture') return score - 40; // loses this piece for nothing
  if(move.kind==='soul-enter-endgame') return score + 40; // real progress toward winning
  if(move.kind==='soul-endgame-shuffle') return score + 8;

  if(move.kind==='normal'){
    score += Math.abs(move.delta) * 0.5; // mild preference for making real progress
    const ownSoul = state.pieces[color].soul;
    const soulIsOutAndMoving = ownSoul.status==='onboard' && ownSoul.progress >= 8;
    move.occ.forEach(o=>{
      if(o.color===color){
        if(o.pieceId==='soul') score -= 200000;
        else if(o.pieceId==='body' && SACRIFICE_OWN_BODY && soulIsOutAndMoving && !state.bodyCaptured[color]){
          score += 45; // deliberately unlock our own Soul's path to the Infinite
        } else {
          score -= 15; // mildly wasteful self-capture
        }
      } else {
        score += (o.pieceId==='soul') ? 100000 : (o.pieceId==='body' ? 70 : PIECE_VALUE[o.pieceId]||20);
      }
    });
    // urgency: if this piece IS our own Soul and it hasn't moved off the start yet, moving it is valuable
    if(pieceId==='soul' && p.progress===0) score += 500;
    return score;
  }
  return score;
}

function botAct(color){
  const options = [];
  PIECE_DEFS.forEach(d=>{
    const p = state.pieces[color][d.id];
    if(p.status==='bench') options.push({type:'place', pieceId:d.id});
  });
  PIECE_DEFS.forEach(d=>{
    const p = state.pieces[color][d.id];
    if(p.status==='onboard'){
      const moves = getLegalMoves(color, d.id);
      moves.forEach(m=>options.push({type:'move', pieceId:d.id, move:m}));
    }
  });
  if(options.length===0){
    // no legal action at all - pass (mirrors the UI's Pass button)
    finishAction(color);
    return 'passed';
  }
  const scored = options.map(o=>({o, sc: scoreOption(color, o)}));
  scored.sort((a,b)=>b.sc-a.sc);
  const choice = scored[0].o;
  if(choice.type==='place') placePiece(color, choice.pieceId);
  else performMove(color, choice.pieceId, choice.move);
  return choice.type;
}

function simulateOneGame(maxRounds){
  resetState();
  let actions = 0;
  let passStreak = 0; // both sides passing in a row with no dice ever mattering = true deadlock
  while(!state.winner && state.round <= maxRounds){
    if(!state.dice) rollDice();
    const mover = currentMover();
    if(mover===null){ continue; } // shouldn't happen, finishAction advances the round
    const result = botAct(mover);
    actions++;
    if(result==='passed'){
      passStreak++;
      if(passStreak>=4){ break; } // both sides passed twice in a row = true stalemate, stop early
    } else {
      passStreak = 0;
    }
    if(actions > maxRounds*10){ break; } // safety valve against any infinite-loop bug
  }
  return {
    winner: state.winner,
    winReason: state.winReason,
    rounds: state.round,
    actions,
    stalemate: !state.winner,
    bodyCapturedWhite: state.bodyCaptured.white,
    bodyCapturedBlack: state.bodyCaptured.black,
  };
}

const N = parseInt(process.argv[2] || '500', 10);
const MAX_ROUNDS = parseInt(process.argv[3] || '400', 10);

function runBatch(label, sacrificeMode){
  SACRIFICE_OWN_BODY = sacrificeMode;
  let wins = {white:0, black:0};
  let winReasons = {};
  let stalemates = 0;
  let draws = 0;
  let totalRounds = 0;
  let errors = 0;
  let bodyCapturedNeitherCount = 0;
  const roundCounts = [];

  for(let i=0;i<N;i++){
    try {
      const r = simulateOneGame(MAX_ROUNDS);
      if(r.winner==='draw'){
        draws++;
      } else if(r.stalemate){
        stalemates++;
        if(!r.bodyCapturedWhite && !r.bodyCapturedBlack) bodyCapturedNeitherCount++;
      } else {
        wins[r.winner]++;
        winReasons[r.winReason] = (winReasons[r.winReason]||0)+1;
      }
      totalRounds += r.rounds;
      roundCounts.push(r.rounds);
    } catch(e){
      errors++;
      console.log('GAME THREW AN ERROR:', e.message);
    }
  }

  roundCounts.sort((a,b)=>a-b);
  const median = roundCounts[Math.floor(roundCounts.length/2)];
  const p90 = roundCounts[Math.floor(roundCounts.length*0.9)];

  console.log(`\n=== ${label}: ${N} games (cap ${MAX_ROUNDS} rounds) ===`);
  console.log(`White wins: ${wins.white} (${(100*wins.white/N).toFixed(1)}%)  Black wins: ${wins.black} (${(100*wins.black/N).toFixed(1)}%)`);
  console.log(`Declared draws (${STALEMATE_ROUNDS_NO_BODY}-round rule): ${draws} (${(100*draws/N).toFixed(1)}%)`);
  console.log(`Other stalemates (hit round cap without the draw rule catching it): ${stalemates} (${(100*stalemates/N).toFixed(1)}%) -- of which neither body ever captured: ${bodyCapturedNeitherCount}`);
  console.log(`Runtime errors: ${errors}`);
  console.log(`Median game length: ${median} rounds, 90th pct: ${p90}, average: ${(totalRounds/N).toFixed(1)}`);
  console.log(`Win reasons:`, winReasons);
}

runBatch('BASELINE (no deliberate body-sacrifice incentive)', false);
runBatch('BODY-SACRIFICE VARIANT (bonus for self-capturing own Body once Soul is out and moving)', true);

