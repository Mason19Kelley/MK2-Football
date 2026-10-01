'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { Search, Loader2, ArrowRight } from 'lucide-react';
import { League, points } from '@/lib/types';
import { TradeMoves } from './trade-moves';
import { TradeWeeklyComparison } from './trade-weekly-comparison';
import { TradeHorizon, horizonLabels } from '@/lib/weekly-trades';
import {
  findTrades,
  TradeCandidate,
  TradeRanking,
  TradeSearchProgress,
} from '@/lib/trade-finder';
import { runTradeSearch } from '@/lib/trade-search-client';
import {
  defaultScenarioSettings,
  ScenarioSettings,
} from '@/lib/trade-evaluation';
import { PlayoffScenario, TradeObjective } from '@/lib/trade-outcomes';
import { forecastSnapshot } from '@/lib/forecast-snapshots';
import { TradeSeasonOddsDisplay } from './trade-season-odds';
import { ScenarioBacktest } from './scenario-backtest';
import type {
  TradeSeasonOdds,
  TradeSeasonOddsInput,
} from '@/lib/trade-season-odds';

export function TradeFinder({
  league,
  myTeamId,
  horizon,
  playoffWeekOverride = '',
  onReview,
}: {
  league: League;
  myTeamId: number;
  horizon: TradeHorizon;
  playoffWeekOverride?: string;
  onReview: (trade: TradeCandidate) => void;
}) {
  const [partnerId, setPartnerId] = useState('all');
  const [tradeSize, setTradeSize] = useState('1');
  const [includePickup, setIncludePickup] = useState(false);
  const [minimumGain, setMinimumGain] = useState('1');
  const [ranking, setRanking] = useState<TradeRanking>('mine');
  const [waiverBaseline, setWaiverBaseline] = useState(true);
  const [paretoOnly, setParetoOnly] = useState(false);
  const [scenarioEnabled, setScenarioEnabled] = useState(false);
  const [scenarioSettings, setScenarioSettings] = useState<ScenarioSettings>(
    defaultScenarioSettings,
  );
  const [objective, setObjective] = useState<TradeObjective>('points');
  const [partnerMinimum, setPartnerMinimum] = useState('1');
  const [partnerHorizon, setPartnerHorizon] = useState<TradeHorizon | ''>('');
  const [playoffs, setPlayoffs] = useState<PlayoffScenario>({
    teams: league.playoffTeamCount ?? (league.teams.length >= 10 ? 6 : 4),
    startWeek: league.playoffStartWeek ?? 15,
    roundWeeks: league.playoffRoundWeeks ?? 1,
    reseed: league.playoffRules?.reseed ?? false,
  });
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof findTrades>
  > | null>(null);
  const [running, setRunning] = useState(false);
  const [checked, setChecked] = useState(0);
  const [progress, setProgress] = useState<TradeSearchProgress>({
    phase: 'preparing',
    evaluatedRosters: 0,
  });
  const [error, setError] = useState('');
  const [searchLeague, setSearchLeague] = useState<League | null>(null);
  const resultLeague = searchLeague ?? league;
  const [seasonMetrics, setSeasonMetrics] = useState<{
    searchResult: NonNullable<typeof result>;
    inputs: TradeSeasonOddsInput[];
    entries: { result?: TradeSeasonOdds; error?: string }[];
  }>();
  useEffect(() => {
    if (!result || !searchLeague || !result.candidates.length) return;
    const inputs = result.candidates.map((t) => ({
      league: searchLeague,
      myTeamId,
      partnerId: t.partnerId,
      plan: t.plan,
      baseline: t.baseline,
      scenarios: t.scenarios,
      playoffs: t.playoffs,
      streaming: !t.waiverBaseline,
    }));
    setSeasonMetrics({
      searchResult: result,
      inputs,
      entries: inputs.map(() => ({})),
    });
    let worker: Worker;
    const fail = () =>
      setSeasonMetrics((current) =>
        current?.searchResult === result
          ? {
              ...current,
              entries: current.entries.map((entry) =>
                entry.result
                  ? entry
                  : {
                      error:
                        'Season metrics calculation failed. Run Find trades again to retry.',
                    },
              ),
            }
          : current,
      );
    try {
      worker = new Worker(
        new URL('../lib/trade-season-odds-worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = ({
        data,
      }: MessageEvent<{
        index?: number;
        result?: TradeSeasonOdds;
        error?: string;
        done?: boolean;
      }>) => {
        if (data.done) {
          worker.terminate();
          return;
        }
        const index = data.index;
        if (index === undefined || index < 0 || index >= inputs.length) return;
        setSeasonMetrics((current) =>
          current?.searchResult === result
            ? {
                ...current,
                entries: current.entries.map((entry, i) =>
                  i === index
                    ? { result: data.result, error: data.error }
                    : entry,
                ),
              }
            : current,
        );
      };
      worker.onerror = () => {
        fail();
        worker.terminate();
      };
      worker.postMessage({ inputs });
    } catch {
      fail();
    }
    return () => worker?.terminate();
  }, [result, searchLeague, myTeamId]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setResult(null);
    setSearchLeague(null);
    setError('');
    return () => {
      controller.current?.abort();
    };
  }, [
    league.id,
    league.season,
    league.source,
    myTeamId,
    partnerId,
    tradeSize,
    includePickup,
    minimumGain,
    ranking,
    horizon,
    playoffWeekOverride,
    waiverBaseline,
    paretoOnly,
    scenarioEnabled,
    scenarioSettings,
    objective,
    partnerMinimum,
    partnerHorizon,
    playoffs,
  ]);
  useEffect(() => {
    setPartnerId('all');
  }, [league.id, league.season, league.source, myTeamId]);
  useEffect(() => {
    setPlayoffs({
      teams: league.playoffTeamCount ?? (league.teams.length >= 10 ? 6 : 4),
      startWeek: league.playoffStartWeek ?? 15,
      roundWeeks: league.playoffRoundWeeks ?? 1,
      reseed: league.playoffRules?.reseed ?? false,
    });
  }, [
    league.id,
    league.season,
    league.source,
    league.playoffTeamCount,
    league.playoffStartWeek,
    league.playoffRoundWeeks,
    league.playoffRules?.reseed,
  ]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    setResult(null);
    setSearchLeague(league);
    setError('');
    setChecked(0);
    setProgress({ phase: 'preparing', evaluatedRosters: 0 });
    try {
      // Allow the searching state to render before evaluating rosters.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const next = await runTradeSearch(league, myTeamId, {
        partnerId: partnerId === 'all' ? undefined : Number(partnerId),
        maxPlayers: tradeSize === '1' ? 1 : 2,
        unequal: tradeSize === 'unequal',
        allSizes: tradeSize === 'all',
        waiverBaseline,
        paretoOnly,
        scenarios: scenarioEnabled ? scenarioSettings : undefined,
        objective,
        playoffs: objective === 'title' ? playoffs : undefined,
        partnerMinimumGain: Number(partnerMinimum),
        partnerHorizon: partnerHorizon || undefined,
        includePickup,
        horizon,
        minimumGain: Number(minimumGain),
        ranking,
        signal: current.signal,
        onProgress: (count, next) => {
          if (current.signal.aborted) return;
          setChecked(count);
          if (next) setProgress(next);
        },
      });
      if (!current.signal.aborted) setResult(next);
    } catch (err) {
      if (!current.signal.aborted)
        setError(err instanceof Error ? err.message : 'Trade search failed.');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  return (
    <section className="panel trade-finder" aria-label="Trade finder">
      <div className="panel-heading">
        <div>
          <h3>Trade finder</h3>
          <p>Find trades that improve both teams’ best starting lineups.</p>
        </div>
        <Search size={20} />
      </div>
      <form onSubmit={search} className="finder-controls">
        <label>
          Search teams
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
          >
            <option value="all">All other teams</option>
            {league.teams
              .filter((t) => t.id !== myTeamId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Trade size
          <select
            value={tradeSize}
            onChange={(e) => setTradeSize(e.target.value)}
          >
            <option value="all">All supported sizes (up to two)</option>
            <option value={1}>One for one</option>
            <option value={2}>One for one + two for two</option>
            <option value="unequal">Two for one + one for two</option>
          </select>
        </label>
        <label>
          {objective === 'wins'
            ? 'Minimum expected-win gain'
            : objective === 'title'
              ? 'Minimum title-probability gain'
              : horizon === 'ros'
                ? 'Minimum ROS gain per team'
                : 'Minimum gain per team'}
          <input
            type="number"
            min="0"
            step={objective === 'points' ? '0.1' : '0.001'}
            required
            value={minimumGain}
            onChange={(e) => setMinimumGain(e.target.value)}
          />
        </label>
        <label>
          Rank results by
          <select
            value={ranking}
            onChange={(e) => setRanking(e.target.value as TradeRanking)}
          >
            <option value="mine">Your lineup gain</option>
            <option value="balanced">Balanced gains</option>
            <option value="combined">Combined gain</option>
            <option value="bargaining">Bargaining product</option>
            <option value="downside" disabled={!scenarioEnabled}>
              Your downside (10th percentile)
            </option>
          </select>
        </label>
        <button
          className="button primary"
          disabled={running || league.teams.length < 2}
          type="submit"
        >
          {running ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Search size={15} />
          )}
          {running ? 'Searching…' : 'Find trades'}
        </button>
        {running && (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              controller.current?.abort();
              setRunning(false);
            }}
          >
            Cancel search
          </button>
        )}
      </form>
      <details className="trade-methodology-settings">
        <summary>Evaluation assumptions</summary>
        <div className="finder-controls">
          <label>
            Objective
            <select
              aria-label="Objective"
              value={objective}
              onChange={(e) => {
                const next = e.target.value as TradeObjective;
                setObjective(next);
                if (next !== 'points') {
                  setPartnerHorizon('');
                  setScenarioEnabled(true);
                  setMinimumGain(next === 'title' ? '0.01' : '0.05');
                  setPartnerMinimum(next === 'title' ? '0.01' : '0.05');
                }
              }}
            >
              <option value="points">Projected points</option>
              <option value="wins" disabled={!league.matchups?.length}>
                Expected regular-season wins (scenario)
              </option>
              <option value="title" disabled={!league.matchups?.length}>
                Championship probability (scenario)
              </option>
            </select>
          </label>
          <label>
            Partner scoring period
            <select
              aria-label="Partner scoring period"
              value={partnerHorizon}
              disabled={objective !== 'points'}
              onChange={(e) =>
                setPartnerHorizon(e.target.value as TradeHorizon | '')
              }
            >
              <option value="">Same period as your team</option>
              {Object.entries(horizonLabels).map(([key, label]) => (
                <option
                  key={key}
                  value={key}
                  disabled={scenarioEnabled && key === 'ros'}
                >
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Partner minimum gain
            <input
              type="number"
              min="0"
              step="0.01"
              value={partnerMinimum}
              onChange={(e) => setPartnerMinimum(e.target.value)}
            />
          </label>
        </div>
        <label className="pickup-option">
          <input
            type="checkbox"
            checked={waiverBaseline}
            onChange={(e) => setWaiverBaseline(e.target.checked)}
          />{' '}
          Compare against each team's best no-trade add/drop (up to one
          acquisition)
        </label>
        <label className="pickup-option">
          <input
            type="checkbox"
            checked={paretoOnly}
            onChange={(e) => setParetoOnly(e.target.checked)}
          />{' '}
          Show only offers not dominated for either team within the same partner
        </label>
        <label className="pickup-option">
          <input
            type="checkbox"
            checked={scenarioEnabled}
            disabled={objective !== 'points'}
            onChange={(e) => {
              setScenarioEnabled(e.target.checked);
              if (!e.target.checked && ranking === 'downside')
                setRanking('mine');
            }}
          />{' '}
          Model availability, role changes and scoring uncertainty
        </label>
        {scenarioEnabled && (
          <>
            <div className="finder-controls">
              {(
                [
                  ['samples', 'Scenario samples', 8, 512, 8],
                  ['seed', 'Scenario seed', 0, 2147483647, 1],
                  [
                    'availability',
                    'Weekly availability probability',
                    0,
                    1,
                    0.01,
                  ],
                  [
                    'scoreCv',
                    'Scoring variation (× position defaults)',
                    0,
                    2,
                    0.01,
                  ],
                  [
                    'roleCv',
                    'Role variation (fraction of forecast)',
                    0,
                    2,
                    0.01,
                  ],
                  [
                    'teamCorrelation',
                    'Shared NFL-team scoring correlation',
                    0,
                    1,
                    0.01,
                  ],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={scenarioSettings[key]}
                    onChange={(e) =>
                      setScenarioSettings({
                        ...scenarioSettings,
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="finder-note">
              These are editable assumptions; check them against your league’s
              past weeks below. Availability draws are independent by week; role
              changes persist across the horizon. Lineups use availability and
              role information before scoring noise is drawn. IR return
              scenarios require room to activate the player.
            </p>
            <ScenarioBacktest league={league} settings={scenarioSettings} />
          </>
        )}
        {objective === 'title' && (
          <>
            <div className="finder-controls">
              <label>
                Playoff teams
                <select
                  value={playoffs.teams}
                  onChange={(e) =>
                    setPlayoffs({
                      ...playoffs,
                      teams: Number(e.target.value) as PlayoffScenario['teams'],
                    })
                  }
                >
                  {[2, 4, 6, 8]
                    .filter((n) => n <= league.teams.length)
                    .map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                </select>
              </label>
              <label>
                Scenario playoffs start
                <input
                  type="number"
                  min={league.week + 1}
                  max={league.finalWeek}
                  value={playoffs.startWeek}
                  onChange={(e) =>
                    setPlayoffs({
                      ...playoffs,
                      startWeek: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Weeks per playoff round
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={playoffs.roundWeeks}
                  onChange={(e) =>
                    setPlayoffs({
                      ...playoffs,
                      roundWeeks: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label className="pickup-option">
              <input
                type="checkbox"
                checked={playoffs.reseed}
                onChange={(e) =>
                  setPlayoffs({ ...playoffs, reseed: e.target.checked })
                }
              />{' '}
              Reseed remaining teams after each round
            </label>
            <p className="finder-note">
              Use the full remaining season. This declared bracket seeds by
              winning percentage and the imported league tiebreakers when
              available, with byes for top seeds. Imported divisions and current
              playoff results are retained. Imported round weeks apply when
              these settings match the league; otherwise round lengths describe
              a scenario. Unsupported rules withhold the affected odds.
            </p>
          </>
        )}
        {!league.matchups?.length && (
          <p className="finder-note">
            Sync ESPN to load the full matchup schedule and enable win
            objectives. Existing snapshots remain usable for points.
          </p>
        )}
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            const snapshot = forecastSnapshot(league, {
              horizon,
              objective,
              scenarios: scenarioEnabled ? scenarioSettings : undefined,
              playoffs: objective === 'title' ? playoffs : undefined,
              waiverBaseline,
            });
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(snapshot, null, 2)], {
                type: 'application/json',
              }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `mkii-football-forecasts-${league.id}-${league.season}-${Date.now()}.json`;
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export forecast snapshot for future validation
        </button>
        <p className="finder-note">
          Snapshot exports record today's forecasts and settings without owner
          identities or realized player results. They do not reconstruct
          historical offer-time data or create acceptance labels.
        </p>
      </details>
      {!waiverBaseline && tradeSize === 'unequal' && (
        <label className="pickup-option">
          <input
            type="checkbox"
            checked={includePickup}
            onChange={(e) => setIncludePickup(e.target.checked)}
          />{' '}
          Include an optional free-agent pickup in the open spot
        </label>
      )}
      <p className="finder-note">
        {horizonLabels[horizon]} · Unequal swaps include a drop plan. D/ST,
        kickers and IR players are excluded. Both teams must gain under the
        selected objective. Search covers the selected package sizes and roster
        policy. Acceptance likelihood is not estimated.
      </p>
      <div role="status" className="finder-status">
        {running &&
          (progress.phase === 'preparing'
            ? `Preparing no-trade baselines… ${progress.evaluatedRosters.toLocaleString()} roster plans evaluated.`
            : `Checked ${checked.toLocaleString()} trades… ${progress.evaluatedRosters.toLocaleString()} roster plans evaluated.`)}
        {result &&
          (result.matched
            ? `Showing ${result.candidates.length} of ${result.matched.toLocaleString()} improving trades (${result.checked.toLocaleString()} checked).`
            : `No trades met these criteria (${result.checked.toLocaleString()} checked). Try a lower minimum gain, more teams, another period, or a different trade size.`)}
      </div>
      {searchLeague && searchLeague !== league && (running || result) && (
        <p className="finder-note">
          New league data is available.{' '}
          {running ? 'This search uses' : 'These results use'} the data from
          when the search started. Run Find trades again to use the latest data.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && result.skipped.length > 0 && (
        <p className="finder-note">
          Skipped teams needing projections or eligible starters for this
          period: {result.skipped.join(', ')}.
        </p>
      )}
      {result && result.unplannable > 0 && (
        <p className="finder-note">
          Skipped {result.unplannable.toLocaleString()} packages without a valid
          drop plan.
        </p>
      )}
      {result && (
        <div className="finder-note">
          <p>
            Your no-trade baseline: {points(result.baselineTotal)}
            {result.baselineUpperTotal !== result.baselineTotal
              ? ` to ${points(result.baselineUpperTotal)}`
              : ''}{' '}
            points.
            {result.baseline.drop &&
              ` Drop ${(result.baseline.drops ?? [result.baseline.drop]).map((p) => p.name).join(', ')}.`}
            {result.baseline.pickup && ` Add ${result.baseline.pickup.name}.`}
          </p>
          {result.frontierCount !== undefined && (
            <p>
              {result.frontierCount} nondominated offers remain before the
              result limit.
            </p>
          )}
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <div className="finder-results">
        {result?.candidates.map((t, index) => {
          const partner = resultLeague.teams.find((p) => p.id === t.partnerId)!;
          return (
            <article
              className="finder-card"
              key={`${t.partnerId}:${t.send.map((p) => p.id)}:${t.receive.map((p) => p.id)}`}
            >
              <div className="finder-card-heading">
                <h4>{partner.name}</h4>
                <span className="count-chip">
                  {t.send.length} for {t.receive.length}
                </span>
              </div>
              <div className="finder-swap">
                <div>
                  <span className="eyebrow">YOU SEND</span>
                  {t.send.map((p) => (
                    <p key={p.id}>
                      <strong>{p.name}</strong>
                      <small>
                        {p.position} · {points(p.ros)} ROS
                      </small>
                    </p>
                  ))}
                </div>
                <div>
                  <span className="eyebrow">YOU RECEIVE</span>
                  {t.receive.map((p) => (
                    <p key={p.id}>
                      <strong>{p.name}</strong>
                      <small>
                        {p.position} · {points(p.ros)} ROS
                      </small>
                    </p>
                  ))}
                </div>
              </div>
              <div className="finder-gains">
                <div>
                  Your points{' '}
                  <strong>
                    {t.mine.gain >= 0 ? '+' : ''}
                    {points(t.mine.gain)}
                  </strong>
                  <small>
                    {points(t.mine.before.total)} → {points(t.mine.after.total)}{' '}
                    pts
                  </small>
                </div>
                <div>
                  Their points{' '}
                  {t.partnerHorizon && t.partnerHorizon !== t.horizon && (
                    <small>{horizonLabels[t.partnerHorizon]}</small>
                  )}
                  <strong>
                    {t.partner.gain >= 0 ? '+' : ''}
                    {points(t.partner.gain)}
                  </strong>
                  <small>
                    {points(t.partner.before.total)} →{' '}
                    {points(t.partner.after.total)} pts
                  </small>
                </div>
              </div>
              {(t.plan.mine.drop ||
                t.plan.partner.drop ||
                t.plan.mine.pickup ||
                t.plan.partner.pickup ||
                t.send.length !== t.receive.length) && (
                <TradeMoves plan={t.plan} partnerName={partner.name} />
              )}
              {t.baseline && (
                <p className="finder-note">
                  No-trade alternatives: your team{' '}
                  {t.baseline.mine.pickup
                    ? `adds ${t.baseline.mine.pickup.name}${t.baseline.mine.drop ? ` and drops ${(t.baseline.mine.drops ?? [t.baseline.mine.drop]).map((p) => p.name).join(', ')}` : ''}`
                    : 'keeps its roster'}
                  ; {partner.name}{' '}
                  {t.baseline.partner.pickup
                    ? `adds ${t.baseline.partner.pickup.name}${t.baseline.partner.drop ? ` and drops ${(t.baseline.partner.drops ?? [t.baseline.partner.drop]).map((p) => p.name).join(', ')}` : ''}`
                    : 'keeps its roster'}
                  .{' '}
                  {t.mine.after.bounded || t.partner.after.bounded
                    ? 'Gains use after lower bounds minus the best before upper bounds.'
                    : ''}
                </p>
              )}
              {t.mine.uncertainty && (
                <p className="finder-note">
                  Your scenario gain: 10th percentile{' '}
                  {points(t.mine.uncertainty.p10)}; improvement in{' '}
                  {(100 * t.mine.uncertainty.probabilityImproves).toFixed(0)}%
                  of scenarios; Monte Carlo standard error{' '}
                  {t.mine.uncertainty.standardError.toFixed(3)} (
                  {t.mine.uncertainty.samples} samples). This measures the
                  configured model, not forecast calibration.
                </p>
              )}
              {(t.plan.mine.pickup || t.plan.partner.pickup) && (
                <p className="finder-note">
                  Gains without the optional pickup: your team{' '}
                  {t.tradeOnly.mine >= 0 ? '+' : ''}
                  {points(t.tradeOnly.mine)} · their team{' '}
                  {t.tradeOnly.partner >= 0 ? '+' : ''}
                  {points(t.tradeOnly.partner)}. Shown gains include the pickup.
                </p>
              )}
              {seasonMetrics?.searchResult === result && (
                <TradeSeasonOddsDisplay
                  input={seasonMetrics.inputs[index]}
                  result={seasonMetrics.entries[index]?.result}
                  error={seasonMetrics.entries[index]?.error}
                />
              )}
              {horizon !== 'ros' ? (
                <LineupDetails>
                  <TradeWeeklyComparison
                    league={resultLeague}
                    before={
                      t.baseline?.mine.roster ??
                      resultLeague.teams.find((p) => p.id === myTeamId)!.players
                    }
                    after={t.plan.mine.roster}
                    scenarios={t.scenarios}
                    streaming={!t.waiverBaseline}
                    name="Your team"
                  />
                  <TradeWeeklyComparison
                    league={resultLeague}
                    before={t.baseline?.partner.roster ?? partner.players}
                    after={t.plan.partner.roster}
                    scenarios={t.scenarios}
                    streaming={!t.waiverBaseline}
                    name={partner.name}
                  />
                </LineupDetails>
              ) : (
                <LineupDetails>
                  {(
                    [
                      ['Your team', t.mine],
                      [partner.name, t.partner],
                    ] as const
                  ).map(([name, impact]) => (
                    <div key={name} className="finder-lineup">
                      <strong>{name}</strong>
                      <p>
                        Before:{' '}
                        {impact.before.players.map((p) => p.name).join(', ')}
                      </p>
                      <p>
                        After:{' '}
                        {impact.after.players.map((p) => p.name).join(', ')}
                      </p>
                    </div>
                  ))}
                </LineupDetails>
              )}
              <button className="button secondary" onClick={() => onReview(t)}>
                Review in trade lab <ArrowRight size={14} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LineupDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>See starting lineup changes</summary>
      {open ? children : null}
    </details>
  );
}
