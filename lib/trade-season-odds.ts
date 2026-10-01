import { League } from './types';
import { TradePlan } from './trade-plans';
import {
  defaultScenarioSettings,
  evaluateForecastRoster,
  ScenarioSettings,
} from './trade-evaluation';
import {
  evaluateLeagueOutcomes,
  PlayoffScenario,
  validateOutcomeSchedule,
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
export function forecastTradeSeasonOdds(input: TradeSeasonOddsInput) {
  const { league, myTeamId, partnerId, plan, baseline, streaming } = input;
  const playoffs = input.playoffs ?? {
    teams: (league.playoffTeamCount ??
      (league.teams.length >= 10 ? 6 : 4)) as PlayoffScenario['teams'],
    startWeek: league.playoffStartWeek!,
    roundWeeks: league.playoffRoundWeeks ?? 1,
    reseed: false,
  };
  validateOutcomeSchedule(league, 'remaining', 'title', playoffs);
  const scenarios = input.scenarios ?? {
    ...defaultScenarioSettings,
    samples: 512,
    seed: league.season,
  };
  const evaluate = (roster: League['teams'][number]['players']) =>
    evaluateForecastRoster(league, roster, 'remaining', {
      scenarios,
      streaming,
    });
  const before = new Map(
    league.teams.map((team) => [team.id, evaluate(team.players)]),
  );
  if (baseline) {
    before.set(myTeamId, evaluate(baseline.mine.roster));
    before.set(partnerId, evaluate(baseline.partner.roster));
  }
  const after = new Map(before);
  after.set(myTeamId, evaluate(plan.mine.roster));
  after.set(partnerId, evaluate(plan.partner.roster));
  for (const evaluation of [...before.values(), ...after.values()])
    if (!evaluation.complete || evaluation.missing > 0)
      throw new Error(
        'Complete weekly lineup forecasts for every team are needed to estimate season odds.',
      );
  const outcomes = (evaluations: typeof before) =>
    evaluateLeagueOutcomes(league, evaluations, 'remaining', 'title', playoffs);
  const beforeOutcomes = outcomes(before);
  const afterOutcomes = outcomes(after);
  return {
    teams: [myTeamId, partnerId].map((id) => ({
      id,
      before: beforeOutcomes.get(id)!,
      after: afterOutcomes.get(id)!,
    })),
    description: `${scenarios.samples} full-season simulations with the same random draws before and after. ${playoffs.teams}-team bracket, ${playoffs.roundWeeks}-week rounds; ${playoffs.reseed ? 'reseeded' : 'fixed'} bracket. Before uses ${baseline ? 'the selected no-trade roster plans' : 'current rosters'}; after includes the trade’s drops and pickups. Weekly lineups include byes, availability, scoring variation and K/D/ST streaming. Other teams retain current rosters. Missing weekly forecasts may be estimated from ROS totals. Odds are model estimates; league divisions and tiebreakers may differ.`,
  };
}
export type TradeSeasonOdds = ReturnType<typeof forecastTradeSeasonOdds>;
