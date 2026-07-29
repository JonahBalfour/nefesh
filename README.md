# Nefesh

A board game from a fantasy western novel, being prototyped and playtested. This
folder is everything built so far in a long Claude.ai chat session, packaged up
so it can be moved into a real project (Claude Code, git, etc.).

## Files

- **`nefesh.html`** — the actual playable prototype. Single self-contained HTML
  file (no build step, no dependencies) — open it directly in a browser. Two
  players click through placing pieces, rolling dice, and moving on the same
  screen. This is the file that matters most; everything else supports it.

- **`nefesh-spec.md`** — the design spec: board geometry, exact colors and
  proportions, the movement path for both players, piece stats, and the full
  rules as currently understood. Written as a living document to review and
  correct in text before touching code, and it held up well for that. Worth
  keeping up to date as the source of truth if the rules or board design
  change again.

- **`nefesh-sim.js`** — a headless Node.js simulator that reuses the exact game
  logic from `nefesh.html` (copy-pasted, not a separate reimplementation) to
  run hundreds of simulated games with simple bots. Used to catch real rules
  bugs (dead games that could never resolve, a scoring bug that made the "smart"
  bot secretly play randomly) that weren't visible from manual play. Run with
  `node nefesh-sim.js <numGames> <maxRounds>`, e.g. `node nefesh-sim.js 500 3000`.

## Where things stand

The core mechanics (movement, dice, bonuses, captures, placement, turn order,
the Soul/Infinite/Body win conditions, and a draw rule for stalled games) are
implemented and have been tested against the rules as clarified in a long
back-and-forth. The visual design of the board (the figure-8 shape, the
central hub, the connections between the loops and the hub) went through many
iterations and is now considered settled.

## Good first thing to ask Claude Code to do

Something like: *"Read nefesh-spec.md and skim nefesh.html to understand this
project. Set up a git repo, then run nefesh-sim.js with a few different game
counts to confirm it still behaves as documented."* That'll get a fresh
session oriented without needing to re-explain the whole history.

## Ideas for next steps (not yet done)

- Broader/adversarial bot testing — the current bot in `nefesh-sim.js` uses a
  simple hand-tuned scoring heuristic. A smarter bot (or several different
  bots played against each other) might surface balance issues the current
  one can't find.
- The Infinite's fill color was left as "still deciding" — a checkered
  pattern was floated as an alternative to the current solid neutral tone.
- No tutorial/rules-summary is built into `nefesh.html` itself — right now a
  new player would need the spec doc alongside the prototype.
- The prototype is single-device, pass-and-play only. A remote/networked
  version isn't built.
- Real human playtesting (not just bots) — bots are good for catching rules
  bugs, not for judging whether the game is actually *fun* or well-balanced
  strategically.
