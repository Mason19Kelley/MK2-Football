import { League } from './types';
import { evaluateRoster } from './weekly-trades';
import {
  defaultScenarioSettings,
  evaluateForecastRoster,
} from './trade-evaluation';
import {
  evaluateLeagueOutcomes,
  PlayoffScenario,
  validateOutcomeSchedule,
  validateQualification,
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
    reseed: league.playoffRules?.reseed ?? false,
    rounds: league.playoffRounds,
  } as PlayoffScenario;
  // Records can still be forecast when the imported playoff format is unsupported.
  validateOutcomeSchedule(league, 'remaining', 'wins');
  let qualificationError = '';
  try {
    validateQualification(league, bracket);
  } catch (error) {
    qualificationError =
      error instanceof Error
        ? error.message
        : 'Unsupported qualification rules.';
  }
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
  const projectedLineups = new Map(
    league.teams.map((team) => [
      team.id,
      evaluateRoster(league, team.players, 'remaining', undefined, undefined, {
        streaming: false,
      }),
    ]),
  );
  let outcomes;
  try {
    outcomes = evaluateLeagueOutcomes(
      league,
      evaluations,
      'remaining',
      bracketError ? 'wins' : 'title',
      qualificationError ? undefined : bracket,
    );
  } catch (error) {
    bracketError =
      error instanceof Error ? error.message : 'Unsupported playoff bracket.';
    outcomes = evaluateLeagueOutcomes(
      league,
      evaluations,
      'remaining',
      'wins',
      qualificationError ? undefined : bracket,
    );
  }
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
      .filter(
        (m) =>
          m.weeks.some((w) => w >= league.week) &&
          m.weeks.every((w) => w < league.playoffStartWeek!),
      )
      .map((m) => {
        const home = evaluations.get(m.homeId)!;
        const away = evaluations.get(m.awayId)!;
        const scores = (
          evaluation: typeof home,
          actuals: Record<number, number> | undefined,
        ) =>
          Array.from({ length: scenarios.samples }, (_, i) =>
            m.weeks.reduce(
              (sum, week) =>
                sum +
                (week < league.week
                  ? actuals![week]
                  : evaluation.scenarioWeeks![week][i]),
              0,
            ),
          );
        const homeScores = scores(home, m.homeActuals);
        const awayScores = scores(away, m.awayActuals);
        const chance = (compare: (a: number, b: number) => boolean) =>
          homeScores.filter((score, i) => compare(score, awayScores[i]))
            .length / scenarios.samples;
        const weeks = [...home.weeks, ...away.weeks].filter((w) =>
          m.weeks.includes(w.week),
        );
        return {
          ...m,
          homePoints:
            m.weeks
              .filter((w) => w < league.week)
              .reduce((sum, w) => sum + m.homeActuals![w], 0) +
            projectedLineups
              .get(m.homeId)!
              .weeks.filter((w) => m.weeks.includes(w.week))
              .reduce((sum, w) => sum + w.total, 0),
          awayPoints:
            m.weeks
              .filter((w) => w < league.week)
              .reduce((sum, w) => sum + m.awayActuals![w], 0) +
            projectedLineups
              .get(m.awayId)!
              .weeks.filter((w) => m.weeks.includes(w.week))
              .reduce((sum, w) => sum + w.total, 0),
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
      'Weekly lineups optimized from current rosters; byes, availability and scoring variance included. Defaults: 95% weekly availability, 35% scoring variation, 10% season-long role variation, and 20% same-NFL-team scoring correlation; player overrides take precedence. K/D/ST streaming assumes the best projected available free agent can be picked up each week; shared waiver candidates are hypothetical alternatives for each team, not guaranteed acquisitions. No other future pickups or trades.',
      qualificationError
        ? `Playoff odds unavailable: ${qualificationError}`
        : bracketError
          ? `Championship odds unavailable: ${bracketError}. Qualification odds use the imported seeding rules.`
          : `${count}-team bracket${league.playoffTeamCount === undefined ? ' (assumed)' : ''}; ${league.playoffRounds ? 'imported round weeks' : `${roundWeeks}-week rounds`}; ${league.playoffRules ? `imported ${league.playoffRules.seeding} seeding and ${league.playoffRules.playoffTie} playoff ties` : 'assumed points-for seeding and higher-seed playoff ties'}. ${league.playoffRules?.divisionWinners ? 'Division winners receive the top seeds.' : ''}`,
      estimated
        ? 'Some missing weekly forecasts use independent per-game estimates.'
        : '',
      missing ? 'Missing player forecasts reduce projected scores.' : '',
      'Odds are model estimates. Current-week locked starters retain actual points; only remaining game production is simulated, with live-game estimates scaled by the remaining NFL clock.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
