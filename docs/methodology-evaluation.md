# Methodology evaluation: trade finder, playoff and championship odds

Reviewed October 1, 2026 against commit `d56025f`. This review covers whether the trade finder's methodology is sound for improving rest-of-season (ROS) points, playoff chances, and championship chances. No code was changed.

## Summary

The structure is sound, and better than most fantasy trade tools. The inputs and the noise model are where it's weak. The app evaluates trades the right way, but the numbers it feeds in will make the playoff and championship percentages look more certain than they are. Much of the earlier review work (`docs/trade-methodology-review.md`, `projection-methodology-priorities.md`) has already been built in. What's left is mostly calibration.

## What's sound

- **Lineup scoring is mathematically correct.** Each week's best legal lineup is solved exactly, including flex and superflex, with byes and current-week OUT players handled (`lib/weekly-trades.ts`).
- **The comparison point is right.** Each trade is compared against your best *no-trade* option: your roster plus up to one free-agent add, not just your current roster. Without this, trades get credit for gains you could get off waivers.
- **Before/after comparisons are fair.** Both versions use the same random draws, so a difference in odds comes from the trade, not from luck in the simulation (`lib/trade-evaluation.ts`).
- **The season simulation is real.** It plays out the actual remaining schedule with ESPN tiebreakers, seeding and bracket, and it counts the effect of strengthening a rival (`lib/trade-outcomes.ts`).
- **Results stay honest.** Missing data and unsupported rules hide a number instead of guessing.

## Where it's not sound yet (ranked by impact)

### 1. Weekly scoring randomness is too low, so the odds come out overconfident

Every player's weekly score varies with a standard deviation of 35% of their projection (`scoreCv: 0.35` in `lib/trade-evaluation.ts`), using a normal (bell-curve) distribution. For a typical ~106-point lineup, that gives a team weekly spread of about 13 points. Real fantasy teams usually swing by about 20–25 points a week. With too little randomness:

- matchups look more predictable than they are;
- playoff odds get pushed toward 0% or 100%;
- the change in playoff/title odds from a trade is exaggerated for teams near the cutoff.

Real scores are also skewed (a few huge weeks), which a bell curve can't capture. This is the most important fix if title odds are the goal.

### 2. Rest-of-season projections are basically ESPN's season projection

`projectedPointsPerGame` is ESPN's full-season projected average (`lib/espn.ts:255-278`). Weekly projections only exist for the current week or so. That means later weeks are flat values that never use the actual results from this season so far. A trade finder built on one projection source tends to recommend buying the players ESPN rates higher than everyone else does. Sometimes that's a real edge, but often it's just ESPN being stale.

There's also a possible double-discount that wasn't confirmed. If ESPN's per-game average already accounts for expected missed games, then the 95% weekly availability factor counts injury risk twice.

### 3. Ranking by championship odds uses too few simulations

With "title" chosen as the target, the finder defaults to 64 simulations (`defaultScenarioSettings.samples`). That means odds move in steps of about 1.6 points. Picking the best of thousands of trades from numbers that rough tends to pick trades that got lucky in the simulation. Using the same random draws for every trade helps, but doesn't fix this. The season-odds panel uses 512 simulations, but still doesn't show how much the change itself could be noise.

### 4. Injuries don't last

Each week is a separate 95% chance the player suits up. Real injuries knock players out for several weeks in a row. This undervalues depth and undervalues the risk of relying heavily on one RB, which matters most for playoff weeks.

### 5. Smaller issues, fine to accept as limitations

- Other teams never change their rosters.
- Every team streams the same best free-agent K/D/ST.
- Managers are assumed to know each player's role change before setting lineups.
- Nothing estimates whether the other manager would actually accept.

## Recommended fixes, in order

1. **Calibrate the randomness from your own league's data.** The app already imports this season's weekly projections and actual scores for each player. Measure how far actual scores land from projections, by position, and set the randomness from that. A skewed distribution would fit better than a bell curve. This is cheap and fixes #1 with real evidence.
2. **Narrow the search in two stages.** Use points or 64 simulations to shortlist about 50 trades. Then rerun the shortlist with 1,000–2,000 simulations and a *different* random seed, and show a ± range on each change in odds.
3. **Blend ESPN projections with this season's actual results**, and adjust the projections toward average a little before ranking. Even a simple blend would cut the "trust ESPN's outliers" bias.
4. **Make injuries last several weeks**, with a modest weekly chance of injury.

## How to read the app today

Treat the point-gain rankings and the direction of the playoff/title changes as reliable. Don't trust the exact size of the playoff/title percentages, especially changes under ~3 points or teams near the playoff cutoff.
