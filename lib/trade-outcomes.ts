import { League, fantasyFinalWeek } from './types';
import { TradeEvaluation, TradeHorizon, horizonWeeks } from './weekly-trades';

export type TradeObjective = 'points' | 'wins' | 'title';
export type PlayoffScenario = {
  teams: 2 | 4 | 6 | 8;
  startWeek: number;
  roundWeeks: number;
  reseed: boolean;
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
  if (horizon === 'ros')
    throw new Error('Win objectives require a weekly period.');
  if (!league.matchups?.length)
    throw new Error(
      'Sync ESPN to import the matchup schedule before ranking wins.',
    );
  if (objective === 'title') {
    if (
      !playoffs ||
      ![2, 4, 6, 8].includes(playoffs.teams) ||
      playoffs.teams > league.teams.length ||
      !Number.isInteger(playoffs.startWeek) ||
      playoffs.startWeek <= league.week ||
      !Number.isInteger(playoffs.roundWeeks) ||
      playoffs.roundWeeks < 1 ||
      playoffs.startWeek +
        Math.ceil(Math.log2(playoffs.teams)) * playoffs.roundWeeks -
        1 >
        fantasyFinalWeek(league)
    )
      throw new Error(
        'Configure a supported future playoff bracket: 2, 4, 6 or 8 teams, equal round lengths, and enough remaining weeks.',
      );
    if (horizon !== 'remaining')
      throw new Error(
        'Championship scenarios require the full remaining season.',
      );
  }
  const end =
    objective === 'title'
      ? playoffs!.startWeek - 1
      : Math.min(
          fantasyFinalWeek(league),
          (league.playoffStartWeek ?? fantasyFinalWeek(league) + 1) - 1,
        );
  const weeks = horizonWeeks(league, horizon).filter((w) => w <= end);
  if (!weeks.length)
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
      m.weeks.some((w) => !weeks.includes(w))
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

// A declared scenario bracket: wins/ties, then points-for, then team ID for
// standings; higher seed wins playoff score ties. No claims of ESPN rule parity.
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
        playoffs: objective === 'title' ? 0 : undefined,
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
  const matchups = league.matchups!.filter((m) =>
    m.weeks.every((w) => weeks.includes(w)),
  );
  for (let sample = 0; sample < samples; sample++) {
    const standings = new Map(
      league.teams.map((t) => [
        t.id,
        { wins: t.wins + t.ties * 0.5, points: t.pointsFor, newWins: 0 },
      ]),
    );
    for (const m of matchups) {
      const home = m.weeks.reduce(
        (sum, w) => sum + score(evaluations.get(m.homeId)!, w, sample),
        0,
      );
      const away = m.weeks.reduce(
        (sum, w) => sum + score(evaluations.get(m.awayId)!, w, sample),
        0,
      );
      const h = standings.get(m.homeId)!,
        a = standings.get(m.awayId)!;
      const hw = home > away ? 1 : home === away ? 0.5 : 0,
        aw = 1 - hw;
      h.wins += hw;
      h.newWins += hw;
      h.points += home;
      a.wins += aw;
      a.newWins += aw;
      a.points += away;
      result.get(m.homeId)!.losses += Number(home < away) / samples;
      result.get(m.awayId)!.losses += Number(away < home) / samples;
      result.get(m.homeId)!.ties += Number(home === away) / samples;
      result.get(m.awayId)!.ties += Number(home === away) / samples;
    }
    for (const [id, s] of standings) {
      result.get(id)!.wins += s.newWins / samples;
      if (objective === 'wins') result.get(id)!.values.push(s.newWins);
    }
    if (objective !== 'title') continue;
    const ranked = [...standings.keys()]
      .sort(
        (a, b) =>
          standings.get(b)!.wins - standings.get(a)!.wins ||
          standings.get(b)!.points - standings.get(a)!.points ||
          a - b,
      )
      .slice(0, playoffs!.teams);
    for (const id of ranked) result.get(id)!.playoffs! += 1 / samples;
    const seeds = new Map(ranked.map((id, i) => [id, i + 1]));
    let order = [1, 2];
    const size = 2 ** Math.ceil(Math.log2(playoffs!.teams));
    while (order.length < size) {
      const n = order.length * 2;
      order = order.flatMap((seed) => [seed, n + 1 - seed]);
    }
    let bracket: (number | undefined)[] = order.map((seed) => ranked[seed - 1]);
    let round = 0;
    while (bracket.length > 1) {
      const winners: number[] = [];
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
        for (let offset = 0; offset < playoffs!.roundWeeks; offset++) {
          const week =
            playoffs!.startWeek + round * playoffs!.roundWeeks + offset;
          as += score(evaluations.get(a)!, week, sample);
          bs += score(evaluations.get(b)!, week, sample);
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
