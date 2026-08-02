# Nefesh — Design Spec (v1, for review)

This is my understanding of the game, written out fully so we can fix disagreements
in text before I touch any code again. Mark up whatever's wrong and I'll revise
this document — not the board — until you're happy with it.

---

## 1. Board geometry — what it should look like

**Overall shape:** a figure-8 / infinity symbol, made of two circular loops
connected in the middle, drawn in the checkered black-and-white style of your
original sketch.

**The two outer loops**
- 16 spaces each, 32 total. Confirmed exact colors, space by space (B = black/dark, W = white/light):

  | Space | Color | | Space | Color | | Space | Color | | Space | Color |
  |---|---|---|---|---|---|---|---|---|---|---|
  | 0 | W | | 9 | B | | 20 | B | | 29 | W |
  | 1 | B | | 10 | W | | 21 | W | | 30 | B |
  | 2 | W | | 11 | B | | 22 | B | | 31 | W |
  | 3 | B | | 12 | W | | 23 | W | | 32 | B |
  | 4 | W | | 13 | B | | 24 | B | | 33 | W |
  | 5 | B | | 14 | W | | 25 | W | | 34 | B |
  | 6 | W | | 15 | B | | 26 | B | | 35 | W |
  | 7 | B | | | | | 27 | W | | | |
  | 8 | W | | | | | 28 | B | | | |

- Spaces 0–15 (left loop) strictly alternate, starting light at 0.
- Spaces 20–35 (right loop) alternate starting dark at 20 — no exceptions,
  straightforward alternation the whole way (an earlier version of this
  table had space 26 as a deliberate exception; that was a mistake — it's
  just dark, like normal alternation gives it).
- Each loop is still a simple ring — every space touches its two neighbors normally.

**The central hub**
- Visually, this must read as **one simple circle**, divided by a cross (one
  vertical line, one horizontal line) into 4 quadrants — matching your original
  drawing exactly. Not two crossing ribbons, not a bowtie, not anything that
  reads as broken apart. One circle, one clean division into four regions.
- Top two quadrants: light. Bottom two quadrants: dark. (This is a deliberate
  exception — everywhere else on the board, spaces alternate; here they don't.)
- Space 16 (top-left quadrant): light background, holds Black Placement.
- Space 17 (top-right quadrant): light background.
- Space 18 (bottom-right quadrant): dark background, holds White Placement.
- Space 19 (bottom-left quadrant): dark background.
- The circle should connect cleanly to both outer loops — no gap showing
  background through, no loops overlapping or crossing past it.

**Precise construction (so this can be rebuilt exactly)**

The board is built from **three separate circles** — a left loop, a right
loop, and a central hub — not two loops merging directly into each other.
Confirmed by you: it looks like three connected circles, but functions as one
figure-8 path (see section 2).

Exact values from the current working prototype:
- Hub center: `Hx=420, Hy=300` — this is also the Infinite's center.
- Hub outer radius `75`, inner radius `36` (ring thickness `39`).
- Infinite radius `39`.
- Loop outer radius `175` (both loops), inner radius `130` (ring thickness `45`).
- Loop centers are placed almost touching each other — `14` units of gap
  between their outer edges — via `Lx = Hx − 175 − 7`, `Rx = Hx + 175 + 7`.

**Layering — the hub sits on top:**
- The hub is drawn **last**, on top of everything, with no clipping — it's
  allowed to overlap the loops freely.
- All 32 outer loop spaces are drawn first and are never resized or clipped
  by the hub. This was tried the other way around (clipping the hub back to
  avoid the loops) and reverted — drawing the hub on top is the version that
  worked.

**How the 16 spaces per loop avoid being hidden under the hub — the hardest
part of this whole build, so worth recording precisely:**

Simply dividing each loop into 16 equal 22.5° wedges (as if the hub didn't
exist) causes 4 of them — 0, 15, 20, 35 — to end up almost entirely covered
once the hub sits on top. The fix, confirmed by you (*"imagine the space
behind the central hub doesn't exist ... that's where all of the spaces
should be"*):
- The hub's footprint covers about 54° of arc on each loop's circle — found
  by directly measuring the angle at which the loop's own boundary (both
  inner and outer edge) clears the hub's radius.
- That ~54° arc (27° either side of the straight line toward the hub) is
  treated as **not part of the loop**. The 16 real spaces are sized to evenly
  fill the *remaining* ~306°, not the full 360° — each space ends up about
  19–20° wide instead of 22.5°.
- The angle actually used is `GAP_HALF_ANGLE = 23°` (tightened from an
  initial 27° — see below), giving `VISIBLE_SPAN = 360° − 46° = 314°`, and
  each space = `314° / 16 ≈ 19.6°`.
- Space 0 starts right at the edge of the hub's footprint on one side; space
  15 ends right at the edge on the other side (mirrored for the right loop:
  space 20 and space 35).

**Why 23°, not the theoretical clearance angle (~27°):** at the exact angle
where a space's outer corner is precisely as far from the hub's center as the
hub's own radius, there's no gap and no overlap — a knife-edge that in
practice rendered as a thin visible gap (background showing through). The
angle actually used is a few degrees tighter than that exact edge, giving
spaces 0, 15, 20, and 35 a small **deliberate overlap** with the hub (about
3–4 units) at their outer tip. Since the hub draws on top, this overlap just
closes the seam instead of leaving a cut or a gap.

**The same overlap logic applies to the Infinite circle against the hub's
inner edge** — the Infinite's radius (39) is a few units bigger than the
hub's inner radius (36), for the same reason: a deliberate small overlap
instead of an exact edge match, closing a gap that opened there once before.

**If any of these sizes change in the future:** the gap angle and the
Infinite's radius both need to be re-derived relative to whatever the new
hub/loop sizes are — they're not fixed constants, they're the result of
measuring where the shapes actually clear each other for the *specific*
sizes above. Changing the hub or loop radius without re-checking these will
likely reopen a gap or a cut-through, the same way it did partway through
this process.

**The Infinite**
- A smaller circle nested inside the central hub, sitting at the very middle
  where the cross-lines meet.
- One plain circle — no extra ring or halo around it. Fill color still open
  (a neutral tone is my placeholder; you floated a checkered pattern as an
  alternative and we haven't settled it).
- Contains an X icon (two crossing double-headed arrows, each individually
  split black/white) in place of the earlier single arrow — full details,
  including exactly how it's colored, are in section 2 below.

---

## 2. How the board actually plays — the figure-8 crossing

This is the part that's been hard to reconcile with #1, so I want to say it
plainly: **visually the hub is one circle in 4 quadrants, but functionally it
is the crossing point of the figure-8.** That means the quadrants that are
next to each other on screen are *not* necessarily the quadrants a piece can
move between. Specifically:

**Black's full circuit (36 spaces, confirmed by you):**
16 → 15 → 14 → ... → 1 → 0 → 19 → 17 → 20 → 21 → ... → 34 → 35 → 18 → (back to 16)

**White's full circuit (the mirror image, confirmed by you):**
18 → 35 → 34 → ... → 21 → 20 → 17 → 19 → 0 → 1 → ... → 15 → 16 → (back to 18)

The consequence: **16 connects to 18, and 17 connects to 19** — the two
*diagonally opposite* quadrants — not to the quadrants beside them. Space 16
does not lead to 17 or 19. This is exactly what a real figure-8 does at its
own self-intersection: two threads crossing, not a simple ring.

**This is now resolved.** The quadrant circle stays exactly as described in #1 —
one simple circle, cross-divided into 4 quadrants, nothing about its shape
changes. The diagonal linkage is shown symbolically by an **X icon inside the
Infinite circle** — not a literal connector reaching out to the quadrants,
just a themed emblem sitting in the Infinite. Confirmed by your reference
image (`centralcirclemarkedup.png`):
- The X is made of two double-headed arrows crossing each other, fully
  contained **inside** the small Infinite circle — it does not extend outward
  toward the quadrants. The Infinite circle is the same plain nested circle
  from #1; the X is drawn inside it.
- Each of the two arrows is individually split into a black half and a white
  half (like the original single-arrow design, just doubled into an X) — it
  is **not** one whole arrow solid black and the other whole arrow solid
  white. Each arrow's black half points toward whichever light quadrant it's
  associated with (16 or 17), and its white half points toward whichever dark
  quadrant it's associated with (18 or 19).
- Net visual effect: the two black half-arrows both sit in the upper half of
  the Infinite (pointing up-left toward 16, up-right toward 17), and the two
  white half-arrows both sit in the lower half (pointing down-left toward 19,
  down-right toward 18) — which is why it can look at a glance like "one
  black arrow, one white arrow," but each individual arrow is genuinely
  bicolor, split at its own midpoint.
- This mirrors the existing logic for the starting dots (each dot is the
  opposite color of the quadrant it sits on) — black points toward light,
  white points toward dark. Deliberate, keep it that way.

This replaces the earlier single double-headed arrow (see #1's Infinite
description) as the Infinite's icon — the X sits where that single arrow used
to be, same size, same containment, just doubled into a crossing pair.


**Movement rules that follow from this path:**
- Race pieces (Creature, Dwarf, Man, Elf) move forward only, i.e. only in the
  direction listed above for their color.
- Person pieces (Mind, Will, Body, Soul) can move forward or backward along
  this same path, but never behind their own starting square.
- A full circuit = all 36 spaces, including passing through the hub twice
  going one way (well — once each color, since it's one linear path per lap,
  not two separate visits).

---

## 3. Pieces and rules

**The pieces — 8 per player, one of each:**
| Piece | Category | Bonus | Movement |
|---|---|---|---|
| Creature | Race | +0 | forward only |
| Dwarf | Race | +1 | forward only |
| Man | Race | +2 | forward only |
| Elf | Race | +3 | forward only |
| Mind | Person | +1 | forward/backward (not behind start) |
| Will | Person | +2 | forward/backward (not behind start) |
| Body | Person | +3 | forward/backward (not behind start) |
| Soul | Person | +0 (the "+∞" on the board is thematic only) | forward/backward, special endgame rules near the Infinite |

**Movement uses only the sum of both dice** — d1 and d2 individually, and
their difference, are not usable on their own as a move length. A piece's
bonus is a **flat add**, always fully applied on top of that sum (not a range
you choose from). Revised from an earlier version where all four values
(d1, d2, sum, difference) were usable and the bonus was a 0-to-max range —
playtesting (via simulation) showed that version gave players so many options
each turn that dice rolls barely mattered and individual decisions felt low-
stakes; this tighter version keeps captures and positioning more consequential.

**Starting positions:**
- The 4 Race pieces (Creature, Dwarf, Man, Elf) start the game already on the
  board, occupying spaces A1-A4 (Black) / B1-B4 (White) — one step past their
  own Placement space, in that bonus order — instead of on the bench. No
  placement needed for these.
- The 4 Person pieces (Mind, Will, Body, Soul) still start on the bench and
  must be placed on the player's own Placement space before they can move.
- Placement stays empty at the start of the game, since Race pieces begin one
  step past it (revised from an earlier version where a Race piece sat
  directly on it — see below). It can still end up occupied later if a piece
  returns there, at which point placing a bench piece on top of it captures
  whatever's there, same as landing on any other occupied space.

**Turn structure:**
- Each round, players alternate who goes first (White first in round 1, Black
  first in round 2, etc.).
- Dice are rolled once per round, by whichever player moves second that round.
- Each player must place a Person piece still on the bench, or move any
  onboard piece, every round.
- Placement happens on a player's own Placement space (16 for Black, 18 for
  White).
- If a player genuinely has no legal placement or move (every onboard piece's
  only reachable space is blocked by the opponent's protected Soul, with
  nothing left on the bench), the game ends immediately as a draw - the same
  idea as a stalemate in chess. Checked via simulation: this comes up in well
  under 1% of games, so it's rare rather than a real strategic factor.

**Captures:**
- Landing on any occupied space — including your own piece — captures
  (removes) whatever's there. Pieces may jump over others freely.
- Self-capturing your own Body satisfies the "Body must be captured" unlock
  condition just as an opponent's capture would.

**Laps and the Infinite:**
- Any piece — Soul included — that completes a full 36-space circuit simply
  wraps around and keeps going, rather than being captured.
- A player may only move their Soul into the Infinite — and may only capture
  the opponent's Soul — after that player's own/opponent's Body (respectively)
  has been captured.
- The Soul may land on either of the last two spaces of its circuit (one
  space before completing it, or the exact completing space itself) to enter
  the Infinite, once its own Body has been captured — not just an exact
  count. Until its own Body is captured, though, the Soul can't pass that
  threshold at all: it can approach right up to the end of its circuit, but
  can't go past it, so it can't shuttle back and forth near the end before
  it's actually unlocked.
- This protection covers a Soul against ANY capture, including its own owner
  accidentally landing another piece on it — a Soul can't be self-captured
  until that same player's own Body has been captured, for the same reason
  the opponent can't capture it early: the game shouldn't end via Soul loss
  before Body's fate is decided, whether the loss was deliberate or a mistake.

---

## 4. What I'd like you to mark up

Please tell me, for each section:
1. **Board geometry (#1)** — is this description accurate to your drawing?
2. **The crossing problem (#2)** — do you agree with keeping the quadrant
   circle as-is and adding a separate visual cue for the diagonal link, or do
   you have a different idea for how it should look?
3. Anything in **pieces/rules (#3)** that's drifted from your intent.

Once this document matches what's in your head, I'll rebuild from it in one
pass instead of iterating blind again.
