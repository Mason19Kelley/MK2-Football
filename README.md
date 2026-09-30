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

The server fetches `mTeam`, `mRoster`, and `mSettings` from ESPN's read API, then paginates `kona_player_info` for available active players. Credentials are used only in that request and cleared afterward; they are never logged, stored, or returned to the browser. Imported league data and your team selection are saved in this browser's local storage. **Sync ESPN** refreshes the snapshot and replaces any custom projection overrides. Private leagues need their session cookies again on each sync.

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

In **Trade lab**, choose a scoring period: **Full remaining season**, **Next three weeks**, **Playoff weeks**, or the legacy **Season-total lineup**. The period applies to both the finder and simulator. Playoff timing is imported from ESPN regular-season matchup periods, including multi-week periods. You can override the playoff start week; leagues without this setting need a start week before playoff searches work.

The finder searches all other teams or a selected partner. Trade sizes include one-for-one, one-for-one plus two-for-two, and **two-for-one plus one-for-two**. Each result must improve both teams' optimized lineups over the selected period by more than 0.05 points and meet the minimum gain. Results can be ranked by your gain, balanced gains, or combined gain. It returns the top 20 and reports the total matches and checked packages. Searches can be canceled; changing teams, projections, period, or search settings clears stale results.

Unequal trades include a concrete roster plan. The team receiving an extra player gets a drop suggestion only when needed for roster capacity. Imported capacity accounts for players hidden by the app (such as defenses); older snapshots use current non-IR roster counts as a conservative fallback. Drops keep incoming players and favor the best projected lineup, preserving stronger depth on ties. If you open a spot, optionally include a free-agent pickup that improves the planned lineup. Players on waivers and newly dropped players are excluded from these immediate pickup suggestions. The candidate pool is reduced only when another free agent with the same starting-slot eligibility dominates it in every evaluated week. The finder labels pickup-dependent gains and shows gains without the pickup. Review loads the package and pickup choice into the simulator, which uses the same planner.

Weekly evaluation optimizes each week's lineup independently with a maximum-weight assignment that supports repeated slots, flex, superflex, and team QB without double-counting a player. Known NFL byes and current-week OUT, DOUBTFUL, INACTIVE, and suspended players are unavailable. IR players stay excluded throughout the horizon; future injury recovery is not inferred from today's status. A week with insufficient available starters displays the empty slots and scores them as zero, rather than hiding all trade results for that team. Missing projection values suppress recommendations. Weekly details show both teams' before/after starters, coverage, and gains, plus next-three-week, playoff, and remaining-season summaries.

ESPN weekly forecasts, including explicit zeros, are retained on roster and waiver players. Missing weeks use a nonnegative residual ROS estimate after subtracting known forecasts, allocated across unforecast weeks. Known byes score zero and do not increase other estimated weeks to compensate. Custom ROS overrides are evenly allocated across non-bye weeks and labeled estimates. Sample forecasts and byes are illustrative. If bye metadata is missing, the UI states that unknown byes are assumed playable. Schedule fetch failures preserve imported rosters and prompt another sync. These estimates do not predict future injuries, changing roles, or matchup strength.

Kickers and IR players are excluded from finder trade packages; kickers still fill eligible starting slots and can be free-agent replacements. Manual trades can contain larger equal-size packages, but unequal plans support at most one net extra player per team. Acceptance likelihood is not estimated. Roster plans do not enforce position-specific roster limits, acquisition locks, transaction deadlines, waiver rules, or keeper value. No trade, pickup, or drop is submitted to ESPN.

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
- `lib/trade-plans.ts` — unequal roster plans and optional free-agent replacements.
- `lib/weekly-trades.ts` — weekly availability, estimate allocation, and time horizons.
- `components/trade-finder.tsx` — search controls, trade suggestions, and lineup comparisons.
- `lib/projections.ts` — atomic projection CSV parsing and overrides.
- `lib/demo.ts` — sample league fixtures.
- `components/dashboard.tsx` — dashboard, roster browser, trade UI, and connection/settings dialogs.
- `app/globals.css` — responsive styling and charts.

Current scope is a single-manager app with local browser storage. It has no user accounts, cloud sync, automatic background polling, or persistent ESPN credential store. Deploy as a Node-capable Next.js app with HTTPS. For a public multi-user service, add authentication, request rate limits, encrypted credential management if background sync is introduced, and a durable database.

## ESPN trade-history collection

**Connect ESPN / Sync ESPN → Import trade history for this season** imports accessible proposal, acceptance, decline, veto, and uphold records. **Trade lab → Trade history** shows coverage, recent records, and **Export trade dataset** downloads normalized JSON. History is saved with the browser's league snapshot. Older snapshots work without history. Turn the checkbox off for a faster roster-only import.

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
