'use strict';
// Plain MCTS player for Nefesh, built on the pure interface exported from
// nefesh-sim.js (cloneState/isTerminal/getWinner/getWinType/getLegalActions/
// applyMove/applyDiceRoll/sampleDiceRoll). See nefesh-ai-engine-spec.md for
// the design this follows.
//
// Two node types, per the spec's §3:
// - Decision nodes: state.dice is set, a player is choosing among legal
//   actions. Standard UCT selection.
// - Chance nodes: state.dice is null (not terminal) - nobody chooses here,
//   a dice roll happens. Expanded by sampling a (d1,d2) outcome; over many
//   iterations this converges to the same statistics as weighted
//   enumeration, at much less bookkeeping cost per node.
//
// Rollout policy is uniform-random legal moves (§4: "start dumb") - tree
// search does the actual work; rollout quality mostly affects convergence
// speed, not correctness.

const sim = require('./nefesh-sim.js');

const EXPLORATION_C = Math.SQRT2; // standard UCT constant

function getCurrentMoverPure(s){
  const real = sim.getState();
  try{
    sim.setState(s);
    return sim.currentMover();
  } finally {
    sim.setState(real); // see nefesh-sim.js's getLegalActions for why this is a finally
  }
}

function actionKey(a){
  return a.type==='place'
    ? `place:${a.color}:${a.pieceId}`
    : `move:${a.color}:${a.pieceId}:${a.move.delta}:${a.move.kind}`;
}

class Node {
  constructor(state, parent, incomingAction){
    this.state = state;
    this.parent = parent;
    this.incomingAction = incomingAction; // the action (or {d1,d2} roll) that led here - null for the root
    this.children = new Map();
    this.visits = 0;
    this.value = 0; // cumulative reward from the perspective of parent.mover (the player who chose the action that led here)
    this.isTerminal = sim.isTerminal(state);
    this.isChance = !this.isTerminal && state.dice === null;
    if(!this.isTerminal && !this.isChance){
      this.mover = getCurrentMoverPure(state);
      this.untriedActions = sim.getLegalActions(state, this.mover);
    }
  }
}

function uctScore(child, parentVisits){
  if(child.visits===0) return Infinity; // always try an unvisited child first
  return (child.value/child.visits) + EXPLORATION_C*Math.sqrt(Math.log(parentVisits)/child.visits);
}

function selectBestChild(node){
  let best=null, bestScore=-Infinity;
  for(const child of node.children.values()){
    const sc = uctScore(child, node.visits);
    if(sc>bestScore){ bestScore=sc; best=child; }
  }
  return best;
}

// Selection + expansion combined: descend via UCT (decision nodes) or a
// sampled dice roll (chance nodes) while fully expanded; the moment we hit
// a node with an untried action/outcome, expand exactly one new child and
// stop there - the caller runs the rollout from that fresh leaf.
function treePolicy(root){
  let node = root;
  const path = [node];
  while(!node.isTerminal){
    if(node.isChance){
      const roll = sim.sampleDiceRoll();
      const key = `${roll.d1},${roll.d2}`;
      let child = node.children.get(key);
      if(!child){
        const newState = sim.applyDiceRoll(node.state, roll.d1, roll.d2);
        child = new Node(newState, node, roll);
        node.children.set(key, child);
        path.push(child);
        return path;
      }
      node = child;
      path.push(node);
      continue;
    }

    if(node.untriedActions.length>0){
      const idx = Math.floor(Math.random()*node.untriedActions.length);
      const action = node.untriedActions.splice(idx,1)[0];
      const newState = sim.applyMove(node.state, action);
      const child = new Node(newState, node, action);
      node.children.set(actionKey(action), child);
      path.push(child);
      return path;
    }

    if(node.children.size===0) break; // dead end - shouldn't happen if isTerminal/getLegalActions agree, but don't loop forever
    node = selectBestChild(node);
    path.push(node);
  }
  return path;
}

// Uniform-random playout from `state` to a terminal state (or until
// maxPlies is hit, in which case the game is treated as undecided).
function rollout(state, maxPlies){
  let s = state;
  let plies = 0;
  while(!sim.isTerminal(s) && plies<maxPlies){
    if(s.dice===null){
      const roll = sim.sampleDiceRoll();
      s = sim.applyDiceRoll(s, roll.d1, roll.d2);
      continue;
    }
    const mover = getCurrentMoverPure(s);
    const actions = sim.getLegalActions(s, mover);
    if(actions.length===0){
      // Matches nefesh.html's immediate-draw rule (no legal placement or move).
      s = sim.cloneState(s);
      s.winner = 'draw'; s.isDraw = true; s.winType = null;
      break;
    }
    const pick = actions[Math.floor(Math.random()*actions.length)];
    s = sim.applyMove(s, pick);
    plies++;
  }
  return s;
}

// Reward from `color`'s perspective: 1 win, 0 loss, 0.5 draw or undecided
// (rollout hit the ply cap without reaching a terminal state).
function rewardFor(terminalState, color){
  const w = sim.getWinner(terminalState);
  if(w===color) return 1;
  if(w==null || w==='draw') return 0.5;
  return 0;
}

function backpropagate(path, terminalState){
  for(let i=path.length-1; i>=0; i--){
    const node = path[i];
    node.visits++;
    if(i===0) continue;
    const parent = path[i-1];
    if(parent.isChance) continue; // no mover chose this transition - nothing to score it against
    node.value += rewardFor(terminalState, parent.mover);
  }
}

// Runs MCTS from `rootState` (must be a decision state - dice already
// rolled, not a chance node) and returns the action judged best after
// `iterations` playouts, or null if there's no legal action at all.
function mctsChooseAction(rootState, {iterations=200, maxRolloutPlies=300}={}){
  const root = new Node(rootState, null, null);
  if(root.isTerminal) return null;
  if(root.isChance){
    throw new Error('mctsChooseAction expects a decision state with dice already set, not a chance node - roll dice first');
  }
  const rootLegalCount = root.untriedActions.length; // captured before treePolicy mutates it via splice
  if(rootLegalCount===0) return null; // no legal action this turn

  for(let i=0;i<iterations;i++){
    const path = treePolicy(root);
    const leaf = path[path.length-1];
    const terminal = leaf.isTerminal ? leaf.state : rollout(leaf.state, maxRolloutPlies);
    backpropagate(path, terminal);
  }

  // Robust-child selection: most-visited action, not highest raw average
  // value - less noisy than value-based picking at low iteration counts.
  let bestChild=null, bestVisits=-1;
  for(const child of root.children.values()){
    if(child.visits>bestVisits){ bestVisits=child.visits; bestChild=child; }
  }
  if(!bestChild || bestChild.incomingAction===undefined){
    // Shouldn't be reachable - root had >=1 legal action and >=1 iteration
    // always runs, so root.children should never end up empty. Dump enough
    // to diagnose rather than let the caller crash three frames away with a
    // generic "Cannot read properties of undefined".
    throw new Error(
      `mctsChooseAction: no valid child found after search. `+
      `rootLegalCount=${rootLegalCount} iterations=${iterations} `+
      `root.children.size=${root.children.size} root.mover=${root.mover} `+
      `root.untriedActions.length(after)=${root.untriedActions.length} `+
      `bestChild=${bestChild ? 'exists,incomingAction='+JSON.stringify(bestChild.incomingAction) : 'null'}`
    );
  }
  return bestChild.incomingAction;
}

module.exports = { mctsChooseAction, rollout, rewardFor, getCurrentMoverPure, actionKey, Node };
