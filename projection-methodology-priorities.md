# Projection methodology improvement priorities

Ranked by expected accuracy gain relative to implementation effort.

1. **Incorporate current-week actual scores and locked lineups.** Fixes a clear correctness gap once games start; improves matchup odds and every downstream season metric.
2. **Import exact league playoff and tiebreaker rules.** Prevents playoff and championship percentages from answering the wrong question.
3. **Unify player and team ROS around consistent weekly forecasts.** Resolves discrepancies and improves the inputs underlying ROS points, matchup win percentage, expected W–L, championship percentage, and playoff-make percentage.
4. **Build historical validation and calibration.** Establishes which assumptions actually work and measures whether subsequent changes improve accuracy. Start collecting forecast snapshots immediately.
5. **Model injury duration and return probabilities.** Replaces independent weekly availability with realistic multiweek absences and recoveries.
6. **Fit position-specific scoring distributions and correlations.** Improves matchup probabilities and season uncertainty; requires historical forecast-error data.
7. **Make streaming assumptions realistic.** Account for competition, exclusive ownership, and transaction constraints—or use a conservative replacement baseline.
8. **Handle missing forecasts and align displayed points with simulated expectations.** Prevents misleading totals and unjustifiably precise odds.
9. **Increase simulations and report uncertainty.** Relatively straightforward, but improves numerical stability more than predictive accuracy.
10. **Model imperfect lineup decisions and uncertain role information.** Removes optimistic assumptions, but adds substantial complexity and requires evidence about manager behavior.

**Recommended first batch: 1–3, while starting data collection for 4.** The order shifts if the app is only used before games or the league already matches its assumed playoff rules.

## Evaluation context

The simulation framework is sound, but the percentages are not historically calibrated, and several assumptions can materially distort them. Expected W–L is internally consistent with matchup odds; championship and playoff odds inherit the same weaknesses and add playoff-rule assumptions.

The review covered the implementation and 40 relevant tests, all of which passed. Two projection discrepancies were reproduced. Those tests establish correct lineup assignment, conserved wins/losses, coherent playoff probabilities, and reproducibility; they do not establish that the probabilities predict real outcomes accurately.

## Detailed findings and improvements

### 1. Incorporate current-week actual scores and locked lineups

Matchup odds simulate the entire current week without incorporating points already scored or locked lineups. Changing a player's current-week actual score from 0 to 100 produced identical forecasts. This makes the numbers unreliable once games begin.

**Improve:** Bank actual points, retain locked starters, and simulate only remaining games. This fixes a correctness gap affecting matchup odds, expected W–L, playoff qualification, and championship odds.

Implementation: [Simulation code](lib/trade-evaluation.ts).

### 2. Import exact league playoff and tiebreaker rules

Qualification uses wins plus half-credit ties, then points scored, then team ID. The dashboard assumes a fixed bracket, equal round lengths, and higher-seed victories on playoff ties. Divisions, head-to-head tiebreakers, and other formats are not imported. Week 18 is excluded, and forecasts cannot continue into an already-started playoff bracket.

**Improve:** Import actual qualification, seeding, bracket, and tie rules; support unequal round lengths and the current playoff state. Calculate qualification odds separately so unsupported championship formats do not also suppress playoff-make odds.

Implementation: [Seeding and bracket evaluation](lib/trade-outcomes.ts), [dashboard bracket assumptions](lib/season-forecast.ts), [week limit](lib/types.ts).

### 3. Unify player and team ROS around consistent weekly forecasts

Player ROS uses complete future weekly projections when available; otherwise, it uses season-average points multiplied by remaining calendar weeks. Team ROS instead sums separately optimized weekly lineups, accounting for known byes and including hypothetical K/D/ST streaming. A reproduced example showed 80 player ROS points while that player's weekly forecasts totaled 60 because of a bye.

Missing weeks receive an equal share of ROS after subtracting known forecasts. That allocation includes a possible bye in its denominator, then assigns the bye zero. A particularly high known projection also lowers every unknown future week, even if it merely reflects a favorable opponent. Estimated future weeks lack matchup-specific information.

**Improve:** Derive player and team ROS from one consistent weekly forecast dataset, with clear labels distinguishing player production from lineup contribution. Estimate unknown weeks independently using current role and opponent information. Explicitly distinguish per-game averages from remaining-season totals before adjusting for byes.

Implementation: [Player ROS](lib/espn.ts), [weekly estimation](lib/weekly-trades.ts), [team ROS](components/dashboard.tsx).

### 4. Build historical validation and calibration

The model's default assumptions are not historically calibrated. Passing consistency tests does not show whether a reported 70% chance corresponds to an event occurring approximately 70% of the time. Without forecasts captured before games and later observed outcomes, the relative benefit of changing variance, injury, correlation, or lineup assumptions remains uncertain.

**Improve:** Save forecasts before games, evaluate point errors and probability performance on later weeks, and use reliability curves alongside Brier score and log loss. Evaluate on data separate from the data used to fit assumptions or calibration. Start collecting forecast snapshots immediately, even while implementing the first three priorities.

Reliability curves directly compare predicted probabilities with observed event frequencies. Brier score and log loss measure overall probability performance, including both calibration and discrimination; they do not isolate calibration by themselves.

References: [Existing forecast snapshot support](lib/forecast-snapshots.ts), [probability calibration documentation](https://scikit-learn.org/stable/modules/calibration.html).

### 5. Model injury duration and return probabilities

Every player defaults to 95% availability independently each week. Current OUT/DOUBTFUL statuses affect only this week; IR players remain unavailable indefinitely unless an explicit return assumption exists. Consequently, a multiweek injury can be understated, while an eventual IR return can be omitted entirely.

**Improve:** Use injury-specific return distributions and persistent injury states. Establish whether source projections already include missed-game risk before applying another availability discount.

Implementation: [Availability rules](lib/weekly-trades.ts), [scenario defaults and availability sampling](lib/trade-evaluation.ts).

### 6. Fit position-specific scoring distributions and correlations

Everyone receives normally distributed scoring noise with standard deviation equal to 35% of their projected score. Same-NFL-team players share a blanket positive correlation of 20%; opposing teams have no shared game effect. The model can generate negative offensive scores and cannot represent position-specific tails or different relationships between quarterbacks, receivers, running backs, and defenses.

**Improve:** Fit forecast-error distributions by position and scoring format, then estimate relevant player-pair and game-level dependencies. Their actual benefit needs backtesting and historical forecast-error data.

Implementation: [Scoring model](lib/trade-evaluation.ts).

### 7. Make streaming assumptions realistic

Each team can independently use the best projected free agents from today's pool every week. Multiple opponents can therefore benefit from the same player in the same simulated week. Acquisition limits, roster space, and competition are not modeled here. Other positions receive no comparable future roster management.

**Improve:** Simulate exclusive acquisitions across the league, or use a conservative streaming baseline with realistic availability and transaction constraints.

Implementation: [Streaming candidate pool](lib/weekly-trades.ts).

### 8. Handle missing forecasts and align displayed points with simulated expectations

Matchup points use deterministic optimal lineups; odds use simulated availability, role changes, and scoring noise. The displayed totals therefore are not the expected scores underlying the percentages. Missing projections can also depress simulated scores while the app still displays precise probabilities.

**Improve:** Label deterministic totals clearly, optionally show simulated expected scores, and withhold or qualify odds when consequential forecasts are missing.

Implementation: [Matchup display calculations](lib/season-forecast.ts).

### 9. Increase simulations and report uncertainty

Season forecasts use 512 simulations and display percentages to one decimal place. Under an independent-sample approximation, a true 50% chance has roughly ±4.3 percentage points of 95% sampling uncertainty at that count, before model error. Repeatability from a fixed seed does not remove that uncertainty.

**Improve:** Increase simulations, check convergence across seeds, and report uncertainty. More simulations improve numerical stability, not the underlying assumptions or predictive accuracy.

Implementation: [Season simulation count](lib/season-forecast.ts).

### 10. Model imperfect lineup decisions and uncertain role information

The simulator observes each player's sampled season-long role change before selecting starters. Managers effectively know which players received hidden upward or downward adjustments immediately. It avoids hindsight about realized scoring, which is good, but still gives managers perfect knowledge of modeled role changes and availability.

**Improve:** Distinguish underlying ability from information available at lineup deadlines, and account for late scratches and imperfect lineup decisions. This removes optimistic assumptions but adds substantial complexity and requires evidence about manager behavior.

Implementation: [Scenario lineup selection](lib/trade-evaluation.ts).
