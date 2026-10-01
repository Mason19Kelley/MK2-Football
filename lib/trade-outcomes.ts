import { League, fantasyFinalWeek } from './types';
import { TradeEvaluation, TradeHorizon, horizonWeeks } from './weekly-trades';

export type TradeObjective = 'points' | 'wins' | 'title';
export type PlayoffScenario = {
  teams: number;
  startWeek: number;
  roundWeeks: number;
  reseed: boolean;
  rounds?: number[][];
};
export type OutcomeSummary = {
  wins: number;
  losses: number;
  ties: number;
  playoffs?: number;
  title?: number;
  values: number[];
};
const score = (evaluation: TradeEvaluation, week: number, sample: number) =>
  evaluation.scenarioWeeks?.[week]?.[sample] ??
  evaluation.weeks.find((w) => w.week === week)?.total ??
  0;

export function validateOutcomeSchedule(
  league: League,
  horizon: TradeHorizon,
  objective: TradeObjective,
  playoffs?: PlayoffScenario,
) {
  if (objective === 'points') return;
  if (league.playoffRules?.unsupported)
    throw new Error(league.playoffRules.unsupported);
  if (league.playoffRules && league.playoffRules.matchupTie !== 'NONE')
    throw new Error(
      `Unsupported regular-season tie rule: ${league.playoffRules.matchupTie}.`,
    );
  if (horizon === 'ros')
    throw new Error('Win objectives require a weekly period.');
  if (!league.matchups?.length)
    throw new Error(
      'Sync ESPN to import the matchup schedule before ranking wins.',
    );
  if (objective === 'title') {
    validateQualification(league, playoffs);
    const rounds = playoffWeeks(league, playoffs!);
    if (
      !playoffs ||
      playoffs.teams < 2 ||
      playoffs.teams > 16 ||
      rounds.length !== Math.ceil(Math.log2(playoffs.teams)) ||
      rounds.some(
        (w) =>
          !w.length ||
          w.some(
            (n) =>
              !Number.isInteger(n) ||
              n < playoffs.startWeek ||
              n > fantasyFinalWeek(league),
          ),
      ) ||
      new Set(rounds.flat()).size !== rounds.flat().length ||
      rounds.some(
        (w, i) => i > 0 && Math.min(...w) <= Math.max(...rounds[i - 1]),
      )
    )
      throw new Error(
        'Configure a supported playoff bracket with enough remaining weeks.',
      );
    if (
      league.playoffRules &&
      !['HIGHER_SEED', 'HIGHER_PLAYOFF_SEED'].includes(
        league.playoffRules.playoffTie,
      )
    )
      throw new Error(
        `Unsupported playoff tie rule: ${league.playoffRules.playoffTie}.`,
      );
    if (horizon !== 'remaining')
      throw new Error(
        'Championship scenarios require the full remaining season.',
      );
    if (playoffs.startWeek <= league.week) {
      for (const weeks of rounds.filter((w) => Math.min(...w) <= league.week)) {
        const games = league.matchups!.filter(
          (m) => m.playoff && m.weeks.join(',') === weeks.join(','),
        );
        if (
          !games.length ||
          games.some((m) =>
            m.weeks.every((w) => w < league.week)
              ? m.winnerId === undefined
              : !hasHistoricalScores(m, league.week),
          )
        )
          throw new Error(
            'Sync the current playoff bracket and completed playoff results.',
          );
      }
    }
  }
  const end =
    objective === 'title'
      ? playoffs!.startWeek - 1
      : Math.min(
          fantasyFinalWeek(league),
          (league.playoffStartWeek ?? fantasyFinalWeek(league) + 1) - 1,
        );
  const weeks = horizonWeeks(league, horizon).filter((w) => w <= end);
  if (!weeks.length && league.week < (league.playoffStartWeek ?? Infinity))
    throw new Error(
      'No regular-season matchups in this period. Choose a period containing regular-season weeks.',
    );
  const ids = new Set(league.teams.map((t) => t.id));
  const seen = new Set<string>();
  for (const m of league.matchups) {
    if (!m.weeks.some((w) => weeks.includes(w))) continue;
    if (
      !ids.has(m.homeId) ||
      !ids.has(m.awayId) ||
      m.homeId === m.awayId ||
      !m.weeks.length ||
      new Set(m.weeks).size !== m.weeks.length ||
      m.weeks.some((w) => !weeks.includes(w) && w >= league.week) ||
      !hasHistoricalScores(m, league.week)
    )
      throw new Error(
        'This period contains a partial or invalid matchup. Select complete matchup periods; in-progress multi-week matches need historical scores.',
      );
    for (const week of m.weeks)
      for (const id of [m.homeId, m.awayId]) {
        const key = `${id}:${week}`;
        if (seen.has(key))
          throw new Error(
            'The imported schedule contains overlapping matchups.',
          );
        seen.add(key);
      }
  }
  if (weeks.some((w) => league.teams.some((t) => !seen.has(`${t.id}:${w}`))))
    throw new Error(
      'The remaining regular-season schedule is incomplete. Sync ESPN; regular-season byes and doubleheaders need additional rules.',
    );
}

// Use imported seeding, historical results and round schedules when present.
// Older/demo snapshots retain an explicitly described scenario bracket.
export function evaluateLeagueOutcomes(
  league: League,
  evaluations: Map<number, TradeEvaluation>,
  horizon: TradeHorizon,
  objective: TradeObjective,
  playoffs?: PlayoffScenario,
): Map<number, OutcomeSummary> {
  validateOutcomeSchedule(league, horizon, objective, playoffs);
  const samples =
    evaluations.values().next().value?.scenarioTotals?.length ?? 1;
  const result = new Map(
    league.teams.map((t) => [
      t.id,
      {
        wins: 0,
        losses: 0,
        ties: 0,
        playoffs: playoffs ? 0 : undefined,
        title: objective === 'title' ? 0 : undefined,
        values: [] as number[],
      },
    ]),
  );
  const end =
    objective === 'title'
      ? playoffs!.startWeek - 1
      : Math.min(
          fantasyFinalWeek(league),
          (league.playoffStartWeek ?? fantasyFinalWeek(league) + 1) - 1,
        );
  const weeks = horizonWeeks(league, horizon).filter((w) => w <= end);
  const matchups = league.matchups!.filter(
    (m) =>
      m.weeks.some((w) => weeks.includes(w)) &&
      m.weeks.every((w) => w < league.week || weeks.includes(w)),
  );
  for (let sample = 0; sample < samples; sample++) {
    const standings = new Map(
      league.teams.map((t) => [
        t.id,
        {
          wins: t.wins + t.ties * 0.5,
          points: t.pointsFor,
          games: t.wins + t.losses + t.ties,
          against: t.pointsAgainst ?? 0,
          newWins: 0,
        },
      ]),
    );
    const meetings: Meeting[] = league
      .matchups!.filter(
        (m) =>
          !m.playoff &&
          m.weeks.every((w) => w < league.week) &&
          m.weeks.every((w) => w < end + 1),
      )
      .flatMap((m) => {
        if (
          m.winnerId === undefined &&
          (m.homePoints === undefined || m.awayPoints === undefined)
        )
          return [];
        return [
          {
            home: m.homeId,
            away: m.awayId,
            homeWin:
              m.winnerId !== undefined
                ? Number(m.winnerId === m.homeId)
                : m.homePoints === m.awayPoints
                  ? 0.5
                  : Number(m.homePoints! > m.awayPoints!),
          },
        ];
      });
    for (const m of matchups) {
      const home = m.weeks.reduce(
        (sum, w) =>
          sum +
          (w < league.week
            ? m.homeActuals![w]
            : score(evaluations.get(m.homeId)!, w, sample)),
        0,
      );
      const away = m.weeks.reduce(
        (sum, w) =>
          sum +
          (w < league.week
            ? m.awayActuals![w]
            : score(evaluations.get(m.awayId)!, w, sample)),
        0,
      );
      const h = standings.get(m.homeId)!,
        a = standings.get(m.awayId)!;
      const hw = home > away ? 1 : home === away ? 0.5 : 0,
        aw = 1 - hw;
      meetings.push({ home: m.homeId, away: m.awayId, homeWin: hw });
      h.games++;
      a.games++;
      h.against += away;
      a.against += home;
      h.wins += hw;
      h.newWins += hw;
      h.points +=
        home -
        m.weeks
          .filter((w) => w < league.week)
          .reduce((sum, w) => sum + m.homeActuals![w], 0);
      a.wins += aw;
      a.newWins += aw;
      a.points +=
        away -
        m.weeks
          .filter((w) => w < league.week)
          .reduce((sum, w) => sum + m.awayActuals![w], 0);
      result.get(m.homeId)!.losses += Number(home < away) / samples;
      result.get(m.awayId)!.losses += Number(away < home) / samples;
      result.get(m.homeId)!.ties += Number(home === away) / samples;
      result.get(m.awayId)!.ties += Number(home === away) / samples;
    }
    for (const [id, s] of standings) {
      result.get(id)!.wins += s.newWins / samples;
      if (objective === 'wins') result.get(id)!.values.push(s.newWins);
    }
    if (!playoffs) continue;
    const ranked =
      league.week >= playoffs.startWeek
        ? league.teams
            .filter((t) => t.playoffSeed && t.playoffSeed <= playoffs.teams)
            .sort((a, b) => a.playoffSeed! - b.playoffSeed!)
            .map((t) => t.id)
        : seedTeams(league, standings, meetings, sample).slice(
            0,
            playoffs.teams,
          );
    for (const id of ranked) result.get(id)!.playoffs! += 1 / samples;
    if (objective !== 'title') continue;
    const seeds = new Map(ranked.map((id, i) => [id, i + 1]));
    let order = [1, 2];
    const size = 2 ** Math.ceil(Math.log2(playoffs!.teams));
    while (order.length < size) {
      const n = order.length * 2;
      order = order.flatMap((seed) => [seed, n + 1 - seed]);
    }
    let bracket: (number | undefined)[] = order.map((seed) => ranked[seed - 1]);
    let round = 0;
    const rounds = playoffWeeks(league, playoffs!);
    while (bracket.length > 1) {
      const winners: number[] = [];
      const roundWeeks = rounds[round];
      const imported = league.matchups!.filter(
        (m) => m.playoff && m.weeks.join(',') === roundWeeks.join(','),
      );
      if (
        league.week >= playoffs!.startWeek &&
        Math.min(...roundWeeks) <= league.week &&
        imported.length
      ) {
        // ESPN pairings supersede generated pairings after playoffs begin.
        const expectedGames = bracket.filter(
          (id, i) =>
            i % 2 === 0 && id !== undefined && bracket[i + 1] !== undefined,
        ).length;
        const participants = imported.flatMap((m) => [m.homeId, m.awayId]);
        const surviving = new Set(bracket.filter((id) => id !== undefined));
        if (
          imported.length !== expectedGames ||
          new Set(participants).size !== participants.length ||
          participants.some((id) => !surviving.has(id))
        )
          throw new Error(
            'The imported playoff bracket is incomplete or inconsistent with completed results.',
          );
        const paired = new Set(imported.flatMap((m) => [m.homeId, m.awayId]));
        const survivors = bracket.filter(
          (id): id is number => id !== undefined,
        );
        const canonical = imported.every((m) =>
          bracket.some(
            (id, i) =>
              i % 2 === 0 &&
              [id, bracket[i + 1]].includes(m.homeId) &&
              [id, bracket[i + 1]].includes(m.awayId),
          ),
        );
        if (!canonical) {
          // A changed pairing can be continued when its next round is known,
          // or when only the final remains. Larger edited brackets need explicit
          // future branch information rather than an invented bracket order.
          if (
            survivors.length > 4 &&
            Math.min(...(rounds[round + 1] ?? [Infinity])) > league.week
          )
            throw new Error(
              'Edited playoff pairings require the next round’s bracket to forecast championship odds.',
            );
          bracket = [
            ...imported.flatMap((m) => [m.homeId, m.awayId]),
            ...survivors
              .filter((id) => !paired.has(id))
              .flatMap((id) => [id, undefined]),
          ];
        }
      }
      for (let i = 0; i < bracket.length; i += 2) {
        const a = bracket[i],
          b = bracket[i + 1];
        if (a === undefined && b === undefined) continue;
        if (a === undefined || b === undefined) {
          winners.push((a ?? b)!);
          continue;
        }
        let as = 0,
          bs = 0;
        const actualMatch = imported.find(
          (m) =>
            [m.homeId, m.awayId].includes(a) &&
            [m.homeId, m.awayId].includes(b),
        );
        if (
          roundWeeks.every((w) => w < league.week) &&
          actualMatch?.winnerId !== undefined
        ) {
          winners.push(actualMatch.winnerId);
          continue;
        }
        for (const week of roundWeeks) {
          as +=
            week < league.week
              ? actualMatch!.homeId === a
                ? actualMatch!.homeActuals![week]
                : actualMatch!.awayActuals![week]
              : score(evaluations.get(a)!, week, sample);
          bs +=
            week < league.week
              ? actualMatch!.homeId === b
                ? actualMatch!.homeActuals![week]
                : actualMatch!.awayActuals![week]
              : score(evaluations.get(b)!, week, sample);
        }
        winners.push(
          as > bs ? a : as < bs ? b : seeds.get(a)! < seeds.get(b)! ? a : b,
        );
      }
      if (playoffs!.reseed && winners.length > 1) {
        winners.sort((a, b) => seeds.get(a)! - seeds.get(b)!);
        bracket = [];
        while (winners.length) {
          bracket.push(winners.shift()!);
          if (winners.length) bracket.push(winners.pop()!);
        }
      } else bracket = winners;
      round++;
    }
    const champion = bracket[0]!;
    result.get(champion)!.title! += 1 / samples;
    for (const [id, summary] of result)
      summary.values.push(Number(id === champion));
  }
  return result;
}

type Matchup = NonNullable<League['matchups']>[number];
type Meeting = { home: number; away: number; homeWin: number };
type Standing = {
  wins: number;
  games: number;
  points: number;
  against: number;
  newWins: number;
};
function hasHistoricalScores(m: Matchup, week: number) {
  return m.weeks
    .filter((w) => w < week)
    .every(
      (w) =>
        Number.isFinite(m.homeActuals?.[w]) &&
        Number.isFinite(m.awayActuals?.[w]),
    );
}
export function playoffWeeks(league: League, playoffs: PlayoffScenario) {
  return (
    playoffs.rounds ??
    (playoffs.teams === league.playoffTeamCount &&
    playoffs.startWeek === league.playoffStartWeek &&
    playoffs.roundWeeks === (league.playoffRoundWeeks ?? 1)
      ? league.playoffRounds
      : undefined) ??
    Array.from({ length: Math.ceil(Math.log2(playoffs.teams)) }, (_, round) =>
      Array.from(
        { length: playoffs.roundWeeks },
        (_, offset) =>
          playoffs.startWeek + round * playoffs.roundWeeks + offset,
      ),
    )
  );
}
export function validateQualification(
  league: League,
  playoffs?: PlayoffScenario,
) {
  if (!Number.isInteger(playoffs?.startWeek) || playoffs!.startWeek < 1)
    throw new Error('Playoff start week is missing or invalid.');
  if (
    !playoffs ||
    !Number.isInteger(playoffs.teams) ||
    playoffs.teams < 1 ||
    playoffs.teams > league.teams.length
  )
    throw new Error('Playoff team count is missing or invalid.');
  if (league.playoffRules?.unsupported)
    throw new Error(league.playoffRules.unsupported);
  if (
    league.playoffRules &&
    !['TOTAL_POINTS_SCORED', 'H2H_RECORD', 'INTRA_DIVISION_RECORD'].includes(
      league.playoffRules.seeding,
    )
  )
    throw new Error(
      `Unsupported playoff seeding rule: ${league.playoffRules.seeding}.`,
    );
  if (league.playoffRules && league.playoffRules.matchupTie !== 'NONE')
    throw new Error(
      `Unsupported regular-season tie rule: ${league.playoffRules.matchupTie}.`,
    );
  if (
    league.playoffRules?.divisionWinners &&
    league.teams.some((t) => t.divisionId === undefined)
  )
    throw new Error('Division membership is incomplete.');
  if (league.week >= playoffs.startWeek) {
    const seeds = league.teams
      .filter((t) => t.playoffSeed && t.playoffSeed <= playoffs.teams)
      .map((t) => t.playoffSeed);
    if (seeds.length !== playoffs.teams || new Set(seeds).size !== seeds.length)
      throw new Error('Sync the qualified teams and playoff seeds.');
  } else if (league.playoffRules) {
    const past =
      league.matchups?.filter(
        (m) => !m.playoff && m.weeks.every((w) => w < league.week),
      ) ?? [];
    for (const team of league.teams) {
      const played = past.filter(
        (m) => m.homeId === team.id || m.awayId === team.id,
      );
      if (
        played.length !== team.wins + team.losses + team.ties ||
        played.some(
          (m) =>
            m.winnerId === undefined &&
            (m.homePoints === undefined || m.awayPoints === undefined),
        )
      )
        throw new Error(
          'Historical matchup results are incomplete for seeding tiebreakers.',
        );
      if (team.pointsAgainst === undefined && played.length)
        throw new Error(
          'Historical points against are missing for seeding tiebreakers.',
        );
    }
  }
}

// Seed one team at a time and restart the tied-group comparison after each
// selection, including the balanced head-to-head schedule requirement.
function seedTeams(
  league: League,
  standings: Map<number, Standing>,
  meetings: Meeting[],
  sample: number,
) {
  const divisions = new Map(league.teams.map((t) => [t.id, t.divisionId]));
  const pct = (wins: number, games: number) => (games ? wins / games : 0);
  const record = (id: number, opponents: Set<number>) => {
    const matches = meetings.filter(
      (m) =>
        (m.home === id && opponents.has(m.away)) ||
        (m.away === id && opponents.has(m.home)),
    );
    return pct(
      matches.reduce(
        (sum, m) => sum + (m.home === id ? m.homeWin : 1 - m.homeWin),
        0,
      ),
      matches.length,
    );
  };
  const coin = (id: number) => {
    let h = (league.season + sample) | 0;
    for (const c of `${id}:${sample}:seed`)
      h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    return h >>> 0;
  };
  const order = (ids: number[]) => {
    const ranked: number[] = [];
    let remaining = [...ids];
    while (remaining.length) {
      const best = Math.max(
        ...remaining.map((id) =>
          pct(standings.get(id)!.wins, standings.get(id)!.games),
        ),
      );
      let tied = remaining.filter(
        (id) => pct(standings.get(id)!.wins, standings.get(id)!.games) === best,
      );
      const group = new Set(tied);
      const pairs = tied.flatMap((a, i) =>
        tied
          .slice(i + 1)
          .map(
            (b) =>
              meetings.filter(
                (m) =>
                  (m.home === a && m.away === b) ||
                  (m.home === b && m.away === a),
              ).length,
          ),
      );
      const balanced =
        pairs.length > 0 && pairs[0] > 0 && pairs.every((n) => n === pairs[0]);
      const metrics: Record<string, (id: number) => number> = {
        h2h: (id) => (balanced ? record(id, group) : 0),
        points: (id) => standings.get(id)!.points,
        division: (id) =>
          divisions.get(id) === undefined
            ? 0
            : record(
                id,
                new Set(
                  league.teams
                    .filter((t) => t.divisionId === divisions.get(id))
                    .map((t) => t.id),
                ),
              ),
        against: (id) => standings.get(id)!.against,
        coin,
      };
      const rule = league.playoffRules?.seeding ?? 'TOTAL_POINTS_SCORED';
      const keys =
        rule === 'H2H_RECORD'
          ? ['h2h', 'points', 'division', 'against', 'coin']
          : rule === 'INTRA_DIVISION_RECORD'
            ? ['division', 'h2h', 'points', 'against', 'coin']
            : ['points', 'h2h', 'division', 'against', 'coin'];
      for (const key of keys) {
        const max = Math.max(...tied.map(metrics[key]));
        tied = tied.filter((id) => metrics[key](id) === max);
        if (tied.length === 1) break;
      }
      ranked.push(tied[0]);
      remaining = remaining.filter((id) => id !== tied[0]);
    }
    return ranked;
  };
  const all = league.teams.map((t) => t.id);
  if (!league.playoffRules?.divisionWinners) return order(all);
  const winners = [...new Set(divisions.values())].map(
    (d) => order(all.filter((id) => divisions.get(id) === d))[0],
  );
  return [
    ...order(winners),
    ...order(all.filter((id) => !winners.includes(id))),
  ];
}
