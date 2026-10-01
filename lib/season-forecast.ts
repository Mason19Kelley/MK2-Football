import { League } from './types';
import {
  defaultScenarioSettings,
  evaluateForecastRoster,
} from './trade-evaluation';
import {
  evaluateLeagueOutcomes,
  PlayoffScenario,
  validateOutcomeSchedule,
} from './trade-outcomes';

export type SeasonForecast = {
  teams: {
    id: number;
    wins: number;
    losses: number;
    ties: number;
    playoffs?: number;
    championship?: number;
  }[];
  matchups: {
    id: number;
    weeks: number[];
    homeId: number;
    awayId: number;
    homePoints: number;
    awayPoints: number;
    homeWinChance: number;
    awayWinChance: number;
    tieChance: number;
    estimated: boolean;
    missing: boolean;
  }[];
  samples: number;
  description: string;
};

export function forecastSeason(league: League): SeasonForecast {
  if (!league.playoffStartWeek)
    throw new Error(
      'Sync ESPN to load the regular-season end date and matchup schedule.',
    );
  const count = league.playoffTeamCount ?? (league.teams.length >= 10 ? 6 : 4);
  const roundWeeks = league.playoffRoundWeeks ?? 1;
  const bracket = {
    teams: count,
    startWeek: league.playoffStartWeek,
    roundWeeks,
    reseed: false,
  } as PlayoffScenario;
  // Records can still be forecast when the imported playoff format is unsupported.
  validateOutcomeSchedule(league, 'remaining', 'wins');
  let bracketError = '';
  try {
    validateOutcomeSchedule(league, 'remaining', 'title', bracket);
  } catch (error) {
    bracketError =
      error instanceof Error ? error.message : 'Unsupported playoff format.';
  }
  const scenarios = {
    ...defaultScenarioSettings,
    samples: 512,
    seed: league.season,
  };
  const evaluations = new Map(
    league.teams.map((team) => [
      team.id,
      evaluateForecastRoster(league, team.players, 'remaining', { scenarios }),
    ]),
  );
  const outcomes = evaluateLeagueOutcomes(
    league,
    evaluations,
    'remaining',
    bracketError ? 'wins' : 'title',
    bracket,
  );
  const estimated = [...evaluations.values()].some((e) =>
    e.weeks.some((w) => w.estimated > 0),
  );
  const missing = [...evaluations.values()].some((e) =>
    e.weeks.some((w) => w.missing > 0),
  );
  return {
    teams: league.teams.map((team) => {
      const outcome = outcomes.get(team.id)!;
      return {
        id: team.id,
        wins: team.wins + outcome.wins - outcome.ties * 0.5,
        losses: team.losses + outcome.losses,
        ties: team.ties + outcome.ties,
        playoffs: outcome.playoffs,
        championship: outcome.title,
      };
    }),
    matchups: (league.matchups ?? [])
      .filter((m) =>
        m.weeks.every((w) => w >= league.week && w < league.playoffStartWeek!),
      )
      .map((m) => {
        const home = evaluations.get(m.homeId)!;
        const away = evaluations.get(m.awayId)!;
        const scores = (evaluation: typeof home) =>
          Array.from({ length: scenarios.samples }, (_, i) =>
            m.weeks.reduce(
              (sum, week) => sum + evaluation.scenarioWeeks![week][i],
              0,
            ),
          );
        const homeScores = scores(home);
        const awayScores = scores(away);
        const chance = (compare: (a: number, b: number) => boolean) =>
          homeScores.filter((score, i) => compare(score, awayScores[i]))
            .length / scenarios.samples;
        const weeks = [...home.weeks, ...away.weeks].filter((w) =>
          m.weeks.includes(w.week),
        );
        return {
          ...m,
          homePoints: homeScores.reduce((a, b) => a + b, 0) / scenarios.samples,
          awayPoints: awayScores.reduce((a, b) => a + b, 0) / scenarios.samples,
          homeWinChance: chance((a, b) => a > b),
          awayWinChance: chance((a, b) => b > a),
          tieChance: chance((a, b) => a === b),
          estimated: weeks.some((w) => w.estimated > 0),
          missing: weeks.some((w) => w.missing > 0),
        };
      }),
    samples: scenarios.samples,
    description: [
      `${scenarios.samples} season simulations · Expected record through Week ${league.playoffStartWeek - 1}.`,
      'Weekly lineups optimized from current rosters; byes, availability and scoring variance included. Defaults: 95% weekly availability, 35% scoring variation, 10% season-long role variation, and 20% same-NFL-team scoring correlation; player overrides take precedence. No future trades or pickups.',
      bracketError
        ? `Playoff odds unavailable: ${bracketError}`
        : `${count}-team bracket${league.playoffTeamCount === undefined ? ' (assumed)' : ''}, ${roundWeeks}-week rounds${league.playoffRoundWeeks === undefined ? ' (assumed)' : ''}; top seeds receive byes when needed. Wins, then points scored, determine seeding; fixed bracket, higher seed wins playoff ties.`,
      estimated ? 'Some weekly forecasts are estimated from ROS totals.' : '',
      missing ? 'Missing player forecasts reduce projected scores.' : '',
      'Odds are model estimates; league-specific divisions and tiebreakers may differ.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
