import { League, Player, Position, positions } from './types';
import {
  roleMultiplier,
  ScenarioSettings,
  scoreDraw,
  scoreNoise,
  scoreStdDev,
  validateScenarios,
} from './trade-evaluation';

// One starter as ESPN recorded them for a completed week: the projection
// available before kickoff and the points actually scored.
export type BacktestStarter = Pick<Player, 'id' | 'position' | 'nflTeam'> & {
  projection: number;
  actual: number;
};
export type BacktestTeamWeek = {
  week: number;
  teamId: number;
  starters: BacktestStarter[];
  // Bench players with a projection; they calibrate positions, not team totals.
  bench?: BacktestStarter[];
};
export type BacktestData = {
  teamWeeks: BacktestTeamWeek[];
  matchups?: League['matchups'];
};
type Interval = [number, number];
type Calibration = {
  count: number;
  // (actual − simulated mean) / simulated SD; a calibrated model has mean 0, SD 1.
  zMean: number;
  zSd: number;
  // Share of actual scores inside the central 80% and 50% simulated intervals.
  coverage80: number;
  coverage50: number;
  // Where the misses fall: below the 10th or above the 90th percentile.
  below10: number;
  above90: number;
  // Share of weeks at zero points or less, actual vs simulated.
  zeroActual: number;
  zeroSimulated: number;
  bias: number;
  rmse: number;
  modelSd: number;
  // 95% bootstrap intervals: how far each measure could move on chance alone.
  intervals: { zSd: Interval; coverage80: Interval; coverage50: Interval };
};
// One scored observation, kept so two reports can be compared pairwise.
export type ScoredObservation = {
  z: number | null;
  inside80: number;
  inside50: number;
  below10: number;
  above90: number;
  zeroActual: number;
  zeroSimulated: number;
  error: number;
  variance: number;
};
export type PositionCalibration = {
  all: Calibration;
  starters: Calibration;
  bench: Calibration;
};
export type BacktestReport = {
  settings: ScenarioSettings;
  weeks: number[];
  teams: Calibration;
  players: Partial<Record<Position, PositionCalibration>>;
  matchups: {
    count: number;
    // Brier score of the home-win probability; always guessing 50% scores 0.25.
    brier: number;
    brierInterval: Interval;
    baselineBrier: number;
    skill: number;
    logLoss: number;
  };
  // Player-weeks outside the simulated 10th–90th percentiles, pooled over
  // positions. `error` is the distance of both tail rates from 10%; the gate
  // uses it because team totals average out shape errors. Pooling keeps it
  // sensitive with few weeks; the position table shows where misses fall.
  playerTails: {
    count: number;
    below10: number;
    above90: number;
    error: number;
  };
  observations: {
    teams: ScoredObservation[];
    matchups: number[];
    players: ScoredObservation[];
  };
};

// Mirrors evaluateForecastRoster after lineup selection: a role draw, then
// weekly scoring in the chosen shape with shared NFL-team noise. Availability is not
// drawn: in the app an unavailable starter is replaced before kickoff, and
// real lineups were set knowing who was active, so zeroing starters here
// would bias every team low by the full availability rate.
export function simulateStarter(
  p: BacktestStarter,
  week: number,
  settings: ScenarioSettings,
) {
  const scores = new Float64Array(settings.samples);
  for (let sample = 0; sample < settings.samples; sample++) {
    const mean = p.projection * roleMultiplier(settings, p, sample);
    scores[sample] = scoreDraw(
      settings.scoreShape,
      p.position,
      mean,
      scoreStdDev(p.position, mean, settings.scoreCv),
      scoreNoise(settings, p, week, sample),
    );
  }
  return scores;
}

function quantileSorted(sorted: Float64Array, fraction: number) {
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
type Observation = { actual: number; samples: Float64Array };
function scoreObservation({ actual, samples }: Observation): ScoredObservation {
  const mean = samples.reduce((s, n) => s + n, 0) / samples.length;
  const variance =
    samples.reduce((s, n) => s + (n - mean) ** 2, 0) / samples.length;
  const sorted = Float64Array.from(samples).sort();
  const inside = (low: number, high: number) =>
    Number(
      actual >= quantileSorted(sorted, low) &&
        actual <= quantileSorted(sorted, high),
    );
  return {
    // A zero-spread forecast has no z-score; it still counts toward coverage.
    z: variance > 0 ? (actual - mean) / Math.sqrt(variance) : null,
    inside80: inside(0.1, 0.9),
    inside50: inside(0.25, 0.75),
    below10: Number(actual < quantileSorted(sorted, 0.1)),
    above90: Number(actual > quantileSorted(sorted, 0.9)),
    zeroActual: Number(actual <= 0),
    zeroSimulated: samples.filter((n) => n <= 0).length / samples.length,
    error: actual - mean,
    variance,
  };
}
function summarize(
  rows: ScoredObservation[],
  indices: ArrayLike<number> = rows.map((_, i) => i),
) {
  const count = indices.length;
  let zSum = 0,
    zSquares = 0,
    scored = 0,
    inside80 = 0,
    inside50 = 0,
    below10 = 0,
    above90 = 0,
    zeroActual = 0,
    zeroSimulated = 0,
    bias = 0,
    errorSquares = 0,
    variance = 0;
  for (let i = 0; i < count; i++) {
    const row = rows[indices[i]];
    if (row.z !== null) {
      zSum += row.z;
      zSquares += row.z ** 2;
      scored++;
    }
    inside80 += row.inside80;
    inside50 += row.inside50;
    below10 += row.below10;
    above90 += row.above90;
    zeroActual += row.zeroActual;
    zeroSimulated += row.zeroSimulated;
    bias += row.error;
    errorSquares += row.error ** 2;
    variance += row.variance;
  }
  const zMean = scored ? zSum / scored : 0;
  return {
    count,
    zMean,
    zSd: scored ? Math.sqrt(Math.max(0, zSquares / scored - zMean ** 2)) : 0,
    coverage80: count ? inside80 / count : 0,
    coverage50: count ? inside50 / count : 0,
    below10: count ? below10 / count : 0,
    above90: count ? above90 / count : 0,
    zeroActual: count ? zeroActual / count : 0,
    zeroSimulated: count ? zeroSimulated / count : 0,
    bias: count ? bias / count : 0,
    rmse: count ? Math.sqrt(errorSquares / count) : 0,
    modelSd: count ? Math.sqrt(variance / count) : 0,
  };
}
function playerTails(
  rows: ScoredObservation[],
  indices: ArrayLike<number> = rows.map((_, i) => i),
) {
  let below10 = 0,
    above90 = 0;
  for (let i = 0; i < indices.length; i++) {
    below10 += rows[indices[i]].below10;
    above90 += rows[indices[i]].above90;
  }
  const count = indices.length;
  const low = count ? below10 / count : 0,
    high = count ? above90 / count : 0;
  return {
    count,
    below10: low,
    above90: high,
    error: count ? Math.abs(low - 0.1) + Math.abs(high - 0.1) : 0,
  };
}
const mean = (values: number[], indices: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < indices.length; i++) sum += values[indices[i]];
  return indices.length ? sum / indices.length : 0;
};

// Seeded resampling keeps intervals and verdicts identical between runs.
const resamples = 1000;
function* bootstrap(...sizes: number[]) {
  let state = 0x9e3779b9;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let r = 0; r < resamples; r++)
    yield sizes.map((size) =>
      Uint32Array.from({ length: size }, () => Math.floor(random() * size)),
    );
}
function interval(values: number[]): Interval {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return [at(0.025), at(0.975)];
}
function calibrate(rows: ScoredObservation[]): Calibration {
  const draws = {
    zSd: [] as number[],
    coverage80: [] as number[],
    coverage50: [] as number[],
  };
  if (rows.length)
    for (const [indices] of bootstrap(rows.length)) {
      const s = summarize(rows, indices);
      draws.zSd.push(s.zSd);
      draws.coverage80.push(s.coverage80);
      draws.coverage50.push(s.coverage50);
    }
  return {
    ...summarize(rows),
    intervals: {
      zSd: interval(draws.zSd),
      coverage80: interval(draws.coverage80),
      coverage50: interval(draws.coverage50),
    },
  };
}

// Compares every completed team-week with its simulated distribution, and
// every fully observed matchup with its simulated win probability.
export function runBacktest(
  data: BacktestData,
  settings: ScenarioSettings,
): BacktestReport {
  validateScenarios(settings);
  const teamSamples = new Map<string, Observation>();
  const playerRows = new Map<
    Position,
    { starters: ScoredObservation[]; bench: ScoredObservation[] }
  >();
  const addPlayer = (
    p: BacktestStarter,
    samples: Float64Array,
    bench: boolean,
  ) => {
    // Unprojected players (byes, inactive) say nothing about scoring spread.
    if (p.projection <= 0) return;
    let entry = playerRows.get(p.position);
    if (!entry)
      playerRows.set(p.position, (entry = { starters: [], bench: [] }));
    entry[bench ? 'bench' : 'starters'].push(
      scoreObservation({ actual: p.actual, samples }),
    );
  };
  for (const { week, teamId, starters, bench = [] } of data.teamWeeks) {
    const total: Observation = {
      actual: 0,
      samples: new Float64Array(settings.samples),
    };
    for (const starter of starters) {
      const samples = simulateStarter(starter, week, settings);
      for (let i = 0; i < samples.length; i++) total.samples[i] += samples[i];
      total.actual += starter.actual;
      addPlayer(starter, samples, false);
    }
    for (const p of bench)
      addPlayer(p, simulateStarter(p, week, settings), true);
    teamSamples.set(`${teamId}:${week}`, total);
  }
  const matchupErrors: number[] = [];
  let logLoss = 0;
  for (const m of data.matchups ?? []) {
    if (!m.weeks.length) continue;
    const sides = [m.homeId, m.awayId].map((id) =>
      m.weeks.map((w) => teamSamples.get(`${id}:${w}`)),
    );
    if (sides.some((weeks) => weeks.some((w) => !w))) continue;
    const [home, away] = sides.map((weeks) => {
      const samples = new Float64Array(settings.samples);
      let actual = 0;
      for (const w of weeks) {
        actual += w!.actual;
        for (let i = 0; i < samples.length; i++) samples[i] += w!.samples[i];
      }
      return { actual, samples };
    });
    let wins = 0;
    for (let i = 0; i < settings.samples; i++)
      wins +=
        home.samples[i] > away.samples[i]
          ? 1
          : home.samples[i] === away.samples[i]
            ? 0.5
            : 0;
    const probability = wins / settings.samples;
    const outcome =
      home.actual > away.actual ? 1 : home.actual === away.actual ? 0.5 : 0;
    matchupErrors.push((probability - outcome) ** 2);
    // Clamp so one confident miss in a finite sample stays finite.
    const clamped = Math.min(
      1 - 0.5 / settings.samples,
      Math.max(0.5 / settings.samples, probability),
    );
    logLoss -=
      outcome * Math.log(clamped) + (1 - outcome) * Math.log(1 - clamped);
  }
  const baselineBrier = 0.25;
  const matchupCount = matchupErrors.length;
  const all = (n: number) => Array.from({ length: n }, (_, i) => i);
  const meanBrier = mean(matchupErrors, all(matchupCount));
  const teamRows = [...teamSamples.values()].map(scoreObservation);
  const players = [...playerRows.values()].flatMap(({ starters, bench }) => [
    ...starters,
    ...bench,
  ]);
  const brierDraws: number[] = [];
  if (matchupCount)
    for (const [indices] of bootstrap(matchupCount))
      brierDraws.push(mean(matchupErrors, indices));
  return {
    settings,
    weeks: [...new Set(data.teamWeeks.map((t) => t.week))].sort(
      (a, b) => a - b,
    ),
    teams: calibrate(teamRows),
    players: Object.fromEntries(
      positions
        .filter((p) => playerRows.has(p))
        .map((p) => {
          const { starters, bench } = playerRows.get(p)!;
          return [
            p,
            {
              all: calibrate([...starters, ...bench]),
              starters: calibrate(starters),
              bench: calibrate(bench),
            },
          ];
        }),
    ),
    matchups: {
      count: matchupCount,
      brier: meanBrier,
      brierInterval: interval(brierDraws),
      baselineBrier,
      skill: matchupCount ? 1 - meanBrier / baselineBrier : 0,
      logLoss: matchupCount ? logLoss / matchupCount : 0,
    },
    playerTails: playerTails(players),
    observations: {
      teams: teamRows,
      matchups: matchupErrors,
      players,
    },
  };
}

export type BacktestMeasure = 'zSd' | 'coverage80' | 'brier' | 'playerTails';
export type BacktestComparison = {
  verdict: 'better' | 'worse' | 'within-noise';
  // Candidate minus baseline distance from target; negative is better.
  measures: Record<
    BacktestMeasure,
    { difference: number; interval: Interval } | undefined
  >;
};
// Paired bootstrap over the same team-weeks, matchups and player-weeks. Team
// spread, team 80% coverage, matchup Brier and player tail error are each
// compared as distance from target. A change is better
// only if some gate measure improves beyond chance and none gets worse
// beyond chance; anything else is within noise.
export function compareBacktests(
  baseline: BacktestReport,
  candidate: BacktestReport,
): BacktestComparison {
  const base = baseline.observations,
    next = candidate.observations;
  if (
    base.teams.length !== next.teams.length ||
    base.matchups.length !== next.matchups.length ||
    base.players.length !== next.players.length
  )
    throw new Error('Backtests must cover the same weeks to be compared.');
  const distances = (
    teams: ScoredObservation[],
    matchups: number[],
    teamIndices: ArrayLike<number>,
    matchupIndices: ArrayLike<number>,
    players: ScoredObservation[],
    playerIndices: ArrayLike<number>,
  ) => {
    const s = summarize(teams, teamIndices);
    return {
      zSd: Math.abs(s.zSd - 1),
      coverage80: Math.abs(s.coverage80 - 0.8),
      brier: mean(matchups, matchupIndices),
      playerTails: playerTails(players, playerIndices).error,
    };
  };
  const all = (n: number) => Array.from({ length: n }, (_, i) => i);
  const names = (
    ['zSd', 'coverage80', 'brier', 'playerTails'] as BacktestMeasure[]
  ).filter(
    (n) =>
      (n !== 'brier' || base.matchups.length) &&
      (n !== 'playerTails' || base.players.length),
  );
  const point = (indices: ArrayLike<number>[]) => {
    const [t, m, p] = indices;
    const a = distances(base.teams, base.matchups, t, m, base.players, p);
    const b = distances(next.teams, next.matchups, t, m, next.players, p);
    return Object.fromEntries(names.map((n) => [n, b[n] - a[n]]));
  };
  const observed = point([
    all(base.teams.length),
    all(base.matchups.length),
    all(base.players.length),
  ]);
  const draws = Object.fromEntries(names.map((n) => [n, [] as number[]]));
  if (base.teams.length)
    for (const indices of bootstrap(
      base.teams.length,
      base.matchups.length,
      base.players.length,
    )) {
      const d = point(indices);
      for (const n of names) draws[n].push(d[n]);
    }
  const measures = Object.fromEntries(
    names.map((n) => [
      n,
      { difference: observed[n], interval: interval(draws[n]) },
    ]),
  ) as BacktestComparison['measures'];
  const results = names.map((n) => measures[n]!.interval);
  return {
    verdict: results.some(([low]) => low > 0)
      ? 'worse'
      : results.some(([, high]) => high < 0)
        ? 'better'
        : 'within-noise',
    measures,
  };
}

// Weeks with a decided matchup, or before the current scoring period. A tied
// final week is only included once ESPN moves to the next period.
export function completedWeeks(league: Pick<League, 'week' | 'matchups'>) {
  const decided = (league.matchups ?? [])
    .filter((m) => m.winnerId !== undefined)
    .flatMap((m) => m.weeks);
  const last = Math.max(league.week - 1, ...decided, 0);
  return Array.from({ length: last }, (_, i) => i + 1);
}
