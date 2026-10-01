# Proposal: weekly scoring randomness (methodology evaluation item #1)

Written October 1, 2026 against commit `d56025f`. This follows up on item #1 in `docs/methodology-evaluation.md`. It covers how public analysts and open-source simulators model weekly scoring randomness, and proposes a replacement for the current model. No code was changed.

## Summary

The model's structure already matches what the more careful public simulators do. The problems are the numbers, the bell-curve shape, and one layer that's sized too small. The research also shows that the "real teams swing 20–25 points a week" figure in the evaluation doc is probably too high.

## How others handle this

**How much a player's score swings, by position.** Public work measures this as the coefficient of variation (CV): a player's weekly standard deviation divided by their average. For established starters it's about QB 0.36–0.40, RB 0.50–0.60, WR 0.58–0.70, TE 0.63–0.80 (PlayerProfiler, Underdog). For players projected to score less, the swing is bigger *relative to* their projection. So the spread doesn't grow in proportion to the projection; it's closer to a fixed amount plus a share of the projection.

**Projections don't remove much of that swing.** Subvertadown found the gap between projection and actual score is almost as wide as the raw weekly swing: for QBs, 7.5 vs. 8.0. An 11-season study by Fantasy Football Analytics found the best weekly projections explain only 3–23% of the variation in actual scores. RBs are the most predictable; QB, WR and TE are mostly under 10%. Weekly projections aren't biased on average; QBs come in about 0.76 points under. So the swing around the projection should be close to the raw swing, not much narrower. The current 0.35 for every position is a QB-level number applied to everyone.

**Shape.** Scores pile up near zero and have a long tail of big weeks. The usual choices are a gamma or a lognormal distribution, not a bell curve (Footballguys, Stan forums). The best-documented open-source simulator found, syndicate-football, uses a lognormal for each player's week.

**Teammates' scores move together.** On scores relative to projection:

- QB–WR is the strongest positive link, then QB–TE.
- QB–RB is about 0 (+0.07).
- WR–WR on the same team is about 0 (−0.02).
- RB–WR is slightly negative, since they take touchdowns from each other.
- WR and their own team's D/ST are negative.

The often-quoted QB–WR1 figure of about 0.55 comes from single-game DFS slates. Over a full season it's closer to +0.27 (RotoWire, Subvertadown). The current model uses one shared team factor of 0.2 for every pair of teammates.

**Two separate kinds of uncertainty.** Syndicate-football splits them:

- **Week-to-week luck**, redrawn every week.
- **How wrong the season projection is**, drawn once per simulated season.

They set both from their own league's past scores and check every change against the previous season. This app already has the second kind: `roleCv`, drawn once per player per sample. At 0.10 it's set very low.

**Team-level check.** One analysis puts the spread of half-PPR team scores at about 17.4 points around a 109-point average (byron-cobalt). Adding up the position numbers above gives about 19–21 for a typical lineup. The current model gives about 13.

## What this means for the current model

1. **The week-to-week spread is too small for every position except QB.** 0.35 should be roughly 0.40 for QB, 0.55 for RB, 0.60 for WR and 0.65 for TE.
2. **A fixed percentage of projection makes low projections too predictable.** That understates the upside of cheap players and bench depth.
3. **The bell curve is cut off at zero (`Math.max(0, …)` on the role multiplier) and has no long tail of big weeks.**
4. **The season-projection error (`roleCv` = 0.10) matters more than it looks over a rest-of-season horizon.** Over 10 weeks, week-to-week luck averages down: a WR's 0.55 weekly CV becomes about 0.17 on their average. A 10% error in the projected average doesn't shrink at all. For rest-of-season points and playoff odds, this is arguably the bigger miss.
5. **One shared factor for all teammates** treats RB–WR and WR–WR pairs as positively linked when they're about flat or negative, and it misses QB–pass-catcher stacks.

## Proposed solution

**A. Swap the bell curve for a lognormal.** It's about one line in `noise()` and the scoring reduce in `lib/trade-evaluation.ts`.

- With z the correlated normal draw the model already makes, a player's score becomes `μ · exp(s·z − s²/2)`, where `s² = ln(1 + (σ/μ)²)`.
- The average stays at μ, scores can't go below zero, and big weeks get a realistic tail.
- It keeps the shared random draws and team correlation as they are, so the same trick syndicate-football uses still applies.
- D/ST can go negative, so shift it: draw `(score + 5)` lognormally, then subtract 5.
- For in-progress games, apply the same draw to `mean` (the unplayed portion), scaled by `√remainingFraction` as now.

**B. Set the spread per position as a fixed amount plus a share of projection**, `σ = a_pos + b_pos · μ`. Starting values, before calibration:

| Pos  | Target CV at a typical starter's projection |
| ---- | ------------------------------------------- |
| QB   | 0.40                                        |
| RB   | 0.55                                        |
| WR   | 0.60                                        |
| TE   | 0.65                                        |
| K    | ~0.50                                       |
| D/ST | ~0.80                                       |

The K and D/ST values are estimates; the public sources mostly rank them rather than giving numbers. Pick `a_pos` so a player projected at 5 points comes out around CV 0.8–1.0. A player-specific `scoreStdDev` override still takes precedence.

**C. Raise the season-projection error and set it per position.** Start `roleCv` around 0.20 for RB/WR/TE and 0.15 for QB. Draw it as a lognormal multiplier rather than `max(0, 1+…)`. This is the most uncertain number in the proposal, so it should come from the league's own data (step E).

**D. Replace the single shared team factor with position-specific weights.** Use one "passing game" factor per NFL team per week, weighted roughly QB 0.6, WR 0.45, TE 0.35, RB 0.1 and K 0.2. Then give each RB/WR pair a small negative link (about −0.1), and give D/ST a negative weight on the opposing team's passing factor. Fit the weights to the targets above: QB–WR about 0.27, WR–WR about 0, QB–RB about 0. This step is lower priority than A–C, but it's what correctly values trading for or away from a QB's top receiver.

**E. Calibrate on the league's own data, starting from the public numbers.**

- Start from the values in B and C as if they came from about 200 player-weeks per position.
- Blend in the league's own errors: `CV²_post = (n₀·CV²_prior + Σ (actual−proj)²/proj²) / (n₀ + n)`. Do the same for `roleCv`, using how far each player's actual per-game average has moved from their preseason projection.
- Pull **prior seasons** for the league through ESPN's `seasonId` history. That gives thousands of player-weeks under the league's exact scoring rules, instead of relying on 4 noisy weeks.
- One thing to check first: `weeklyPoints(stats, 1)` will read past-week projections if ESPN returns them, but `lib/espn.ts` only asks for the current `scoringPeriodId`. Past weeks may need one request per week.

**F. Gate the change with a backtest, not a gut check.**

- For every past week, compare each team's actual score to its simulated distribution.
- The z-score SD should be about 1.0, and 80% of actual scores should land inside the 80% interval.
- Also score the matchup win probabilities (Brier score) against a 50/50 baseline.
- Accept parameter changes only if they improve these.

This replaces the evaluation doc's "20–25 points" claim with a measured number. The public evidence suggests the real answer is around 17–21.

## Suggested order

A + B (small, low-risk), then F so the change can be measured, then E, then C, then D.

## Caveats

- Bigger, more realistic noise will make item #3 in the evaluation doc (too few simulations for the title target) worse. The two-stage shortlist rerun matters more after this change.
- The K/D/ST CVs and the starting `roleCv` are estimates, not published figures.

## Sources

- [PlayerProfiler – Player Variance Manifesto](https://www.playerprofiler.com/article/the-player-variance-manifesto/)
- [Underdog – Weekly Variance By Position](https://underdognetwork.com/football/best-ball-research/weekly-variance-by-position-a-key-to-best-ball)
- [Subvertadown – Point vs Error Distributions](https://subvertadown.com/article/fantasy-score-distributions-point-distributions-vs-error-distributions)
- [Subvertadown – Pairing/Stacking Correlations](https://subvertadown.com/article/pairing-stacking-analysis-correlations-between-the-different-fantasy-positions)
- [Fantasy Football Analytics – 11 Seasons of DFS Projections](https://fantasyfootballanalytics.net/2026/09/we-analyzed-11-seasons-of-dfs-projections-heres-what-we-found.html)
- [RotoWire – Does Stacking Work](https://www.rotowire.com/football/article/does-stacking-work-in-fantasy-football-what-four-years-of-data-say-about-drafting-correlated-players-2026-131409)
- [Footballguys – Expectation and Variance](https://www.footballguys.com/article/DFS_expectationvariance)
- [Stan Forums – response distribution for fantasy points](https://discourse.mc-stan.org/t/determining-optimal-response-distribution-for-modeling-growth-curves-of-nfl-players-fantasy-football-points-in-brms/38302)
- [syndicate-football (GitHub)](https://github.com/Brandon-Kimberly/syndicate-football)
- [byron-cobalt – Don't Use Points To Judge Value](https://byron-cobalt.com/2023/09/10/dont-use-points-to-judge-fantasy-football-value-fantasy-games-won-launch-2023/)
