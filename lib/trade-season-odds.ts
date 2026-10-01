import { League } from './types';
import { TradePlan } from './trade-plans';
import {
  createScenarioCache,
  defaultScenarioSettings,
  evaluateForecastRoster,
  ScenarioSettings,
} from './trade-evaluation';
import {
  evaluateLeagueOutcomes,
  PlayoffScenario,
  OutcomeSummary,
  validateOutcomeSchedule,
  validateQualification,
} from './trade-outcomes';

export type TradeSeasonOddsInput = {
  league: League;
  myTeamId: number;
  partnerId: number;
  plan: TradePlan;
  baseline?: TradePlan;
  scenarios?: ScenarioSettings;
  playoffs?: PlayoffScenario;
  streaming: boolean;
};

// One worker shares scenario draws and immutable roster evaluations across all
// displayed offers. Point ranking never waits for these full-season metrics.
export function createTradeSeasonForecaster(
  settings: Pick<
    TradeSeasonOddsInput,
    'league' | 'scenarios' | 'playoffs' | 'streaming'
  >,
) {
  const { league, streaming } = settings;
  const playoffs = settings.playoffs ?? {
    teams: league.playoffTeamCount ?? (league.teams.length >= 10 ? 6 : 4),
    startWeek: league.playoffStartWeek!,
    roundWeeks: league.playoffRoundWeeks ?? 1,
    reseed: league.playoffRules?.reseed ?? false,
    rounds: league.playoffRounds,
  };
  validateOutcomeSchedule(league, 'remaining', 'wins');
  let qualificationError = '';
  try {
    validateQualification(league, playoffs);
  } catch (error) {
    qualificationError =
      error instanceof Error
        ? error.message
        : 'Unsupported qualification rules.';
  }
  let championshipError = '';
  try {
    validateOutcomeSchedule(league, 'remaining', 'title', playoffs);
  } catch (error) {
    championshipError =
      error instanceof Error ? error.message : 'Unsupported playoff format.';
  }
  const scenarios = settings.scenarios ?? {
    ...defaultScenarioSettings,
    samples: 512,
    seed: league.season,
  };
  const scenarioCache = createScenarioCache(league, scenarios);
  const cache = new Map<string, ReturnType<typeof evaluateForecastRoster>>();
  const evaluationIds = new WeakMap<
    ReturnType<typeof evaluateForecastRoster>,
    number
  >();
  const evaluate = (roster: League['teams'][number]['players']) => {
    const key = JSON.stringify(roster);
    let evaluation = cache.get(key);
    if (!evaluation) {
      evaluation = evaluateForecastRoster(league, roster, 'remaining', {
        scenarios,
        scenarioCache,
        streaming,
      });
      if (!evaluation.complete || evaluation.missing > 0)
        throw new Error(
          'Complete weekly lineup forecasts for every team are needed to estimate season odds.',
        );
      evaluationIds.set(evaluation, cache.size);
      cache.set(key, evaluation);
    }
    return evaluation;
  };
  const unchanged = new Map(
    league.teams.map((team) => [team.id, evaluate(team.players)]),
  );
  const outcomes = (evaluations: typeof unchanged) => {
    try {
      return evaluateLeagueOutcomes(
        league,
        evaluations,
        'remaining',
        championshipError ? 'wins' : 'title',
        qualificationError ? undefined : playoffs,
      );
    } catch (error) {
      championshipError =
        error instanceof Error ? error.message : 'Unsupported playoff bracket.';
      return evaluateLeagueOutcomes(
        league,
        evaluations,
        'remaining',
        'wins',
        qualificationError ? undefined : playoffs,
      );
    }
  };
  const outcomeCache = new Map<string, ReturnType<typeof outcomes>>();
  const evaluateOutcomes = (evaluations: typeof unchanged) => {
    // Evaluations are shared immutable objects; their IDs identify the complete
    // before/after league state without serializing every simulated score.
    const key = [...evaluations]
      .map(([id, e]) => `${id}:${evaluationIds.get(e)}`)
      .join(',');
    let result = outcomeCache.get(key);
    if (!result) {
      result = outcomes(evaluations);
      outcomeCache.set(key, result);
    }
    return result;
  };
  return (
    input: Pick<
      TradeSeasonOddsInput,
      'myTeamId' | 'partnerId' | 'plan' | 'baseline'
    >,
  ) => {
    const { myTeamId, partnerId, plan, baseline } = input;
    const before = new Map(unchanged);
    if (baseline) {
      before.set(myTeamId, evaluate(baseline.mine.roster));
      before.set(partnerId, evaluate(baseline.partner.roster));
    }
    const after = new Map(before);
    after.set(myTeamId, evaluate(plan.mine.roster));
    after.set(partnerId, evaluate(plan.partner.roster));
    const beforeOutcomes = evaluateOutcomes(before),
      afterOutcomes = evaluateOutcomes(after);
    const record = (id: number, outcome: OutcomeSummary) => {
      const team = league.teams.find((t) => t.id === id)!;
      return {
        wins: team.wins + outcome.wins - outcome.ties * 0.5,
        losses: team.losses + outcome.losses,
        ties: team.ties + outcome.ties,
      };
    };
    return {
      teams: [myTeamId, partnerId].map((id) => ({
        id,
        before: beforeOutcomes.get(id)!,
        after: afterOutcomes.get(id)!,
        beforeRecord: record(id, beforeOutcomes.get(id)!),
        afterRecord: record(id, afterOutcomes.get(id)!),
      })),
      qualificationError,
      championshipError,
      description: `${scenarios.samples} full-season simulations with the same random draws before and after. Expected records include completed games and remaining regular-season matchups. Before uses ${baseline ? 'the selected no-trade roster plans' : 'current rosters'}; after includes the trade’s drops and pickups. Both traded rosters change together; other teams retain their current rosters. Byes, availability, scoring variation, locked lineups and actual scores are included. Missing weeks use independent per-game estimates. K/D/ST streaming is hypothetical. ${qualificationError ? `Playoff odds unavailable: ${qualificationError}` : `Qualification uses ${league.playoffRules?.seeding ?? 'assumed points-for'} seeding. ${championshipError ? `Championship odds unavailable: ${championshipError}` : `${playoffs.teams}-team ${playoffs.reseed ? 'reseeded' : 'fixed'} bracket with ${playoffs.rounds ? 'imported round weeks' : `${playoffs.roundWeeks}-week rounds`}.`}`} Odds are model estimates.`,
    };
  };
}

export function forecastTradeSeasonOdds(input: TradeSeasonOddsInput) {
  return createTradeSeasonForecaster(input)(input);
}
export type TradeSeasonOdds = ReturnType<typeof forecastTradeSeasonOdds>;
