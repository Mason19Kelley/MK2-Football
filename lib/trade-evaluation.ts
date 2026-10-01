import { League, Player } from './types';
import {
  evaluateRoster,
  horizonWeeks,
  playerWeek,
  TradeEvaluation,
  TradeHorizon,
} from './weekly-trades';
import { optimalLineup } from './trades';

export type ScenarioSettings = {
  samples: number;
  seed: number;
  availability: number;
  scoreCv: number;
  roleCv: number;
  teamCorrelation: number;
};
export const defaultScenarioSettings: ScenarioSettings = {
  samples: 64,
  seed: 2026,
  availability: 0.95,
  scoreCv: 0.35,
  roleCv: 0.1,
  teamCorrelation: 0.2,
};
export function validateScenarios(s: ScenarioSettings) {
  if (
    !Number.isInteger(s.samples) ||
    s.samples < 8 ||
    s.samples > 512 ||
    !Number.isInteger(s.seed) ||
    !Number.isFinite(s.availability) ||
    s.availability < 0 ||
    s.availability > 1 ||
    !Number.isFinite(s.scoreCv) ||
    s.scoreCv < 0 ||
    s.scoreCv > 2 ||
    !Number.isFinite(s.roleCv) ||
    s.roleCv < 0 ||
    s.roleCv > 2 ||
    !Number.isFinite(s.teamCorrelation) ||
    s.teamCorrelation < 0 ||
    s.teamCorrelation > 1
  )
    throw new Error(
      'Invalid scenario assumptions. Use 8–512 samples, probabilities from 0 to 1, and variation from 0 to 2.',
    );
}
// Stateless keyed draws give every trade exactly the same player/week scenarios.
function uniform(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}
function normal(key: string) {
  return (
    Math.sqrt(-2 * Math.log(uniform(key + ':u'))) *
    Math.cos(2 * Math.PI * uniform(key + ':v'))
  );
}
export function quantile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * fraction,
    i = Math.floor(at);
  return sorted[i] + (sorted[Math.ceil(at)] - sorted[i]) * (at - i);
}
export function summarizeGains(after: number[], before: number[]) {
  const gains = after.map((n, i) => n - before[i]);
  const mean = gains.reduce((s, n) => s + n, 0) / gains.length;
  const variance =
    gains.length > 1
      ? gains.reduce((s, n) => s + (n - mean) ** 2, 0) / (gains.length - 1)
      : 0;
  return {
    mean,
    p10: quantile(gains, 0.1),
    probabilityImproves: gains.filter((n) => n > 0).length / gains.length,
    standardError: Math.sqrt(variance / gains.length),
    samples: gains.length,
  };
}

function boundedPlayer(
  p: Player,
  league: League,
  horizon: TradeHorizon,
  side: 'lower' | 'upper',
) {
  if (
    !p.projectionBounds?.ros &&
    !Object.keys(p.projectionBounds?.weekly ?? {}).length
  )
    return p;
  let next = p;
  if (p.ros === null && p.projectionBounds?.ros)
    next = { ...next, ros: p.projectionBounds.ros[side] };
  if (horizon !== 'ros') {
    const overrides = { ...next.weeklyOverrides };
    for (const week of horizonWeeks(league, horizon)) {
      if (playerWeek(p, league, week).points !== null) continue;
      const bound = p.projectionBounds?.weekly?.[week];
      if (bound) overrides[week] = bound[side];
    }
    next = { ...next, weeklyOverrides: overrides };
  }
  return next;
}
export function evaluateForecastRoster(
  league: League,
  roster: Player[],
  horizon: TradeHorizon,
  options: {
    streaming?: boolean;
    scenarios?: ScenarioSettings;
    projectionCache?: Map<number, Map<number, ReturnType<typeof playerWeek>>>;
    replacementCache?: Map<number, Player[]>;
  } = {},
): TradeEvaluation {
  // Players with no starting-slot eligibility cannot affect any lineup.
  const relevant = roster.filter((p) =>
    league.slots.some((s) => s.count > 0 && p.eligibleSlots.includes(s.id)),
  );
  const lower = relevant.map((p) => boundedPlayer(p, league, horizon, 'lower'));
  const upper = relevant.map((p) => boundedPlayer(p, league, horizon, 'upper'));
  const bounded = lower.some(
    (p, i) =>
      p.ros !== upper[i].ros ||
      JSON.stringify(p.weeklyOverrides) !==
        JSON.stringify(upper[i].weeklyOverrides),
  );
  const base = evaluateRoster(
    league,
    lower,
    horizon,
    bounded ? undefined : options.projectionCache,
    options.replacementCache,
    {
      streaming: options.streaming ?? false,
    },
  );
  // Identical bounds require one assignment per week, not two.
  const high = bounded
    ? evaluateRoster(
        league,
        upper,
        horizon,
        undefined,
        options.replacementCache,
        {
          streaming: options.streaming ?? false,
        },
      )
    : base;
  const usedPlayerIds = [
    ...new Set(
      [base, high].flatMap((e) =>
        horizon === 'ros'
          ? e.players.map((p) => p.id)
          : e.weeks.flatMap((w) => w.players.map((p) => p.id)),
      ),
    ),
  ];
  if (!options.scenarios)
    return { ...base, upperTotal: high.total, bounded, usedPlayerIds };
  if (horizon === 'ros')
    throw new Error('Use a weekly period for outcome scenarios.');
  if (bounded)
    throw new Error(
      'Outcome scenarios need point forecasts. Resolve bounded missing forecasts or use conservative points mode.',
    );
  const settings = options.scenarios;
  validateScenarios(settings);
  for (const p of relevant) {
    if (
      (p.availabilityProbability !== undefined &&
        (!Number.isFinite(p.availabilityProbability) ||
          p.availabilityProbability < 0 ||
          p.availabilityProbability > 1)) ||
      (p.scoreStdDev !== undefined &&
        (!Number.isFinite(p.scoreStdDev) || p.scoreStdDev < 0)) ||
      (p.roleStdDev !== undefined &&
        (!Number.isFinite(p.roleStdDev) ||
          p.roleStdDev < 0 ||
          p.roleStdDev > 2))
    )
      throw new Error(`Invalid scenario assumptions for ${p.name}.`);
  }
  const weeks = horizonWeeks(league, horizon);
  const scenarioWeeks: Record<number, number[]> = {};
  const scenarioTotals = Array<number>(settings.samples).fill(0);
  let missing = 0;
  for (const week of weeks) {
    scenarioWeeks[week] = [];
    for (let sample = 0; sample < settings.samples; sample++) {
      const forecast = lower.map((p) => {
        // Return weeks are explicit assumptions. IR activation requires a roster plan in reality.
        const recovered = p.returnWeek !== undefined && week >= p.returnWeek;
        const value = playerWeek(
          recovered
            ? {
                ...p,
                slotId: p.slotId === 21 ? 20 : p.slotId,
                status: 'ACTIVE',
              }
            : p,
          league,
          week,
        );
        const probability = p.availabilityProbability ?? settings.availability;
        const key = `${settings.seed}:${sample}:${p.id}`;
        const available =
          !value.unavailable &&
          (p.returnWeek === undefined || week >= p.returnWeek) &&
          uniform(`${key}:${week}:availability`) < probability;
        // Role is observed before lineup selection; scoring noise is observed afterwards.
        const multiplier = Math.max(
          0,
          1 + normal(key + ':role') * (p.roleStdDev ?? settings.roleCv),
        );
        return {
          ...p,
          slotId: recovered && p.slotId === 21 ? 20 : p.slotId,
          eligibleSlots: available ? p.eligibleSlots : [],
          weekly: value.points === null ? null : value.points * multiplier,
        };
      });
      const selected = optimalLineup(forecast, league.slots, 'weekly');
      if (sample === 0) missing += selected.missing;
      const score = selected.players.reduce((sum, p) => {
        const mean = p.weekly!;
        const key = `${settings.seed}:${sample}:${week}`;
        const common = normal(
          `${key}:nfl:${p.nflTeam === 'FA' ? p.id : p.nflTeam}`,
        );
        const individual = normal(`${key}:score:${p.id}`);
        const noise =
          Math.sqrt(settings.teamCorrelation) * common +
          Math.sqrt(1 - settings.teamCorrelation) * individual;
        return (
          sum +
          mean +
          (p.scoreStdDev ?? Math.abs(mean) * settings.scoreCv) * noise
        );
      }, 0);
      scenarioWeeks[week].push(score);
      scenarioTotals[sample] += score;
    }
  }
  const total = scenarioTotals.reduce((s, n) => s + n, 0) / settings.samples;
  return {
    ...base,
    total,
    upperTotal: total,
    missing,
    scenarioTotals,
    scenarioWeeks,
    weeks: base.weeks.map((w) => ({
      ...w,
      total:
        scenarioWeeks[w.week].reduce((s, n) => s + n, 0) / settings.samples,
    })),
  };
}
