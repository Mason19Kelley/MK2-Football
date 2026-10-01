import { League, Player, Position, positions } from './types';
import {
  lognormalScore,
  roleMultiplier,
  ScenarioSettings,
  scoreNoise,
  scoreStdDev,
  uniform,
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
};
export type BacktestData = {
  teamWeeks: BacktestTeamWeek[];
  matchups?: League['matchups'];
};
type Calibration = {
  count: number;
  // (actual − simulated mean) / simulated SD; a calibrated model has mean 0, SD 1.
  zMean: number;
  zSd: number;
  // Share of actual scores inside the central 80% and 50% simulated intervals.
  coverage80: number;
  coverage50: number;
  bias: number;
  rmse: number;
  modelSd: number;
};
export type BacktestReport = {
  settings: ScenarioSettings;
  weeks: number[];
  teams: Calibration;
  players: Partial<Record<Position, Calibration>>;
  matchups: {
    count: number;
    // Brier score of the home-win probability; always guessing 50% scores 0.25.
    brier: number;
    baselineBrier: number;
    skill: number;
    logLoss: number;
  };
};

// Mirrors evaluateForecastRoster for a fixed lineup: availability and role
// are drawn per player, then lognormal weekly scoring with shared NFL-team noise.
export function simulateStarter(
  p: BacktestStarter,
  week: number,
  settings: ScenarioSettings,
) {
  const scores = new Float64Array(settings.samples);
  for (let sample = 0; sample < settings.samples; sample++) {
    if (
      uniform(`${settings.seed}:${sample}:${p.id}:${week}:availability`) >=
      settings.availability
    )
      continue;
    const mean = p.projection * roleMultiplier(settings, p, sample);
    scores[sample] = lognormalScore(
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
function calibrate(observations: Observation[]): Calibration {
  const count = observations.length;
  if (!count)
    return {
      count: 0,
      zMean: 0,
      zSd: 0,
      coverage80: 0,
      coverage50: 0,
      bias: 0,
      rmse: 0,
      modelSd: 0,
    };
  let zSum = 0,
    zSquares = 0,
    inside80 = 0,
    inside50 = 0,
    biasSum = 0,
    errorSquares = 0,
    variance = 0,
    scored = 0;
  for (const { actual, samples } of observations) {
    const mean = samples.reduce((s, n) => s + n, 0) / samples.length;
    const sd = Math.sqrt(
      samples.reduce((s, n) => s + (n - mean) ** 2, 0) / samples.length,
    );
    const sorted = Float64Array.from(samples).sort();
    if (
      actual >= quantileSorted(sorted, 0.1) &&
      actual <= quantileSorted(sorted, 0.9)
    )
      inside80++;
    if (
      actual >= quantileSorted(sorted, 0.25) &&
      actual <= quantileSorted(sorted, 0.75)
    )
      inside50++;
    biasSum += actual - mean;
    errorSquares += (actual - mean) ** 2;
    variance += sd ** 2;
    // A zero-spread forecast has no z-score; it still counts toward coverage.
    if (sd > 0) {
      const z = (actual - mean) / sd;
      zSum += z;
      zSquares += z * z;
      scored++;
    }
  }
  const zMean = scored ? zSum / scored : 0;
  return {
    count,
    zMean,
    zSd: scored ? Math.sqrt(Math.max(0, zSquares / scored - zMean ** 2)) : 0,
    coverage80: inside80 / count,
    coverage50: inside50 / count,
    bias: biasSum / count,
    rmse: Math.sqrt(errorSquares / count),
    modelSd: Math.sqrt(variance / count),
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
  const playerObservations = new Map<Position, Observation[]>();
  for (const { week, teamId, starters } of data.teamWeeks) {
    const total: Observation = {
      actual: 0,
      samples: new Float64Array(settings.samples),
    };
    for (const starter of starters) {
      const samples = simulateStarter(starter, week, settings);
      for (let i = 0; i < samples.length; i++) total.samples[i] += samples[i];
      total.actual += starter.actual;
      let list = playerObservations.get(starter.position);
      if (!list) playerObservations.set(starter.position, (list = []));
      list.push({ actual: starter.actual, samples });
    }
    teamSamples.set(`${teamId}:${week}`, total);
  }
  let brier = 0,
    logLoss = 0,
    matchupCount = 0;
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
    brier += (probability - outcome) ** 2;
    // Clamp so one confident miss in a finite sample stays finite.
    const clamped = Math.min(
      1 - 0.5 / settings.samples,
      Math.max(0.5 / settings.samples, probability),
    );
    logLoss -=
      outcome * Math.log(clamped) + (1 - outcome) * Math.log(1 - clamped);
    matchupCount++;
  }
  const baselineBrier = 0.25;
  const meanBrier = matchupCount ? brier / matchupCount : 0;
  return {
    settings,
    weeks: [...new Set(data.teamWeeks.map((t) => t.week))].sort(
      (a, b) => a - b,
    ),
    teams: calibrate([...teamSamples.values()]),
    players: Object.fromEntries(
      positions
        .filter((p) => playerObservations.has(p))
        .map((p) => [p, calibrate(playerObservations.get(p)!)]),
    ),
    matchups: {
      count: matchupCount,
      brier: meanBrier,
      baselineBrier,
      skill: matchupCount ? 1 - meanBrier / baselineBrier : 0,
      logLoss: matchupCount ? logLoss / matchupCount : 0,
    },
  };
}

// A parameter change is accepted only if team z-score spread, 80% coverage
// and matchup Brier score are each no worse, and at least one improves.
export function backtestImproves(
  baseline: BacktestReport,
  candidate: BacktestReport,
) {
  const tolerance = 1e-9;
  const metrics = [
    [Math.abs(baseline.teams.zSd - 1), Math.abs(candidate.teams.zSd - 1)],
    [
      Math.abs(baseline.teams.coverage80 - 0.8),
      Math.abs(candidate.teams.coverage80 - 0.8),
    ],
    ...(baseline.matchups.count && candidate.matchups.count
      ? [[baseline.matchups.brier, candidate.matchups.brier]]
      : []),
  ];
  return (
    metrics.every(([base, next]) => next <= base + tolerance) &&
    metrics.some(([base, next]) => next < base - tolerance)
  );
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
