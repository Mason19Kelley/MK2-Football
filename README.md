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
- Find trades across the league that improve both teams’ optimized starting lineups, then load a result into the trade simulator.
- Use the same functionality on mobile; league snapshots and custom projections persist across reloads.

Defenses and individual defensive players are excluded throughout the app, including sample rosters, ESPN imports, waiver pools, saved snapshots, and starting-lineup slots. Kickers remain available in rosters and waiver comparisons.

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

In **Trade lab → Trade finder**, choose all other teams or a specific partner, one-for-one trades or one-for-one plus two-for-two trades, and a minimum ROS gain for each team. The finder exhaustively searches those equal-size swaps and shows the top 20 results ranked by your gain, the smaller of the two gains (balanced), or combined gain. Every result must improve both optimized lineups by more than 0.05 points and meet the chosen minimum. Expand a result to compare starting players, or choose **Review in trade lab** to load both sides into the calculator. Searches can be canceled; changing projections, your team, or search settings clears old results. Teams with missing projections or incomplete starting lineups are reported and skipped.

Equal-size swaps preserve roster counts. Kickers and IR players are always excluded from trade packages. Acceptance likelihood is not estimated. Candidate generation, the mutual-improvement filter, and result ranking are separate in `lib/trade-finder.ts`, allowing a later objective and acceptance model to use the same lineup impacts.

The calculator finds a maximum-weight assignment between players and the league's starting slots, using ESPN slot eligibility. It supports repeated slots, flex, superflex, and team QB; each player fills at most one slot. IR players are excluded. Before and after lineups are optimized independently for both teams. Recommendations require both rosters to have full projection coverage and enough eligible players to fill every starting slot.

This first model compares season-total lineup potential. It does not simulate week-by-week lineups, byes, future injuries, waiver replacements, roster limits, keeper value, or playoff schedules. These are natural next steps for a fuller trade calculator. A trade may require drops or additional moves in ESPN even if the simulator can fill a lineup.

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
- `components/trade-finder.tsx` — search controls, trade suggestions, and lineup comparisons.
- `lib/projections.ts` — atomic projection CSV parsing and overrides.
- `lib/demo.ts` — sample league fixtures.
- `components/dashboard.tsx` — dashboard, roster browser, trade UI, and connection/settings dialogs.
- `app/globals.css` — responsive styling and charts.

Current scope is a single-manager app with local browser storage. It has no user accounts, cloud sync, automatic background polling, or persistent ESPN credential store. Deploy as a Node-capable Next.js app with HTTPS. For a public multi-user service, add authentication, request rate limits, encrypted credential management if background sync is introduced, and a durable database.
