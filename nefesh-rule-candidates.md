# Nefesh Rule Candidates

Findings from the MCTS-driven rule search (see `nefesh-ai-engine-spec.md` for
the original plan). `RULE_CANDIDATE_1` is defined in `nefesh-sim.js` alongside
`LIVE_RULES` so any script can reference it directly.

**Status: ADOPTED.** Candidate 1 has been ported into `nefesh.html` as the
live ruleset. See "Final conclusion" below.

---

## Candidate 1

```js
{...LIVE_RULES, infiniteWindow:1, capSoulBeforeBodyCaptured:true, allowLooping:true}
```

### What changes vs. the live ruleset

1. **Infinite entry gets a small tolerance window.** Today, the Soul must
   land on *exactly* the square that completes its circuit to enter the
   Infinite. Candidate 1 allows landing on either of the last two progress
   values before/at completing the lap - geometrically, that's the hub
   square right before home (C1 for White, C3 for Black) or home itself
   (which is physically the same spot as "the Infinite"). Still gated on
   the Soul's own Body having been captured first.
2. **The Soul can't pass the Infinite at all before its own Body is
   captured.** Today, the Soul can freely shuttle back and forth past that
   threshold even before it's unlocked. Candidate 1 caps it there instead -
   it can approach right up to the threshold, just not go past it, until
   Body capture actually unlocks the win condition.
3. **Non-Soul pieces loop instead of dying.** Today, any Race or Person
   piece other than the Soul that completes a full circuit is captured.
   Candidate 1 lets them wrap around and keep going instead - the same
   treatment the Soul already gets.

### Why: what problem each piece solves

- Change 1 exists because the exact-landing requirement turned out to be
  the dominant reason Soul-capture wins so heavily outweighed Infinite-entry
  wins (~65/35 under live rules). A too-strong version of this idea (any
  overshoot wins outright, tested as `easyInfiniteEntry`) overcorrected to
  ~69/31 the *other* way - the 2-value window was found by trying to land
  in between.
- Change 2 exists to remove a "free" way for the Infinite path to get
  easier before it's actually supposed to be reachable, keeping the
  Body-capture gate meaningful.
- Change 3 was found to all but eliminate draws on its own (draws are
  mostly caused by both sides indefinitely avoiding ever exposing their own
  Body - see the draw diagnosis below) and, combined with 1+2, cancels out
  a slight overshoot the other two changes introduce on their own.

### Measured results (MCTS self-play, live ruleset as the baseline)

| Metric | Live ruleset | Candidate 1 | Target |
|---|---|---|---|
| Win-path balance (Infinite % of decisive games) | ~35-42% (noisy across runs) | **49.5% ± 3.6** | ~50% |
| Draw rate | ~13-18% | **~2%** | low |
| Average game length | ~40-47 rounds | ~34 rounds | ~50 rounds (open gap) |
| Strategy vs. luck (strong MCTS beats pure random) | 93.6% | 90.8% | high (unchanged) |
| Strategy vs. luck (strong MCTS beats weak MCTS) | 69.7% | 72.2% | high (unchanged) |

All numbers above are from 100-200 game MCTS-vs-MCTS batches (100 MCTS
iterations/move unless noted) - real signal, but still worth a larger
confirmation run before treating any single number as final.

### Known open issue

Average game length is the one metric that didn't move toward its target -
every change found in this search that improved win-path balance or draw
rate also shortened games somewhat. Not yet investigated further.

### What was tried and ruled out along the way

- `soulBonus` (giving the Soul extra movement bonus after its own Body is
  captured): no measurable effect on win-path balance at a trustworthy
  sample size, despite an initially promising-looking signal at smaller
  samples.
- `bonusMode: flex` (choosing how much of a piece's bonus to use, 0..max)
  alone: cut draws but pushed win-path balance further from 50/50, not
  toward it.
- `diceCountMode: one` (rolling only a single die per round): no meaningful
  effect on either metric.
- Dice-menu mode, pre-placement, and place-and-move-mode combinations: none
  moved win-path balance off its baseline lean, across a 48-combination
  grid sweep.
- `easyInfiniteEntry` (any move reaching/passing the Infinite wins, no
  window): overcorrected the win-path balance to 69% Infinite - the seed
  the 2-value window idea grew out of.

### Final conclusion: comprehensive sweep on top of Candidate 1

After Candidate 1 was found, a 120-combination grid sweep tested every
remaining untested variable (dice menu × pre-placement × place-and-move ×
soul bonus, 0-4) layered on top of Candidate 1's three changes, at 60 games/
combo (fast pass) then the top 8 re-checked at 200 games/combo (confirmation
pass). Total runtime: ~4.8 hours.

**Result: nothing beat Candidate 1.** The best finisher out of all 120
combinations (`placeAndMove: optional` added on top of Candidate 1) scored
statistically identically to Candidate 1 itself (Infinite% 49.0±3.6 vs.
49.2, draw% 1.0 vs. 1.5). Every other finalist in the confirmed top 8 was
*worse* on win-path balance than Candidate 1 (27.6-42.0% Infinite, vs.
Candidate 1's 49.2%). Game length remained short (34-43 rounds) across every
finalist - that gap was not closed by anything tested in this sweep either.

This is treated as strong evidence that Candidate 1 (`infiniteWindow:1` +
`capSoulBeforeBodyCaptured:true` + `allowLooping:true`, everything else at
`LIVE_RULES`) sits at or very near a local optimum across everything tested
in this whole research track, and was adopted into `nefesh.html` on that
basis. Game length remains an open, unresolved gap.
