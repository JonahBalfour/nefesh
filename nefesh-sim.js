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

let PREPLACE_RACE_PIECES = false; // direction-1 softer variant: Race pieces start onboard, Person pieces still enter via the bench

function freshPieces(){
  const obj={};
  const raceOrder = PIECE_DEFS.filter(d=>d.category==='race');
  PIECE_DEFS.forEach(d=>{
    if(PREPLACE_RACE_PIECES && d.category==='race'){
      // +1: matches nefesh.html's current rule - Race pieces start one step
      // past their own Placement space, so Placement itself starts empty.
      obj[d.id] = {status:'onboard', progress:raceOrder.indexOf(d)+1, completedCircuit:false};
    } else {
      obj[d.id] = {status:'bench', progress:0, completedCircuit:false};
    }
  });
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
    winType:null, // 'infinite' | 'soul_capture' | null (null covers draws and in-progress games)
    isDraw:false,
    log:[],
    firstContactRound:null,
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
        const m = pathToMaster(color,p.progress);
        if(m===masterIdx) res.push({color, pieceId:d.id});
      }
    }
  }
  return res;
}

let DICE_MENU_MODE = 'full'; // 'full' (d1,d2,sum,diff - current rules); 'no-diff' (drop the difference); 'sum-only' (just the sum); 'dice-only' (just d1 or d2, no sum, no difference)
let DICE_COUNT_MODE = 'two'; // 'two' = current rules (two dice rolled each round); 'one' = only one die is rolled at all - no sum, difference, or choice-of-two-dice is possible, DICE_MENU_MODE is moot

function diceBaseOptions(){
  if(!state.dice) return [];
  const {d1,d2} = state.dice;
  if(DICE_COUNT_MODE==='one') return d1>0 ? [d1] : [];
  let vals;
  if(DICE_MENU_MODE==='sum-only') vals = [d1+d2];
  else if(DICE_MENU_MODE==='no-diff') vals = [d1,d2,d1+d2];
  else if(DICE_MENU_MODE==='dice-only') vals = [d1,d2];
  else vals = [d1,d2,d1+d2,Math.abs(d1-d2)];
  const set = new Set(vals);
  return [...set].filter(v=>v>0);
}

let SOUL_BONUS_AFTER_OWN_BODY_CAPTURED = 0; // 0 = baseline (Soul keeps its normal +0); variant sets this higher
let BONUS_MODE = 'flex'; // 'flex' = current rules (choose anywhere from 0 up to the bonus); 'fixed' = always add the full bonus
let ALLOW_LOOPING = false; // false = current rules (a non-Soul piece completing a full circuit is captured); true = it wraps around and keeps going instead, same as the Soul already does
let EASY_INFINITE_ENTRY = false; // false = current rules (the Soul must land on EXACTLY square 36 to enter the Infinite); true = once its own Body is captured, ANY move that completes or passes a full circuit wins outright - no exact-count precision needed
let INFINITE_WINDOW = 0; // 0 = current rules (must land on EXACTLY TRACK_LEN); N = also allow landing anywhere from TRACK_LEN-N to TRACK_LEN, a small tolerance window at the end of the lap - still gated on Body capture, ignored if EASY_INFINITE_ENTRY is on
let CAP_SOUL_BEFORE_BODY_CAPTURED = false; // true = the Soul can't move past (overshoot) the Infinite threshold at all until its own Body has been captured - it can approach right up to it, just not go beyond, removing today's shuttle-back-and-forth-near-the-end behavior

function effectiveBonus(color, def){
  if(def.id==='soul' && state.bodyCaptured[color]) return SOUL_BONUS_AFTER_OWN_BODY_CAPTURED;
  return def.bonus;
}

// Matches nefesh.html's fix - a Soul can't be captured by anyone, including
// its own owner landing another piece on it by accident, until that Soul's
// own Body has been captured.
function soulCaptureBlocked(occ){
  return occ.some(o=>o.pieceId==='soul' && !state.bodyCaptured[o.color]);
}

function getLegalMoves(color, pieceId){
  if(state.winner) return [];
  const def = getDef(pieceId);
  const p = state.pieces[color][pieceId];
  if(p.status!=='onboard' || !state.dice) return [];
  const bases = diceBaseOptions();
  const bonus = effectiveBonus(color, def);
  const deltaMagnitudes = new Set();
  if(BONUS_MODE==='fixed'){
    bases.forEach(b=>{ deltaMagnitudes.add(b+bonus); }); // bonus always fully applied, no choice of how much
  } else {
    bases.forEach(b=>{ for(let bn=0; bn<=bonus; bn++){ deltaMagnitudes.add(b+bn); } });
  }
  const deltas = new Set();
  deltaMagnitudes.forEach(v=>{
    deltas.add(v);
    if(def.category==='person') deltas.add(-v);
  });

  const legal=[];

  deltas.forEach(delta=>{
    const newProgress = p.progress + delta;

    if(def.id!=='soul'){
      if(delta<0 && newProgress<0) return;
      if(newProgress>=TRACK_LEN){
        if(ALLOW_LOOPING){
          const wrapped = newProgress % TRACK_LEN;
          const masterIdx = pathToMaster(color, wrapped);
          const occ = occupantsAtMaster(masterIdx);
          if(soulCaptureBlocked(occ)) return;
          legal.push({delta, newProgress: wrapped, kind:'normal', masterIdx, occ});
          return;
        }
        legal.push({delta, newProgress, kind:'self-lap-capture'});
        return;
      }
      const masterIdx = pathToMaster(color, newProgress);
      const occ = occupantsAtMaster(masterIdx);
      if(soulCaptureBlocked(occ)) return;
      legal.push({delta, newProgress, kind:'normal', masterIdx, occ});
      return;
    }

    // Soul moves like an ordinary Person piece the whole time, with full normal
    // capture rules everywhere (matches nefesh.html exactly) - the only two
    // special cases are landing on exactly TRACK_LEN (wins, once own Body is
    // captured) and, after completing a first circuit, going negative past its
    // own start (self-destructs instead of being blocked). Under
    // EASY_INFINITE_ENTRY, the first special case relaxes from an exact
    // landing to "reaches or passes" TRACK_LEN; under INFINITE_WINDOW, it
    // relaxes to a small tolerance window ending at TRACK_LEN instead.
    if(!p.completedCircuit && delta<0 && newProgress<0) return;
    // Before Body is captured, CAP_SOUL_BEFORE_BODY_CAPTURED blocks the Soul
    // from overshooting the Infinite threshold at all - it can approach right
    // up to TRACK_LEN, just not go past it, until it's actually unlocked.
    if(CAP_SOUL_BEFORE_BODY_CAPTURED && !state.bodyCaptured[color] && newProgress>TRACK_LEN) return;
    const infiniteThresholdMet = EASY_INFINITE_ENTRY
      ? newProgress>=TRACK_LEN
      : (newProgress<=TRACK_LEN && newProgress>=TRACK_LEN-INFINITE_WINDOW);
    if(infiniteThresholdMet && state.bodyCaptured[color]){
      legal.push({delta, newProgress, kind:'soul-win'});
      return;
    }
    if(p.completedCircuit && newProgress < 0){
      legal.push({delta, newProgress, kind:'soul-overshoot-capture'});
      return;
    }
    {
      const masterIdx = pathToMaster(color, newProgress);
      const occ = occupantsAtMaster(masterIdx);
      if(soulCaptureBlocked(occ)) return;
      legal.push({delta, newProgress, kind:'normal', masterIdx, occ});
    }
  });

  return legal;
}

function canPlaceAnyBenchPiece(color){
  const hasBench = PIECE_DEFS.some(d=> state.pieces[color][d.id].status==='bench');
  if(!hasBench) return false;
  // Every bench piece of this color shares the same destination (its own
  // Placement space), so one occupancy check covers all of them.
  return !soulCaptureBlocked(occupantsAtMaster(START_MASTER[color]));
}

function hasAnyLegalAction(color){
  if(canPlaceAnyBenchPiece(color)) return true;
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
  // Matches nefesh.html's fix - placement captures ANY occupant there, own
  // color or opponent's, not just a self-capture - but never a protected Soul.
  const occ = occupantsAtMaster(startMaster);
  if(soulCaptureBlocked(occ)) return;
  occ.forEach(o=>{
    state.pieces[o.color][o.pieceId].status='captured';
    if(o.pieceId==='body'){ state.bodyCaptured[o.color]=true; }
    if(o.color===color){
      log(`${color} self-captures ${getDef(o.pieceId).label} while placing on the starting spot.`);
    } else {
      log(`${color}'s placement captures ${o.color}'s ${getDef(o.pieceId).label}.`);
    }
    if(o.pieceId==='soul'){
      const winner = o.color==='white' ? 'black' : 'white';
      state.winner = winner;
      state.winType = 'soul_capture';
      state.winReason = o.color===color
        ? `${color} self-captured its own Soul while placing a piece - ${winner} wins.`
        : `${color} captured the opposing Soul while placing a piece.`;
    }
  });
  p.status='onboard';
  p.progress=0;
  log(`${color} places ${getDef(pieceId).label} on the starting spot.`);
  // NOTE: does not call finishAction - the caller decides when this color's
  // turn is over, since some rule variants chain a move after a placement.
}

function performMove(color, pieceId, move){
  const p = state.pieces[color][pieceId];
  const def = getDef(pieceId);

  if(move.kind==='self-lap-capture'){
    p.status='captured';
    log(`${def.label} (${color}) completes a full circuit and is captured.`);
  } else if(move.kind==='soul-win'){
    p.progress = move.newProgress;
    state.winner = color;
    state.winType = 'infinite';
    state.winReason = `${color}'s Soul entered the Infinite.`;
  } else if(move.kind==='soul-overshoot-capture'){
    p.status='captured';
    const winner = color==='white' ? 'black' : 'white';
    state.winner = winner;
    state.winType = 'soul_capture'; // the Soul is lost via the overshoot mechanic rather than a direct landing-capture, but it's still fundamentally a Soul loss, not an Infinite entry
    state.winReason = `${color}'s Soul overshot and was lost - ${winner} wins.`;
  } else if(move.kind==='normal'){
    p.progress = move.newProgress;
    if(pieceId==='soul' && move.newProgress>=TRACK_LEN){
      p.completedCircuit = true; // permanent, one-time - never unset once achieved
    }
    move.occ.forEach(o=>{
      state.pieces[o.color][o.pieceId].status='captured';
      if(o.pieceId==='body'){ state.bodyCaptured[o.color]=true; }
      if(o.color!==color && state.firstContactRound===null){
        state.firstContactRound = state.round; // first time either side actually captures the other's piece
      }
      if(o.pieceId==='soul'){
        const winner = o.color==='white' ? 'black' : 'white';
        state.winner = winner;
        state.winType = 'soul_capture';
        state.winReason = o.color===color ? `${color} self-captured its own Soul - ${winner} wins.` : `${color} captured the opposing Soul.`;
      }
    });
  }
  // NOTE: does not call finishAction - see placePiece.
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
  const d2 = DICE_COUNT_MODE==='one' ? null : 1+Math.floor(Math.random()*6);
  state.dice = {d1,d2};
}

const PIECE_VALUE = { soul: 100000, body: 80, mind: 20, will: 25, elf: 30, man: 22, dwarf: 16, creature: 10 };

let SACRIFICE_OWN_BODY = false; // toggled by the CLI harness to compare against baseline

// Bot "personalities" - each just re-weights the same scoring terms (capturing,
// self-capture risk, general progress, rushing the Soul). Catastrophic/winning
// terms (own-Soul safety, capturing the enemy Soul, soul-win) are NOT scaled by
// these - those aren't a matter of style, they're the actual win/loss condition.
let BOT_PROFILE = {white:'balanced', black:'balanced'};
// raceWeight/personWeight: how much to prefer advancing/placing pieces of that
// category over the other. bodyHunt: extra multiplier specifically on
// capturing the opponent's Body (on top of the general `capture` weight).
// ownBodyGuard: extra multiplier specifically penalizing self-capturing its
// OWN Body (on top of the general `selfCapture` weight) - what makes Guardian
// distinct from Defensive (broadly cautious) rather than redundant with it.
// selfSacrifice: deliberately self-captures its own Body once its Soul is out
// and moving, to unlock its own Infinite run early (same idea as the old
// SACRIFICE_OWN_BODY toggle, now per-persona instead of a single global flag).
const DEFAULT_AXES = {raceWeight:1.0, personWeight:1.0, bodyHunt:1.0, ownBodyGuard:1.0, selfSacrifice:false};
const SCORE_PROFILES = {
  balanced:   {...DEFAULT_AXES, capture:1.0, selfCapture:1.0, progress:1.0, soulUrgency:1.0}, // same as the original greedy bot
  aggressive: {...DEFAULT_AXES, capture:1.6, selfCapture:0.5, progress:0.8, soulUrgency:0.8}, // chases captures, shrugs off risk
  defensive:  {...DEFAULT_AXES, capture:0.7, selfCapture:2.2, progress:0.9, soulUrgency:1.0}, // very reluctant to expose any piece
  racer:      {...DEFAULT_AXES, capture:0.5, selfCapture:1.0, progress:1.6, soulUrgency:2.5}, // undervalues captures, rushes the Soul out
  vanguard:   {...DEFAULT_AXES, capture:1.0, selfCapture:1.0, progress:1.0, soulUrgency:1.0, raceWeight:1.8, personWeight:0.4}, // pushes Race pieces hard, delays Person pieces
  herald:     {...DEFAULT_AXES, capture:1.0, selfCapture:1.0, progress:1.0, soulUrgency:1.0, raceWeight:0.4, personWeight:1.8}, // rushes Person pieces out, neglects Race pieces
  assassin:   {...DEFAULT_AXES, capture:1.0, selfCapture:1.0, progress:1.0, soulUrgency:1.0, bodyHunt:2.5}, // fixates on reaching the opponent's Body specifically
  guardian:   {...DEFAULT_AXES, capture:1.0, selfCapture:1.0, progress:1.0, soulUrgency:1.0, ownBodyGuard:3.0}, // otherwise normal, but goes far out of its way to keep its own Body safe
  zealot:     {...DEFAULT_AXES, capture:1.0, selfCapture:1.0, progress:1.0, soulUrgency:1.2, selfSacrifice:true}, // sacrifices its own Body on purpose to free its Soul early
  turtle:     {...DEFAULT_AXES, capture:0.3, selfCapture:3.0, progress:0.3, soulUrgency:0.3}, // avoids nearly all risk, content to stall
};

function scoreOption(color, opt){
  const oppColor = color==='white'?'black':'white';
  let score = Math.random()*3; // small jitter so equally-good options aren't always picked in the same order
  const profile = SCORE_PROFILES[BOT_PROFILE[color]] || SCORE_PROFILES.balanced;

  if(opt.type==='place'){
    // placement is always a Person piece under the current rules (Race pieces
    // start onboard already), so personWeight is the relevant lever here.
    const startMaster = START_MASTER[color];
    const occ = occupantsAtMaster(startMaster).filter(o=>o.color===color);
    const hitsOwnSoul = occ.some(o=>o.pieceId==='soul');
    const hitsOwnOther = occ.some(o=>o.pieceId!=='soul');
    if(hitsOwnSoul) score -= 100000; // never place on top of your own unmoved Soul
    else if(hitsOwnOther) score -= 15; // wastes a piece, mildly bad
    else score += 6 * profile.personWeight; // otherwise, getting pieces onto the board is good
    // if this piece IS the soul, placing it isn't urgent by itself - no extra bonus
    return score;
  }

  // type === 'move'
  const move = opt.move;
  const pieceId = opt.pieceId;
  const def = getDef(pieceId);
  const p = state.pieces[color][pieceId];
  const categoryWeight = def.category==='race' ? profile.raceWeight : profile.personWeight;

  if(move.kind==='soul-win') return score + 1000000; // immediate win
  if(move.kind==='soul-overshoot-capture') return score - 200000; // self-destructs own Soul
  if(move.kind==='self-lap-capture') return score - 40; // loses this piece for nothing

  if(move.kind==='normal'){
    score += Math.abs(move.delta) * 0.5 * profile.progress * categoryWeight; // preference for making real progress, biased by category
    const ownSoul = state.pieces[color].soul;
    const soulIsOutAndMoving = ownSoul.status==='onboard' && ownSoul.progress >= 8;
    move.occ.forEach(o=>{
      if(o.color===color){
        if(o.pieceId==='soul') score -= 200000; // always catastrophic - not a "style" choice
        else if(o.pieceId==='body' && profile.selfSacrifice && soulIsOutAndMoving && !state.bodyCaptured[color]){
          score += 45; // deliberately unlock our own Soul's path to the Infinite
        } else if(o.pieceId==='body'){
          score -= 15 * profile.selfCapture * profile.ownBodyGuard; // extra-cautious about its own Body specifically
        } else {
          score -= 15 * profile.selfCapture; // mildly wasteful self-capture
        }
      } else if(o.pieceId==='soul'){
        score += 100000; // capturing the enemy Soul always wins - not a "style" choice
      } else if(o.pieceId==='body'){
        score += 70 * profile.capture * profile.bodyHunt; // extra fixation on the opponent's Body specifically
      } else {
        score += (PIECE_VALUE[o.pieceId]||20) * profile.capture;
      }
    });
    // urgency: if this piece IS our own Soul and it hasn't moved off the start yet, moving it is valuable
    if(pieceId==='soul' && p.progress===0) score += 500 * profile.soulUrgency;
    return score;
  }
  return score;
}

let PLACE_AND_MOVE_MODE = 'off'; // 'off' | 'mandatory' | 'optional' - direction-1 deployment variants

function collectPlaceOptions(color){
  const options = [];
  if(!canPlaceAnyBenchPiece(color)) return options;
  PIECE_DEFS.forEach(d=>{
    if(state.pieces[color][d.id].status==='bench') options.push({type:'place', pieceId:d.id});
  });
  return options;
}
function collectMoveOptions(color){
  const options = [];
  PIECE_DEFS.forEach(d=>{
    const p = state.pieces[color][d.id];
    if(p.status==='onboard'){
      getLegalMoves(color, d.id).forEach(m=>options.push({type:'move', pieceId:d.id, move:m}));
    }
  });
  return options;
}
// Picks the best-scoring option from a list, returning both the choice and
// its score (the score is needed by 'optional' mode to judge whether a free
// extra move is actually worth taking).
function bestOf(color, options){
  if(options.length===0) return null;
  let best=null, bestSc=-Infinity;
  options.forEach(o=>{
    const sc = scoreOption(color, o);
    if(sc>bestSc){ bestSc=sc; best=o; }
  });
  return {choice:best, score:bestSc};
}
function applyChoice(color, choice){
  if(choice.type==='place') placePiece(color, choice.pieceId);
  else performMove(color, choice.pieceId, choice.move);
}

let optionCounts = []; // instrumentation: how many legal options a player actually has on a turn (branching factor)

// Per-color strategy for the skill-gap experiment: 'greedy' = the usual scoring
// bot; 'random' = picks uniformly among its legal options, no evaluation at all.
let BOT_STRATEGY = {white:'greedy', black:'greedy'};

function pickRandom(options){
  if(!options || options.length===0) return null;
  return options[Math.floor(Math.random()*options.length)];
}

// ---------- lookahead bot: 2-ply search (my move, then opponent's best reply) ----------
// Cheap hand-rolled clone (no log, no functions) so this can run many times per decision.
function cloneState(s){
  const cloneOne = obj => {
    const out = {};
    for(const id in obj) out[id] = {...obj[id]};
    return out;
  };
  return {
    round: s.round,
    firstMover: s.firstMover,
    dice: s.dice ? {...s.dice} : null,
    acted: {...s.acted},
    bodyCaptured: {...s.bodyCaptured},
    roundsWithNoBodyCaptured: s.roundsWithNoBodyCaptured,
    winner: s.winner,
    winReason: s.winReason,
    winType: s.winType,
    isDraw: s.isDraw,
    firstContactRound: s.firstContactRound,
    log: [], // lookahead doesn't need history - skip cloning it to keep this cheap
    pieces: { white: cloneOne(s.pieces.white), black: cloneOne(s.pieces.black) },
  };
}

// ---------- pure wrappers for tree search (MCTS) ----------
// Everything above mutates the single module-global `state` in place, which
// is fine for the CLI harness (one game in flight at a time) but wrong for
// tree search, which needs to explore many hypothetical futures from the
// same node without them corrupting each other. These wrappers give a caller
// a pure interface - the state passed in is never touched, a new state comes
// back out - by temporarily pointing the module global at a clone (same
// swap-and-restore trick pickLookahead already uses above), running the
// existing mutators against it, then restoring the real global.
function isTerminal(s){
  return s.winner !== null && s.winner !== undefined;
}
function getWinner(s){
  return s.winner; // 'white' | 'black' | 'draw' | null
}
function getWinType(s){
  return s.winType || null; // 'infinite' | 'soul_capture' | null
}

// The full set of legal actions for a color's turn (placements AND moves
// together) against an arbitrary state - the per-turn equivalent of the
// spec's `getLegalMoves(state, player)`. Each action also carries its color,
// so it's self-contained for applyMove below (unlike collectPlaceOptions/
// collectMoveOptions, which rely on being called while the global `state`
// already point at the right position).
function getLegalActions(s, color){
  const real = state;
  try{
    state = s;
    return [...collectPlaceOptions(color), ...collectMoveOptions(color)]
      .map(a => ({...a, color}));
  } finally {
    // try/finally so a thrown exception mid-computation can't leave the
    // global `state` pointer stuck on this call's clone - without this, a
    // bug anywhere in here would silently corrupt every later call instead
    // of failing at its actual source.
    state = real;
  }
}

// Applies one action (from getLegalActions) to a clone of `s` and returns
// the resulting state, leaving `s` and the module-global `state` untouched.
// Also ends the turn (finishAction) so the result is a genuinely new
// decision/chance point, matching one ply of real play - one placement or
// move per turn, same as nefesh.html. (Doesn't handle PLACE_AND_MOVE_MODE's
// chained extra move - that variant isn't part of the baseline MCTS work.)
function applyMove(s, action){
  const real = state;
  try{
    state = cloneState(s);
    if(action.type==='place') placePiece(action.color, action.pieceId);
    else performMove(action.color, action.pieceId, action.move);
    if(!state.winner) finishAction(action.color);
    return state;
  } finally {
    state = real; // see getLegalActions above for why this is a finally, not a plain assignment
  }
}

// Chance-node support for dice. Two six-sided dice is only 36 outcomes, so
// the spec recommends enumerating them weighted by probability (lower
// variance) over sampling one at random - enumerateDiceOutcomes is that
// list; sampleDiceRoll is there too for whenever sampling is preferred
// instead (e.g. rollout playouts, where enumerating all 36 branches would
// be wasteful).
function enumerateDiceOutcomes(){
  const outcomes = [];
  if(DICE_COUNT_MODE==='one'){
    for(let d1=1; d1<=6; d1++) outcomes.push({d1, d2:null, prob: 1/6});
    return outcomes;
  }
  for(let d1=1; d1<=6; d1++){
    for(let d2=1; d2<=6; d2++){
      outcomes.push({d1, d2, prob: 1/36});
    }
  }
  return outcomes;
}
function sampleDiceRoll(){
  const d1 = 1+Math.floor(Math.random()*6);
  const d2 = DICE_COUNT_MODE==='one' ? null : 1+Math.floor(Math.random()*6);
  return {d1, d2};
}
function applyDiceRoll(s, d1, d2){
  const clone = cloneState(s);
  clone.dice = {d1, d2};
  return clone;
}

// Static "how good is this board" evaluator - used as the leaf-node score for
// the lookahead search (unlike scoreOption, which scores a specific move).
// Personality-aware: uses the same weights as scoreOption so a lookahead bot
// with e.g. the 'aggressive' profile actually searches for boards that suit
// an aggressive style, not just generically "good" boards.
function evaluateBoard(s, color){
  const oppColor = color==='white'?'black':'white';
  const profile = SCORE_PROFILES[BOT_PROFILE[color]] || SCORE_PROFILES.balanced;
  let score = 0;
  PIECE_DEFS.forEach(d=>{
    const val = PIECE_VALUE[d.id] || 20;
    const categoryWeight = d.category==='race' ? profile.raceWeight : profile.personWeight;
    const mine = s.pieces[color][d.id];
    const theirs = s.pieces[oppColor][d.id];
    const ownGuard = d.id==='body' ? profile.ownBodyGuard : 1;
    const oppHunt = d.id==='body' ? profile.bodyHunt : 1;
    if(mine.status!=='captured') score += val*profile.selfCapture*ownGuard + (mine.status==='onboard' ? mine.progress*0.3*profile.progress*categoryWeight : 0);
    if(theirs.status!=='captured') score -= val*profile.capture*oppHunt + (theirs.status==='onboard' ? theirs.progress*0.3 : 0);
  });
  const mySoul = s.pieces[color].soul;
  if(mySoul.status==='onboard'){
    const remaining = Math.abs(TRACK_LEN - mySoul.progress);
    score += Math.max(0, 40-remaining) * profile.soulUrgency; // extra pull toward the exact winning square, scaled by how urgently this style wants it
  }
  if(s.winner===color) score += 5000000;
  else if(s.winner && s.winner!==color && s.winner!=='draw') score -= 5000000;
  return score;
}

// For each legal option, simulate taking it, then simulate the opponent's best
// greedy reply within the SAME round (dice are shared per-round, so this reply
// is genuinely knowable, not a guess) - then evaluate the resulting board.
// If the round rolls over instead (this color was the second mover), there's
// nothing knowable to look ahead into - the next dice roll is a real chance
// event - so it falls back to evaluating the position right after this move.
function pickLookahead(color, options){
  if(!options || options.length===0) return null;
  const oppColor = color==='white'?'black':'white';
  const realState = state;
  let bestOpt = null, bestScore = -Infinity;

  options.forEach(opt=>{
    state = cloneState(realState);
    applyChoice(color, opt);
    if(!state.winner) finishAction(color);

    let score;
    if(state.winner){
      score = state.winner===color ? 5000000 : (state.winner==='draw' ? 0 : -5000000);
    } else if(currentMover()===oppColor && state.dice){
      const oppOptions = [...collectPlaceOptions(oppColor), ...collectMoveOptions(oppColor)];
      if(oppOptions.length>0) applyChoice(oppColor, bestOf(oppColor, oppOptions).choice);
      score = evaluateBoard(state, color);
    } else {
      score = evaluateBoard(state, color); // round rolled over - next dice unknown, stop here
    }

    if(score>bestScore){ bestScore=score; bestOpt=opt; }
  });

  state = realState;
  return bestOpt;
}

function pickByStrategy(color, options){
  if(!options || options.length===0) return null;
  const strategy = BOT_STRATEGY[color];
  if(strategy==='random') return pickRandom(options);
  if(strategy==='lookahead') return pickLookahead(color, options);
  return bestOf(color, options).choice;
}

function botAct(color){
  if(PLACE_AND_MOVE_MODE==='off'){
    const options = [...collectPlaceOptions(color), ...collectMoveOptions(color)];
    optionCounts.push(options.length);
    if(options.length===0){ finishAction(color); return 'passed'; }
    const choice = pickByStrategy(color, options);
    applyChoice(color, choice);
    finishAction(color);
    return choice.type;
  }

  // Deployment modes: while this color still has bench pieces, it tries to
  // place AND move in the same round before its turn ends. 'mandatory'
  // always takes the extra move if one is legal; 'optional' only takes it
  // when the best available move doesn't score as actively bad (i.e. isn't
  // a wasteful self-capture or similar) - a rough stand-in for "the player
  // chooses not to burn the extra move on something bad."
  const stillHasBench = collectPlaceOptions(color).length>0;
  let didSomething = false;

  if(stillHasBench){
    const placeChoice = pickByStrategy(color, collectPlaceOptions(color));
    if(placeChoice){ applyChoice(color, placeChoice); didSomething = true; }
    if(!state.winner){
      const moveOptions = collectMoveOptions(color);
      const takeExtraMove = BOT_STRATEGY[color]==='random'
        ? (moveOptions.length>0 && (PLACE_AND_MOVE_MODE==='mandatory' || Math.random()<0.5))
        : (moveOptions.length>0 && (PLACE_AND_MOVE_MODE==='mandatory' || bestOf(color, moveOptions).score>0));
      if(takeExtraMove){
        applyChoice(color, pickByStrategy(color, moveOptions));
        didSomething = true;
      }
    }
  } else {
    const moveChoice = pickByStrategy(color, collectMoveOptions(color));
    if(moveChoice){ applyChoice(color, moveChoice); didSomething = true; }
  }

  finishAction(color);
  return didSomething ? 'deployment-turn' : 'passed';
}

function simulateOneGame(maxRounds){
  resetState();
  let actions = 0;
  let passCount = 0; // 0 or 1 in practice - kept as a count for backward-compatible stat labels
  while(!state.winner && state.round <= maxRounds){
    if(!state.dice) rollDice();
    const mover = currentMover();
    if(mover===null){ continue; } // shouldn't happen, finishAction advances the round
    // Matches nefesh.html's actual rule: the instant one player has no legal
    // placement or move, the game ends immediately as a draw - not after
    // several passes back and forth. (This replaces an older 4-pass-streak
    // heuristic that no longer matched the live game.)
    if(!hasAnyLegalAction(mover)){
      state.winner = 'draw';
      state.isDraw = true;
      state.winType = null;
      state.winReason = `${mover} had no legal placement or move - draw.`;
      passCount++;
      break;
    }
    botAct(mover);
    actions++;
    if(actions > maxRounds*10){ break; } // safety valve against any infinite-loop bug
  }
  return {
    winner: state.winner,
    winReason: state.winReason,
    winType: state.winType,
    rounds: state.round,
    actions,
    passCount,
    stalemate: !state.winner,
    bodyCapturedWhite: state.bodyCaptured.white,
    bodyCapturedBlack: state.bodyCaptured.black,
    firstContactRound: state.firstContactRound,
  };
}

const N = parseInt(process.argv[2] || '500', 10);
const MAX_ROUNDS = parseInt(process.argv[3] || '400', 10);

function runBatch(label, {sacrifice=false, soulBonus=0, placeAndMove='off', preplaceRace=false, bonusMode='flex', diceMenu='full'}={}){
  SACRIFICE_OWN_BODY = sacrifice;
  SOUL_BONUS_AFTER_OWN_BODY_CAPTURED = soulBonus;
  PLACE_AND_MOVE_MODE = placeAndMove;
  PREPLACE_RACE_PIECES = preplaceRace;
  BONUS_MODE = bonusMode;
  DICE_MENU_MODE = diceMenu;
  optionCounts = [];
  let wins = {white:0, black:0};
  let winReasons = {};
  let stalemates = 0;
  let draws = 0;
  let totalRounds = 0;
  let errors = 0;
  let bodyCapturedNeitherCount = 0;
  let infiniteWins = 0;
  let soulCaptureWins = 0;
  const roundCounts = [];
  const contactRounds = [];
  let gamesWithAnyPass = 0;
  let totalPassEvents = 0;

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
        if(r.winType==='infinite') infiniteWins++;
        else if(r.winType==='soul_capture') soulCaptureWins++;
      }
      totalRounds += r.rounds;
      roundCounts.push(r.rounds);
      if(r.firstContactRound!==null) contactRounds.push(r.firstContactRound);
      if(r.passCount>0) gamesWithAnyPass++;
      totalPassEvents += r.passCount;
    } catch(e){
      errors++;
      console.log('GAME THREW AN ERROR:', e.message);
    }
  }

  roundCounts.sort((a,b)=>a-b);
  const median = roundCounts[Math.floor(roundCounts.length/2)];
  const p90 = roundCounts[Math.floor(roundCounts.length*0.9)];
  const decisiveGames = infiniteWins + soulCaptureWins;

  contactRounds.sort((a,b)=>a-b);
  const contactMedian = contactRounds.length ? contactRounds[Math.floor(contactRounds.length/2)] : NaN;
  const contactAvg = contactRounds.length ? (contactRounds.reduce((a,b)=>a+b,0)/contactRounds.length).toFixed(1) : 'n/a';

  console.log(`\n=== ${label}: ${N} games (cap ${MAX_ROUNDS} rounds) ===`);
  console.log(`White wins: ${wins.white} (${(100*wins.white/N).toFixed(1)}%)  Black wins: ${wins.black} (${(100*wins.black/N).toFixed(1)}%)`);
  console.log(`Declared draws (${STALEMATE_ROUNDS_NO_BODY}-round rule): ${draws} (${(100*draws/N).toFixed(1)}%)`);
  console.log(`Other stalemates (hit round cap without the draw rule catching it): ${stalemates} (${(100*stalemates/N).toFixed(1)}%) -- of which neither body ever captured: ${bodyCapturedNeitherCount}`);
  console.log(`Runtime errors: ${errors}`);
  console.log(`Median game length: ${median} rounds, 90th pct: ${p90}, average: ${(totalRounds/N).toFixed(1)}`);
  console.log(`First cross-capture (real contact): median round ${contactMedian}, average round ${contactAvg}`);
  console.log(`Infinite-entry wins: ${infiniteWins} (${(100*infiniteWins/decisiveGames).toFixed(1)}% of decisive games)  Soul-capture wins: ${soulCaptureWins} (${(100*soulCaptureWins/decisiveGames).toFixed(1)}% of decisive games)`);
  const sortedOpts = [...optionCounts].sort((a,b)=>a-b);
  const optMedian = sortedOpts.length ? sortedOpts[Math.floor(sortedOpts.length/2)] : NaN;
  const optAvg = sortedOpts.length ? (sortedOpts.reduce((a,b)=>a+b,0)/sortedOpts.length).toFixed(1) : 'n/a';
  const optP90 = sortedOpts.length ? sortedOpts[Math.floor(sortedOpts.length*0.9)] : NaN;
  console.log(`Legal options per turn (branching factor): median ${optMedian}, average ${optAvg}, 90th pct ${optP90}`);
  console.log(`Win reasons:`, winReasons);
  console.log(`"No legal action" (Pass) turns: ${totalPassEvents} out of ${optionCounts.length} total turns (${(100*totalPassEvents/optionCounts.length).toFixed(3)}%)`);
  console.log(`Games with at least one Pass turn: ${gamesWithAnyPass} out of ${N} (${(100*gamesWithAnyPass/N).toFixed(2)}%)`);
}

// ============ strategy-gap harness: pits two named bot strategies against each other ============
// The "champion" strategy alternates between white/black each game so
// first-mover advantage doesn't bias the result.
function runStrategyGapBatch(label, championStrategy, opponentStrategy, ruleOpts={}){
  SACRIFICE_OWN_BODY = ruleOpts.sacrifice||false;
  SOUL_BONUS_AFTER_OWN_BODY_CAPTURED = ruleOpts.soulBonus||0;
  PLACE_AND_MOVE_MODE = ruleOpts.placeAndMove||'off';
  PREPLACE_RACE_PIECES = ruleOpts.preplaceRace||false;
  BONUS_MODE = ruleOpts.bonusMode||'flex';
  DICE_MENU_MODE = ruleOpts.diceMenu||'full';

  let championWins=0, opponentWins=0, draws=0, stalemates=0, errors=0;
  const roundCounts = [];

  for(let i=0;i<N;i++){
    const championColor = i%2===0 ? 'white' : 'black';
    const opponentColor = championColor==='white' ? 'black' : 'white';
    BOT_STRATEGY = {[championColor]:championStrategy, [opponentColor]:opponentStrategy};
    try{
      const r = simulateOneGame(MAX_ROUNDS);
      roundCounts.push(r.rounds);
      if(r.winner==='draw') draws++;
      else if(r.stalemate) stalemates++;
      else if(r.winner===championColor) championWins++;
      else opponentWins++;
    } catch(e){
      errors++;
      console.log('GAME THREW AN ERROR:', e.message);
    }
  }

  const decisive = championWins+opponentWins;
  roundCounts.sort((a,b)=>a-b);
  const median = roundCounts.length ? roundCounts[Math.floor(roundCounts.length/2)] : NaN;

  console.log(`\n=== STRATEGY GAP (${championStrategy} vs ${opponentStrategy}): ${label}: ${N} games (cap ${MAX_ROUNDS} rounds) ===`);
  console.log(`${championStrategy} wins: ${championWins} (${(100*championWins/decisive).toFixed(1)}% of decisive games)`);
  console.log(`${opponentStrategy} wins: ${opponentWins} (${(100*opponentWins/decisive).toFixed(1)}% of decisive games)`);
  console.log(`Draws: ${draws} (${(100*draws/N).toFixed(1)}%)  Other stalemates: ${stalemates}  Runtime errors: ${errors}`);
  console.log(`Median game length: ${median} rounds`);
}

// ============ profile round-robin: do multiple distinct playstyles all stay viable, or does one dominate? ============
function runProfileRoundRobin(label, strategy, gamesPerMatchup, ruleOpts={}){
  SACRIFICE_OWN_BODY = ruleOpts.sacrifice||false;
  SOUL_BONUS_AFTER_OWN_BODY_CAPTURED = ruleOpts.soulBonus||0;
  PLACE_AND_MOVE_MODE = ruleOpts.placeAndMove||'off';
  PREPLACE_RACE_PIECES = ruleOpts.preplaceRace||false;
  BONUS_MODE = ruleOpts.bonusMode||'flex';
  DICE_MENU_MODE = ruleOpts.diceMenu||'full';
  BOT_STRATEGY = {white:strategy, black:strategy}; // both sides use the same search depth - only the profile (style) differs

  const profiles = Object.keys(SCORE_PROFILES);
  console.log(`\n=== PROFILE ROUND-ROBIN (${strategy}): ${label} (${gamesPerMatchup} games/matchup) ===`);

  const allRoundCounts = [];
  let allInfiniteWins = 0, allSoulCaptureWins = 0;

  for(let x=0; x<profiles.length; x++){
    for(let y=x+1; y<profiles.length; y++){
      const a = profiles[x], b = profiles[y];
      let aWins=0, bWins=0, undecided=0;
      for(let i=0;i<gamesPerMatchup;i++){
        const aColor = i%2===0 ? 'white' : 'black';
        const bColor = aColor==='white' ? 'black' : 'white';
        BOT_PROFILE = {[aColor]:a, [bColor]:b};
        const r = simulateOneGame(MAX_ROUNDS);
        allRoundCounts.push(r.rounds);
        if(r.stalemate || r.winner==='draw') undecided++;
        else {
          if(r.winner===aColor) aWins++; else bWins++;
          if(r.winType==='infinite') allInfiniteWins++;
          else if(r.winType==='soul_capture') allSoulCaptureWins++;
        }
      }
      const decisive = aWins+bWins;
      console.log(`${a} vs ${b}: ${a} wins ${(100*aWins/decisive).toFixed(1)}% (${aWins}/${decisive})  |  undecided: ${undecided}`);
    }
  }

  allRoundCounts.sort((a,b)=>a-b);
  const median = allRoundCounts[Math.floor(allRoundCounts.length/2)];
  const avg = (allRoundCounts.reduce((a,b)=>a+b,0)/allRoundCounts.length).toFixed(1);
  const p90 = allRoundCounts[Math.floor(allRoundCounts.length*0.9)];
  const decisiveTotal = allInfiniteWins + allSoulCaptureWins;
  console.log(`--- aggregate across all matchups (${allRoundCounts.length} games) ---`);
  console.log(`Game length: median ${median}, average ${avg}, 90th pct ${p90}`);
  console.log(`Infinite-entry wins: ${allInfiniteWins} (${(100*allInfiniteWins/decisiveTotal).toFixed(1)}% of decisive games)  Soul-capture wins: ${allSoulCaptureWins} (${(100*allSoulCaptureWins/decisiveTotal).toFixed(1)}%)`);
}

// ============ new persona impact test: each new persona vs 'balanced', under the live game's actual rules ============
function runPersonaImpact(personaId, gamesCount, ruleOpts={}){
  SACRIFICE_OWN_BODY = ruleOpts.sacrifice||false;
  SOUL_BONUS_AFTER_OWN_BODY_CAPTURED = ruleOpts.soulBonus||0;
  PLACE_AND_MOVE_MODE = ruleOpts.placeAndMove||'off';
  PREPLACE_RACE_PIECES = ruleOpts.preplaceRace||false;
  BONUS_MODE = ruleOpts.bonusMode||'flex';
  DICE_MENU_MODE = ruleOpts.diceMenu||'full';
  BOT_STRATEGY = {white:'greedy', black:'greedy'};

  let personaWins=0, balancedWins=0, undecided=0;
  let infiniteWins=0, soulCaptureWins=0;
  const roundCounts = [];

  for(let i=0;i<gamesCount;i++){
    const personaColor = i%2===0 ? 'white' : 'black';
    const balancedColor = personaColor==='white' ? 'black' : 'white';
    BOT_PROFILE = {[personaColor]:personaId, [balancedColor]:'balanced'};
    const r = simulateOneGame(MAX_ROUNDS);
    roundCounts.push(r.rounds);
    if(r.stalemate || r.winner==='draw'){ undecided++; continue; }
    if(r.winner===personaColor) personaWins++; else balancedWins++;
    if(r.winType==='infinite') infiniteWins++;
    else if(r.winType==='soul_capture') soulCaptureWins++;
  }

  roundCounts.sort((a,b)=>a-b);
  const median = roundCounts[Math.floor(roundCounts.length/2)];
  const avg = (roundCounts.reduce((a,b)=>a+b,0)/roundCounts.length).toFixed(1);
  const p90 = roundCounts[Math.floor(roundCounts.length*0.9)];
  const decisive = infiniteWins + soulCaptureWins;

  console.log(`\n=== ${personaId} vs balanced: ${gamesCount} games (cap ${MAX_ROUNDS} rounds) ===`);
  console.log(`${personaId} wins: ${personaWins} (${(100*personaWins/(personaWins+balancedWins)).toFixed(1)}% of decisive games)  balanced wins: ${balancedWins}`);
  console.log(`Undecided (draw/stalemate): ${undecided} (${(100*undecided/gamesCount).toFixed(1)}%)`);
  console.log(`Game length: median ${median}, average ${avg}, 90th pct ${p90}`);
  console.log(`Infinite-entry wins: ${infiniteWins} (${decisive?(100*infiniteWins/decisive).toFixed(1):'n/a'}% of decisive games)  Soul-capture wins: ${soulCaptureWins}`);
}

// Matches nefesh.html as currently shipped - this now INCLUDES the three
// Candidate 1 changes (see nefesh-rule-candidates.md), which were adopted
// into the live game: a 2-value tolerance window for Infinite entry, the
// Soul capped from passing that threshold before its own Body is captured,
// and pieces looping instead of self-lap-capturing on a completed circuit.
const LIVE_RULES = {bonusMode:'fixed', diceMenu:'sum-only', preplaceRace:true, infiniteWindow:1, capSoulBeforeBodyCaptured:true, allowLooping:true};

// RULE_CANDIDATE_1 is kept as an alias for backward compatibility with the
// sweep/diagnostic scripts written during the search - it's identical to
// LIVE_RULES now that it's been adopted, not a separate experimental config.
const RULE_CANDIDATE_1 = {...LIVE_RULES};

// Only run the CLI batch when this file is executed directly (`node
// nefesh-sim.js`), not when it's require()'d as a library - otherwise every
// caller (e.g. the MCTS engine) would trigger a console-dumping batch run
// just by importing this module.
if(require.main === module){
  // How often does "no legal action" (Pass) actually come up under the live
  // ruleset? Balanced-vs-balanced greedy bots (BOT_STRATEGY default), a large
  // sample so the rare-event rate is trustworthy.
  runBatch('Live rules - Pass frequency check', LIVE_RULES);

  // ['vanguard','herald','assassin','guardian','zealot','turtle'].forEach(id=>{
  //   runPersonaImpact(id, 400, LIVE_RULES);
  // });
}

module.exports = {
  // constants / data
  PIECE_DEFS, TRACK_LEN, START_MASTER, LIVE_RULES, RULE_CANDIDATE_1, SCORE_PROFILES,
  // core rules (operate on the module-global `state` - see resetState/cloneState)
  getDef, resetState, freshPieces, pathToMaster, currentMover,
  occupantsAtMaster, getLegalMoves, hasAnyLegalAction, canPlaceAnyBenchPiece,
  placePiece, performMove, finishAction, collectPlaceOptions, collectMoveOptions,
  // persona scoring - reads/writes the module-global BOT_PROFILE and state,
  // same swap-state convention as everything else here
  scoreOption,
  getBotProfile(){ return BOT_PROFILE; },
  setBotProfile(p){ BOT_PROFILE = p; },
  // pure wrappers for tree search (MCTS) - the §2 interface
  cloneState, isTerminal, getWinner, getWinType, getLegalActions, applyMove,
  enumerateDiceOutcomes, sampleDiceRoll, applyDiceRoll,
  // rule-variant knobs, exposed so an external harness can set them before
  // calling into the functions above (mirrors what runBatch does internally)
  setRuleFlags({sacrifice, soulBonus, placeAndMove, preplaceRace, bonusMode, diceMenu, allowLooping, diceCountMode, easyInfiniteEntry, infiniteWindow, capSoulBeforeBodyCaptured}={}){
    if(sacrifice!==undefined) SACRIFICE_OWN_BODY = sacrifice;
    if(soulBonus!==undefined) SOUL_BONUS_AFTER_OWN_BODY_CAPTURED = soulBonus;
    if(placeAndMove!==undefined) PLACE_AND_MOVE_MODE = placeAndMove;
    if(preplaceRace!==undefined) PREPLACE_RACE_PIECES = preplaceRace;
    if(bonusMode!==undefined) BONUS_MODE = bonusMode;
    if(diceMenu!==undefined) DICE_MENU_MODE = diceMenu;
    if(allowLooping!==undefined) ALLOW_LOOPING = allowLooping;
    if(diceCountMode!==undefined) DICE_COUNT_MODE = diceCountMode;
    if(easyInfiniteEntry!==undefined) EASY_INFINITE_ENTRY = easyInfiniteEntry;
    if(infiniteWindow!==undefined) INFINITE_WINDOW = infiniteWindow;
    if(capSoulBeforeBodyCaptured!==undefined) CAP_SOUL_BEFORE_BODY_CAPTURED = capSoulBeforeBodyCaptured;
  },
  // access to the module-global state, for callers that want to drive games
  // directly with the mutate-in-place functions (e.g. the existing bots do)
  getState(){ return state; },
  setState(s){ state = s; },
};

