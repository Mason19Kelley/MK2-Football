# Sunday

A responsive fantasy football web app for viewing your ESPN league, exploring projections, and trying trades. Built with Next.js App Router, React, TypeScript, and Lucide icons.

## Run locally

Requires Node.js 20.9+ and npm.

```sh
npm install
npm run dev
```

Open http://localhost:3000. The app opens with an explicitly labeled sample league so you can explore every feature before connecting ESPN. No environment variables, database, or paid services are required.

## Connect ESPN

1. Click **Connect ESPN**.
2. Paste your ESPN league URL (containing `leagueId`) or numeric league ID and choose its season.
3. For a private league, check **My league is private**. While signed into ESPN, find the `espn_s2` and `SWID` cookie values in your browser's developer tools under **Application → Cookies** (Chrome) or **Storage → Cookies** (Firefox), and paste them into the corresponding fields. Sunday never asks for your ESPN password.
4. Select your roster using **View team**, then **Set as my team**. You can also choose your team inside Trade lab.

The server fetches `mTeam`, `mRoster`, `mMatchup`, and `mSettings` from ESPN's read API, then paginates `kona_player_info` for available active players. The connection is saved on the server with AES-256-GCM encryption. The browser receives a random HttpOnly, SameSite cookie, never ESPN credentials. Imported data and your team selection remain in local storage. **Refresh ESPN** uses the saved connection without asking for cookies again. Stale data refreshes every five minutes while the page is visible, including when you reopen or return to the app. Automatic refresh pauses after an expired connection; reconnect once with fresh cookies. Refreshes preserve custom ROS overrides and team selections; a new connection replaces projections. **Disconnect** deletes the saved connection and returns to the sample league. The connection lasts up to 180 days, subject to ESPN session expiry.

Connection files and the encryption key live in `data/espn-connections/` (ignored by Git, restricted filesystem permissions). For deployment, set `ESPN_CONNECTION_DIR` to a private persistent volume shared by all app instances; preserve its `.key` across restarts. Ephemeral serverless filesystems need a persistent storage adapter before deploying this feature. No refresh requests run while the app is closed.

This is an unofficial ESPN integration, not OAuth or an ESPN partnership. ESPN can change or restrict its endpoint. Private access depends on a valid signed-in session. A live public league import was verified during development; private import is covered with mocked browser responses and needs your credentials to verify against your league.

Implementation references: [ESPN read API](https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/899513?view=mTeam&view=mRoster&view=mSettings), and the [espn-api maintainer's player normalization](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/player.py).

## What works

- View all league rosters, choose your team, and browse league rankings.
- Search players and filter by position or starters/bench/IR.
- Switch weekly / rest-of-season projections and sort players by name or projected points.
- View records, starter totals, position contribution charts, and injury flags.
- Export your current roster to CSV.
- Upload your own ROS projections and restore original values.
- Browse free agents and players on waivers, filter by position and availability, and compare a potential add/drop against your roster with weekly or ROS projections.
- Select players on both sides of a hypothetical trade and compare the best eligible starting lineups. No trades or roster changes are sent to ESPN.
- Find equal-size or two-for-one trades with drop and optional pickup plans, then review the same moves in the simulator.
- Compare weekly optimized starters and coverage for the next three weeks, playoffs, or the full remaining season.
- Use the same functionality on mobile; league snapshots and custom projections persist across reloads.

D/ST and kickers are included in rosters, team projections, and waiver comparisons, but are always excluded from trade-finder offers. Individual defensive players and their starting slots are excluded throughout the app.

## Projection methodology

Weekly points use the current week's ESPN `appliedTotal` with your league's scoring rules. Season points are actual points scored so far.

ROS points use a sum of ESPN's future weekly forecasts **only when every remaining league week has a forecast**. Otherwise, they estimate ESPN's projected season average × remaining league weeks (including the current week). If a season average is unavailable but season projected points exist, the average is season projected points / 17. These estimates are labeled **EST.** and do not adjust future byes, injuries, or schedule strength. Completed seasons have zero remaining points. Missing projections appear as **—**, are excluded from totals, and prevent a trade recommendation.

Sample rosters, NFL affiliations, records, and projections are illustrative, not current rankings or player forecasts. League ranks compare current starting rosters' ROS totals; incomplete data can reduce a team's total.

To use another source, download a template in **Projection settings** and upload a CSV:

```csv
player_id,ros_points
3918298,285.5
```

Player IDs must belong to a league roster or the imported waiver pool. The template includes both. Projection values must be finite and nonnegative, with no duplicate IDs. Values must reflect your league's scoring and remaining season. Blank values should be filled or their rows removed before uploading. Unlisted players retain their existing projections; custom values are labeled **CUSTOM**. Uploads are validated completely before any values are applied. Files stay in the browser.

## Trade model

Trade lab uses an exact maximum-weight assignment for starting lineups, including repeated slots, flex, superflex and team QB. Weekly periods optimize each week separately: **Full remaining season**, **Next three weeks**, or **Playoff weeks**. **Season-total lineup (legacy)** uses a single ROS lineup. Playoff timing is imported from ESPN matchup periods and can be overridden.

By default, both finder and simulator measure each offer against each team's best no-trade roster policy with **up to one immediate free-agent acquisition**. The policy evaluates legal adds into open spots and add/drops even when the current starting lineup is complete. The same acquisition budget applies after a trade, in addition to any required capacity drop. Incoming players are protected from drops. Post-trade plans are allocated jointly, so the same free agent cannot belong to both teams. Each team's no-trade baseline is a separate counterfactual with other teams keeping their current rosters; these two alternatives need not both be executable simultaneously.

The default evaluation uses these fixed planned rosters for all selected weeks. It does not assume unlimited future streaming or that today's pool remains available later. The optional baseline opt-out retains the legacy vacancy-replacement evaluation for deterministic comparisons. Results show concrete no-trade moves, post-trade drops/pickups, and gains without the post-trade acquisition. Review carries the same policy and scenario settings into the simulator. No move is submitted to ESPN.

Roster capacity uses imported settings, adjusted for hidden players; older snapshots use the current non-IR roster count. Supplied player locks, league trade locks, remaining acquisitions and position limits are enforced. These transaction restrictions are not currently imported from ESPN. Current-week games are assumed unplayed; processing delays, player game locks, waiver priority, FAAB, future free-agent competition and keeper value are not inferred. Pickups remain conditional on real availability. IR return scenarios assume activation is feasible and need roster room in practice.

Search modes cover 1:1, 1:1 plus 2:2, unequal 2:1 plus 1:2, or **all supported sizes together**. D/ST, kickers and IR players are excluded from finder packages; they still participate in eligible lineups. Manual equal-size packages can be larger; plans allow at most one net extra player per team. Searches exhaustively evaluate the selected package set and supported roster policy in a worker, with responsive cancellation. Results are limited to 20 and report checked/matching counts. This is optimality within the selected package scope and imported player pool, not a claim of the best possible larger trade or roster-management policy.

Rank by your gain, the smaller gain, combined gain, the product of both gains, or scenario downside (10th percentile). The bargaining product is an offer-ranking heuristic, not acceptance likelihood. A Pareto filter removes offers dominated on both teams' mean objective gains within the same partner. Your minimum gain and the partner's minimum are independent. Points evaluations can use a different scoring horizon for the partner. Both teams must improve; point gains must exceed 0.05, while win/title gains must be positive. Acceptance probabilities require historical offer-time features and calibrated real proposal data; no acceptance model is fabricated from completed trades.

### Forecasts, bounds and outcome scenarios

Known byes and current-week OUT, DOUBTFUL, INACTIVE and suspended players are unavailable. IR stays excluded in deterministic mode. Missing future weekly forecasts use a nonnegative residual ROS allocation after known forecasts. Unknown byes are assumed playable. Custom ROS totals are spread across non-bye weeks. These estimates do not predict matchups, roles or injury recovery.

**Evaluation assumptions and forecast overrides** accepts an atomic CSV import with `player_id` and `week` required. Optional columns are:

```csv
player_id,week,weekly_points,lower_points,upper_points,availability_probability,return_week,score_stddev,role_stddev
3918298,5,24,,,0.95,,7,0.1
3918298,6,,18,30,,,,
```

Week 0 represents a ROS total; other weeks represent points under your league scoring. `score_stddev` is scoring noise in points; `role_stddev` is a fractional forecast deviation. Probabilities must be between 0 and 1. A return week is an explicit manager assumption, not an inferred recovery date. Weekly overrides take priority over source forecasts, but do not rewrite a separate ROS total; use a weekly period or supply a week-0 value. Imported forecasts retain timestamps and provenance, persist with the browser snapshot, and survive same-league/same-season refresh. **Restore imported forecasts and remove player scenarios** clears manager overrides using the original imported snapshot.

Missing projections remain unknown unless explicit lower/upper bounds are supplied. In conservative points mode, recommendations use after lower bounds minus the best no-trade upper bound, so irrelevant bounded bench values can stop blocking stable conclusions. Unbounded potentially relevant missing values still suppress recommendations. Bounds do not silently imply a zero forecast. Outcome simulation requires point forecasts for those players rather than a fabricated distribution inside the bounds.

Enable outcome scenarios to model weekly availability, persistent role changes, scoring noise and shared NFL-team scoring correlation. Defaults are editable assumptions, **not historically calibrated forecasts**. Each player/week receives the same seeded draws across all offers. Availability and role information are observed before selecting starters; realized scoring noise is drawn afterwards, preventing hindsight. Results show mean gain, 10th-percentile gain, fraction of scenarios improving, and paired Monte Carlo standard error. Sampling error does not measure forecast accuracy or remove the optimizer's curse. Availability is independent across weeks beyond explicit return assumptions; unsupported injury durations and waiver competition are not modeled.

**Expected regular-season wins** requires a complete imported matchup schedule for the selected period. Whole multi-week matchups are summed. Partial/in-progress multi-week matches, missing schedules, regular-season byes and overlapping/doubleheader schedules are rejected rather than guessed. ESPN imports now request matchup data; old snapshots need a refresh. Both traded rosters are updated when evaluating opponents.

**Championship probability** requires the full remaining season and a declared future playoff scenario: 2, 4, 6 or 8 teams, equal round lengths, and optional reseeding. The simulator seeds on wins/ties, points-for, then team ID; top seeds receive byes and higher seeds win playoff score ties. It simulates advancement, so eliminated teams' later weeks do not contribute to title chances. It does not claim parity with leagues using divisions, head-to-head seeding tiebreakers, other playoff tie rules or an already-started bracket. Verify that the declared scenario matches your league before interpreting its probability. Strengthening a rival is reflected in your title utility.

**Export forecast snapshot for future validation** saves current forecast inputs, standings, schedule, timestamps and scenario settings, without owner identities or realized player results. It provides a starting point for out-of-time validation; it is not a reconstruction of historical offer-time features and contains no acceptance labels. Historical prediction calibration and model training still require an appropriate dataset.

## Waiver wire

Use **Waiver wire** in the sidebar, choose your team, then select one player to drop and one available player to add. Both lists group QB, RB, WR, TE, K, and defense, with higher projections first within a position. Filter both lists by position, search available players by name or NFL team, and distinguish free agents from players currently on waivers. Toggle weekly or ROS projections.

The comparison shows both the selected players' point difference and the change to the best eligible starting lineup. A stronger bench player may increase the player comparison while leaving starting lineup points unchanged. Missing projections or an unfillable starting slot suppress lineup recommendations; player comparisons remain available when the selected players have projections. The page never submits a claim or drop to ESPN.

Available players are fetched on each ESPN sync using the same private-session credentials, then saved with the roster snapshot. Previously saved leagues need one sync to load their waiver pool. Imports exclude league-rostered players and deduplicate the available pool. Pagination stops at 4,000 active available players ordered by ESPN ownership; the page explicitly labels a truncated pool. Failed waiver retrieval preserves the roster import and prompts another sync. Availability can change after import; refresh before acting in ESPN. The simulation does not enforce roster or IR capacity, acquisition locks, waiver priority, claim deadlines, or FAAB.

## Validation

```sh
npm test                       # ESPN normalization, projections, CSV validation, trade optimizer
npm run typecheck
npx playwright install chromium # once, for browser tests
npm run test:e2e                # roster browsing, trade flows, ESPN errors, CSV, mobile, credential handling
npm run build
npm start                      # production server after build
```

The optimizer is also checked against exhaustive assignments on varied small rosters. Browser tests mock ESPN for repeatable import and credential tests; they do not require an account or network access to ESPN.

## Code map

- `app/api/espn/route.ts` — server-side ESPN proxy, request validation, timeouts, and useful errors.
- `lib/espn.ts` — typed ESPN normalization and projection source labels.
- `lib/waivers.ts` — available-player import, pagination, normalization, and add/drop comparison.
- `components/waiver-page.tsx` — waiver browser and projection comparison.
- `lib/trades.ts` — maximum-weight lineup assignment and trade simulation.
- `lib/trade-finder.ts` — cancellable trade search, independent team impacts, and ranking.
- `lib/trade-plans.ts` — symmetric one-acquisition baselines and joint legal roster plans.
- `lib/trade-evaluation.ts` — bounded forecasts and seeded outcomes without scoring hindsight.
- `lib/trade-outcomes.ts` — matchup utility and explicitly configured playoff brackets.
- `lib/trade-search-client.ts` / `lib/trade-worker.ts` — cancellable worker searches.
- `lib/forecast-snapshots.ts` — forecast-input exports for future validation.
- `lib/weekly-trades.ts` — weekly availability, estimate allocation, and time horizons.
- `components/trade-finder.tsx` — search controls, trade suggestions, and lineup comparisons.
- `lib/projections.ts` — atomic projection CSV parsing and overrides.
- `lib/demo.ts` — sample league fixtures.
- `components/dashboard.tsx` — dashboard, roster browser, trade UI, and connection/settings dialogs.
- `app/globals.css` — responsive styling and charts.

Current scope is a single-manager app with local browser storage. It has no user accounts, cloud sync, automatic background polling, or persistent ESPN credential store. Deploy as a Node-capable Next.js app with HTTPS. For a public multi-user service, add authentication, request rate limits, encrypted credential management if background sync is introduced, and a durable database.

## ESPN trade-history collection

**Connect ESPN / Change connection → Import trade history for this season** imports accessible proposal, acceptance, decline, veto, and uphold records. **Trade lab → Trade history** shows coverage, recent records, and **Export trade dataset** downloads normalized JSON. History is saved with the browser's league snapshot. Older snapshots work without history. Turn the checkbox off for a faster roster-only import.

For collecting several seasons or leagues into local files:

```sh
npm run collect:trades -- --league 899513 --seasons 2024,2025
npm run collect:trades -- --league 123456 --seasons 2025,2026 --output data/trade-history
```

For private leagues, set `ESPN_S2` and `ESPN_SWID` in the collector's environment. Do not place cookies in command arguments or dataset files. Each season writes a new timestamped JSON file; default output is git-ignored. Collection is read-only, has bounded concurrency/timeouts, and reports failed weeks. A partial collection still writes the accessible records and exits with status 1. Repeated snapshots must be deduplicated by league, season, source, and event ID before combining them for analysis.

The collector queries `mTransactions2` for preseason week 0 through the current/final week (capped at 25), and paginates up to 500 completed-trade activity topics from `kona_league_communication`. ESPN's unofficial endpoints may withhold player details, omit transaction history, or return 404 for historical activity. Coverage describes requests that succeeded, not a guarantee that ESPN disclosed every offer. Normalized exports omit member identities and credentials; player IDs and team IDs are retained. Displayed player names come from the imported roster and are not historical valuation features.

`events` preserves separate transaction stages and activity records. `examples` contains at most one binary label per explicitly linked offer component, requiring an executed acceptance/decline and an unambiguous complete two-team player package. Exact ESPN `relatedTransactionId` links can recover a hidden package from another record. Pending/canceled/error records, vetoes, conflicting labels, changed packages, partial packages, and unsupported assets are excluded. Completed activity records are retained separately and never matched to proposals by a guessed date or player combination. Counts are records, not unique completed trades.

This is the data-collection stage, not a trained acceptance model. Every example has `historicalFeatures: null`: offer-time rosters, injuries, scoring settings, and player valuations must be acquired before training. Do not substitute today's projections or future performance. Unmade trades are not rejected offers. Model validation should hold out later seasons and entire leagues, then evaluate calibration on real accepted/declined proposals. One league's completed trades alone cannot justify acceptance percentages.

Implementation references: [ESPN transaction reader](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/league.py), [transaction fields](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/transaction.py), [activity fields](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/activity.py).
