# Trade finder methodology review

Reviewed September 30, 2026 against the current working tree, including existing uncommitted weekly replacement changes. This is a methodology review; application behavior has not been changed. No live league snapshot or historical projection dataset was available in the repository, so numerical findings below use controlled fixtures rather than claims about your actual team.

## What the existing model gets right

`lib/trades.ts` solves starting lineups using maximum-weight bipartite matching through min-cost flow. This correctly handles flex, superflex, repeated slots, and the fact that one player cannot start twice. Keep this solver as the lineup component of a larger model.

`lib/weekly-trades.ts` optimizes separate weekly lineups, accounts for known byes, retains explicit zero forecasts, and labels estimated forecasts. This captures rotation and bye coverage that a static ROS lineup misses.

`lib/trade-finder.ts` exhaustively enumerates eligible packages within the selected sizes and partner scope. Its top results are exact for that finite candidate set under its deterministic evaluation, roster planner, and mutual-gain filter. The supported search does not establish optimality over larger packages, other roster moves, or uncertain season outcomes.

`lib/trade-plans.ts` includes capacity-driven drops and optional pickups for unequal packages. This is better than comparing nominal player values without evaluating the resulting roster.

Verification: all 56 existing unit tests passed, including exhaustive small lineup checks and package checks. `npm run typecheck` passed. These validate the implemented rules, not whether those rules maximize winning chances.

## Current mathematical objective

For roster R and selected weeks H, the weekly model is approximately:

```
V(R) = sum over w in H of max over eligible lineups L of
       sum over players p in L of projected_points(p, w)

gain_i(t) = V(planned roster_i after t) - V(current roster_i)
```

The actual implementation prioritizes owned starters and supplements vacancies with hypothetical free agents. It does not optimize all legal add/drop policies.

The finder requires both gains to exceed 0.05 points and meet the same configured minimum. Rankings maximize your gain, the smaller gain, or their sum. These are distinct objectives; none universally means “best trade.”

For a head-to-head redraft league, my recommended ultimate objective is your incremental championship probability, or expected prize utility if payouts are the goal. For a total-points league, expected total points may be the appropriate objective. Keeper/dynasty rules require future asset value too.

## 1. Measure against the best feasible no-trade alternative

**Highest priority; demonstrated ranking failure.**

The weekly evaluator only uses free agents when owned players cannot fill the lineup. A complete but weak lineup receives no waiver improvement. The planner considers pickups only for a team that loses one net player and opens a spot. Therefore a trade can look beneficial even when an available add/drop is better.

I ran the current finder on this one-week fixture, with one RB and one WR starting:

| Team | Owned RB projections | Owned WR projections |
| --- | --- | --- |
| Yours | 20, 19 | 5 |
| Partner | 5 | 20, 19 |

The pool contains a free-agent WR projected for 20 and a free-agent RB projected for 20. Swapping your backup RB (19) for their backup WR (19) produces:

| Plan | Your lineup | Partner lineup |
| --- | --- | --- |
| Current baseline | 25 | 25 |
| Recommended trade | 39 | 39 |
| No trade; drop the weak starter and add the relevant free agent | 40 | 40 |

The finder reports +14/+14, although both teams have a better same-capacity no-trade move. Those two pickups use different free agents and are jointly feasible in this fixture.

Replace the baseline with:

```
V0_i = max over feasible no-trade roster policies a of U_i(a)
Vt_i = max over feasible post-trade roster policies a of U_i(t, a)
incremental_gain_i(t) = Vt_i - V0_i
```

Start with an explicit “up to one immediate legal add/drop” policy on both sides, applied symmetrically before and after every trade. Do not claim this is unrestricted optimal roster management. Show the best no-trade move next to the trade result. Include acquisition limits, roster capacity, positional limits, transaction timing, and any known locks. If waiver/FAAB data are absent, label the policy as a scenario rather than silently assuming guaranteed acquisition.

Also make future replacements feasible across time: one hypothetical streamer cannot simultaneously belong to both teams; next week's pool is not guaranteed to match today's; streaming requires roster moves and may carry acquisition costs. Evaluate alternative availability scenarios when those facts are unknown.

## 2. Optimize wins and playoff outcomes when that is the league objective

**Potentially the largest strategic improvement; requires more imported data.**

An extra 10 points in an already comfortable matchup can matter less than 3 points in a close matchup. A simplified deterministic example: your baseline scores are 100 and 100 against opponents scoring 80 and 101. A trade that adds 10 in week one adds more total points but leaves you with one win; a trade that adds 3 in week two gives you two wins. Real outcomes require distributions, but the distinction remains.

For a first approximation, model score difference D in each matchup. A normal approximation gives:

```
P(win) ≈ Phi((mean_your_score - mean_opponent_score) / sd(D))
Var(D) = Var(your_score) + Var(opponent_score)
         - 2 * Cov(your_score, opponent_score)
```

The approximation needs calibration and special handling for zero variance and ties. It is a diagnostic, not a promise of accurate percentages.

A full season simulator should update both traded rosters, simulate the remaining schedule, standings, tiebreakers, seeding, byes, and playoff advancement under actual league rules. Report changes in expected wins, playoff probability, and championship probability separately. Strengthening a direct rival can reduce your title chances even while improving your own projected points.

The current `League` type lacks matchup schedules, complete playoff format/tiebreakers, and player outcome distributions. Import or explicitly configure these before presenting title probabilities. Playoff-only projected points currently value weeks even if your team would be eliminated; simulation should condition advancement on earlier outcomes.

## 3. Give depth, injuries, and forecast uncertainty explicit value

**Current deterministic depth valuation is incomplete.**

A backup who never beats a healthy starter's forecast has little or zero lineup value unless known byes create an opening. Real backups also insure against injury and changing roles. The planner's ROS tie-breaking rule preserves some depth, but does not price this insurance.

Represent availability as a state over time, including return-to-play and transitions. In `playerWeek`, IR players are excluded for the entire horizon, while today's OUT/DOUBTFUL flag generally only affects the current week. Both are modeling conventions, not recovery forecasts. Do not infer a return date without data; accept manager scenarios when necessary.

Simulate availability, role, pregame forecast revisions, and scoring separately. Choose starters using information available before kickoff, then draw realized points for the selected lineup. Optimizing a lineup after drawing realized scores would give the manager hindsight and systematically overvalue depth.

Use the same sampled season scenarios for before/after and competing trades, so comparisons have less simulation noise. Model shared injuries, team pace, weather, and QB/receiver relationships where supported. Report mean incremental utility, downside quantiles, and model-implied probability of improvement, plus Monte Carlo error. Keep epistemic forecast uncertainty separate from ordinary game-to-game variability.

Searching many noisy estimates can select unusually optimistic errors, the optimizer's curse. Use out-of-time forecast validation, calibrated shrinkage, and sensitivity analyses instead of assuming the largest projected gain is trustworthy. See [Smith and Winkler's original research](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.1050.0451).

If a manager wants downside protection, offer a clearly stated risk-sensitive objective, such as expected gain with a lower-tail loss constraint. A fixed universal penalty on variance is inappropriate: an underdog may benefit from volatility. [Duchi's notes on optimization with uncertain data](https://web.stanford.edu/class/ee364b/lectures/robust_notes.pdf) discuss scenario and risk formulations; their application here is a proposed design, not a validated fantasy model.

## 4. Separate your objective from partner willingness

The current mutual projected-points filter defines the feasible offer set using the same utility for both teams. A partner might prefer injury insurance, keeper value, or playoff weeks. Their perceived values can also differ from your forecasts.

Keep explicit partner-gain constraints as a transparent option. Do not equate them with an acceptance probability. Permit partner-specific horizons, minimums, and declared valuation assumptions when supplied by the manager.

For browsing, retain the nondominated frontier within each partner: offers where no alternative is at least as good on both teams' chosen utilities and strictly better on one. Add a selectable bargaining score such as the product of positive gains above each team's best no-trade alternative. This is a negotiation heuristic, not evidence of acceptance. “Balanced” currently maximizes the smaller raw point gain; it is not a calibrated fairness or willingness model.

If acceptance predictions eventually become available, an isolated offer can be ranked by:

```
expected proposal value =
  P(accepted | offer-time information) * incremental_utility_if_accepted
  + P(rejected) * incremental_utility_if_rejected
  - proposal/delay costs
```

This is only a one-off decision approximation. Counteroffers, alternative partners, and sequential proposals require a policy model. No arbitrary acceptance percentage should be added now.

The history collector correctly excludes ambiguous labels and leaves `historicalFeatures` null. Acquire historical offer-time rosters, forecasts, injuries, settings, and manager information before training. Today’s values and realized future performance are leakage. Hold out later seasons and entire leagues; evaluate probability calibration and proposal-selection bias. Unmade trades are not rejections.

## 5. Improve missing-data handling and forecast contracts

**Second demonstrated coverage problem.** I appended one unprojected bench player to an otherwise complete fixture. `findTrades` threw its projection error before searching. Missing counts cover all non-IR roster players, rather than only players who might change a decision. A single irrelevant unknown can therefore disable every offer.

Do not silently assign zero. Use explicit imputation with uncertainty, or bounds: evaluate whether an unknown player's plausible low/high projections can change the lineup or trade ordering. Recommend only when the conclusion is stable over defensible bounds; otherwise explain which missing value matters. Without an upper bound, irrelevance cannot simply be assumed.

The import falls back to season projected average times remaining weeks, or season projected points / 17. Missing weekly forecasts then receive a residual estimate. Custom ROS totals are allocated differently, over non-bye weeks. Document whether each source supplies a total, per-calendar-week mean, per-active-game mean, or conditional-on-playing mean. These are different quantities. Add source-specific checks for units, timestamp, league scoring, consistency of totals with partial forecasts, and bye treatment. Avoid applying an availability discount twice.

Store weekly overrides, forecast timestamps, provenance, and forecast error history. Blending sources should use historically validated performance under your scoring system, not an arbitrary averaging rule. Do not bolt on strength-of-schedule adjustments without checking whether the source already includes them.

## 6. Expand search while preserving honest optimality claims

Current modes search 1:1; 1:1 plus 2:2; or 2:1 plus 1:2. There is no single combined mode and no 3-player package support. Adding sizes can reveal valid positional exchanges, but increases the search rapidly.

For two 15-player eligible rosters, all four currently supported package shapes contain:

```
15*15 + C(15,2)*C(15,2) + 2*15*C(15,2) = 14,400 packages
```

Adding 3:3 alone contributes 207,025 packages per partner, before evaluating drop/pickup variants or season scenarios.

First add a combined supported-size search, retaining exhaustive deterministic evaluation. Before larger packages or simulation, move computation into a worker, cache package impacts carefully, and use proven bounds or an integer optimization formulation. The current planner supports at most one required drop per team and protects incoming players from being dropped; general packages need a broader legal planner too.

A deterministic shortlist followed by simulation is practical but can miss the best uncertainty-aware offer. Include candidates that benefit under injury/availability scenarios, and clearly call the final result the best among evaluated candidates. A globally best claim requires an exhaustive search or valid bounds for the actual final objective.

Existing same-eligibility pickup dominance pruning is tailored to deterministic weekly forecasts and availability. Revisit its proof when adding costs, uncertain availability, shared free-agent competition, or player-specific rules.

## Suggested implementation order and acceptance criteria

| Stage | Change | Evidence required |
| --- | --- | --- |
| 1 | Symmetric legal waiver baseline; show no-trade alternative; all supported sizes together | The +14/+14 counterexample is removed or flagged; exhaustive tiny action-set comparisons agree |
| 2 | Forecast contract, weekly overrides, bounded missing data, timing/roster constraints | Unknown irrelevant bench values no longer block stable conclusions; decisions change when bounds genuinely matter |
| 3 | Availability/role scenarios and decision-time lineup policy | Healthy depth has measurable insurance value; IR return scenarios work; no realized-score hindsight |
| 4 | Matchup and season simulation | The two-week win example is ranked correctly; bracket, tiebreaker, and direct-rival fixtures agree with exhaustive small seasons |
| 5 | Partner utility frontier and validated acceptance modeling | Probabilities are evaluated on held-out real offers; offer-time features contain no future information |

Backtest frozen historical snapshots using only information available then. Compare against the current model, the best no-trade waiver policy, and simple replacement-value baselines. Separate tests of mathematical solver correctness, prediction calibration, ranking stability, and decision quality. Realized points alone do not reveal whether a trade was a sound decision, and unobserved alternative offers cannot supply acceptance labels.

The first useful upgrade does not require replacing the exact lineup solver. It requires defining what “best” means, evaluating trades against feasible alternatives, and making the uncertainty and search scope explicit.
