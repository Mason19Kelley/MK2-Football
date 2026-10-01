import { League, Player, Position } from './types';
import {
  evaluateRoster,
  horizonWeeks,
  playerWeek,
  TradeEvaluation,
  TradeHorizon,
  specialistStreamingCandidates,
  weeklyLineup,
} from './weekly-trades';
import { optimalLineup } from './trades';

export type ScenarioSettings = {
  samples: number;
  seed: number;
  availability: number;
  scoreCv: number;
  roleCv: number;
  teamCorrelation: number;
  // Distribution of a player's weekly score around their forecast.
  scoreShape: ScoreShape;
};
export type ScoreShape = 'gamma' | 'lognormal';
export const defaultScenarioSettings: ScenarioSettings = {
  samples: 64,
  seed: 2026,
  availability: 0.95,
  scoreCv: 1,
  roleCv: 0.1,
  teamCorrelation: 0.2,
  scoreShape: 'gamma',
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
    s.teamCorrelation > 1 ||
    !['gamma', 'lognormal'].includes(s.scoreShape)
  )
    throw new Error(
      'Invalid scenario assumptions. Use 8–512 samples, probabilities from 0 to 1, and variation from 0 to 2.',
    );
}
// Weekly scoring spread is a fixed amount plus a share of the forecast, so
// low projections stay relatively more volatile. At a typical starter's
// forecast this gives CVs of QB 0.40, RB 0.55, WR 0.60, TE 0.65, K 0.50 and
// D/ST 0.80; a 5-point skill player lands near 0.9. `scoreCv` scales these.
const scoreSpread: Record<Position, { fixed: number; share: number }> = {
  QB: { fixed: 3.5, share: 0.2 },
  RB: { fixed: 2.8, share: 0.33 },
  WR: { fixed: 2.4, share: 0.42 },
  TE: { fixed: 2.8, share: 0.34 },
  K: { fixed: 2, share: 0.25 },
  'D/ST': { fixed: 3, share: 0.37 },
};
// D/ST can score below zero, so its weekly score is drawn on a shifted scale.
const scoreShift: Partial<Record<Position, number>> = { 'D/ST': 5 };
export function scoreStdDev(
  position: Position,
  forecast: number,
  scale: number,
) {
  const { fixed, share } = scoreSpread[position];
  return scale * (fixed + share * Math.max(0, forecast));
}
// Standard normal CDF (Abramowitz–Stegun 7.1.26, error below 1.5e-7).
function normalCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const erf =
    1 -
    t *
      (0.254829592 +
        t *
          (-0.284496736 +
            t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
// A weekly score with the given mean and standard deviation, driven by a
// standard normal draw so shared team noise still applies. Both shapes are
// non-negative and right-skewed. Backtests found the lognormal's low tail too
// thin: real bad weeks fall below its 10th percentile about twice as often.
// The gamma has a heavier low tail and piles some probability at zero for
// low projections. It uses the Wilson–Hilferty transform, rescaled so the
// mean is exact even when the cube is clamped at zero.
export function scoreDraw(
  shape: ScoreShape,
  position: Position,
  mean: number,
  sd: number,
  z: number,
) {
  const shift = scoreShift[position] ?? 0;
  const center = mean + shift;
  if (center <= 0 || sd === 0) return mean + sd * z;
  const cv = sd / center;
  if (shape === 'lognormal') {
    const s2 = Math.log(1 + cv ** 2);
    return center * Math.exp(Math.sqrt(s2) * z - s2 / 2) - shift;
  }
  const c = cv ** 2 / 9;
  const b = Math.sqrt(c);
  const t = (1 - c) / b;
  const expected =
    b ** 3 *
    ((t ** 3 + 3 * t) * normalCdf(t) +
      ((t ** 2 + 2) * Math.exp(-(t * t) / 2)) / Math.sqrt(2 * Math.PI));
  return (center * Math.max(0, 1 - c + b * z) ** 3) / expected - shift;
}
// Stateless keyed draws give every trade exactly the same player/week scenarios.
export function uniform(key: string) {
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
export function normal(key: string) {
  return (
    Math.sqrt(-2 * Math.log(uniform(key + ':u'))) *
    Math.cos(2 * Math.PI * uniform(key + ':v'))
  );
}
// Keys match the scenario cache so both paths draw identical scenarios.
export function roleMultiplier(
  settings: ScenarioSettings,
  p: Pick<Player, 'id' | 'roleStdDev'>,
  sample: number,
) {
  return Math.max(
    0,
    1 +
      normal(`${settings.seed}:${sample}:${p.id}:role`) *
        (p.roleStdDev ?? settings.roleCv),
  );
}
export function scoreNoise(
  settings: ScenarioSettings,
  p: Pick<Player, 'id' | 'nflTeam'>,
  week: number,
  sample: number,
) {
  const key = `${settings.seed}:${sample}:${week}`;
  const common = normal(`${key}:nfl:${p.nflTeam === 'FA' ? p.id : p.nflTeam}`);
  const individual = normal(`${key}:score:${p.id}`);
  return (
    Math.sqrt(settings.teamCorrelation) * common +
    Math.sqrt(1 - settings.teamCorrelation) * individual
  );
}
export type ScenarioCache = {
  league: League;
  settings: ScenarioSettings;
  forecast: (player: Player, week: number, sample: number) => Player;
  noise: (player: Player, week: number, sample: number) => number;
};

// A search uses immutable forecasts and assumptions. Retain compact numeric
// arrays rather than one cloned Player per player/week/sample combination.
export function createScenarioCache(
  league: League,
  settings: ScenarioSettings,
): ScenarioCache {
  validateScenarios(settings);
  const roles = new Map<number, Float64Array>();
  const forecasts = new Map<
    string,
    Map<
      number,
      {
        means?: Float64Array;
        available: Uint8Array;
        recovered: boolean;
      }
    >
  >();
  const individual = new Map<number, Map<number, Float64Array>>();
  const common = new Map<string, Map<number, Float64Array>>();
  const emptySlots: number[] = [];
  const commonWeight = Math.sqrt(settings.teamCorrelation);
  const individualWeight = Math.sqrt(1 - settings.teamCorrelation);
  const draws = <K>(
    cache: Map<K, Map<number, Float64Array>>,
    identity: K,
    week: number,
    key: (sample: number) => string,
  ) => {
    let weeks = cache.get(identity);
    if (!weeks) cache.set(identity, (weeks = new Map()));
    let values = weeks.get(week);
    if (!values) {
      values = Float64Array.from({ length: settings.samples }, (_, sample) =>
        normal(key(sample)),
      );
      weeks.set(week, values);
    }
    return values;
  };
  return {
    league,
    settings,
    forecast(p, week, sample) {
      if (p.currentGame?.week === week && p.currentGame.state !== 'scheduled')
        return { ...p, weekly: playerWeek(p, league, week).points };
      // Specialist copies restrict eligibility and can carry a different weekly
      // value; IR and active copies must also remain separate.
      const identity = `${p.id}:${p.slotId === 21}:${p.weekly}:${p.eligibleSlots.join(',')}`;
      let weeks = forecasts.get(identity);
      if (!weeks) forecasts.set(identity, (weeks = new Map()));
      let prepared = weeks.get(week);
      if (!prepared) {
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
        let role = roles.get(p.id);
        if (!role) {
          role = Float64Array.from({ length: settings.samples }, (_, sample) =>
            normal(`${settings.seed}:${sample}:${p.id}:role`),
          );
          roles.set(p.id, role);
        }
        const probability = p.availabilityProbability ?? settings.availability;
        const means =
          value.points === null
            ? undefined
            : new Float64Array(settings.samples);
        const available = new Uint8Array(settings.samples);
        for (let sample = 0; sample < settings.samples; sample++) {
          available[sample] = Number(
            !value.unavailable &&
              (p.returnWeek === undefined || week >= p.returnWeek) &&
              uniform(
                `${settings.seed}:${sample}:${p.id}:${week}:availability`,
              ) < probability,
          );
          if (means)
            means[sample] =
              value.points! *
              Math.max(0, 1 + role[sample] * (p.roleStdDev ?? settings.roleCv));
        }
        weeks.set(week, (prepared = { means, available, recovered }));
      }
      return {
        ...p,
        slotId: prepared.recovered && p.slotId === 21 ? 20 : p.slotId,
        eligibleSlots: prepared.available[sample]
          ? p.eligibleSlots
          : emptySlots,
        weekly: prepared.means ? prepared.means[sample] : null,
      };
    },
    noise(p, week, sample) {
      const team = String(p.nflTeam === 'FA' ? p.id : p.nflTeam);
      const shared = draws(
        common,
        team,
        week,
        (sample) => `${settings.seed}:${sample}:${week}:nfl:${team}`,
      );
      const own = draws(
        individual,
        p.id,
        week,
        (sample) => `${settings.seed}:${sample}:${week}:score:${p.id}`,
      );
      return commonWeight * shared[sample] + individualWeight * own[sample];
    },
  };
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
  if (p.ros === null && p.projectionBounds?.ros) {
    next = { ...next, ros: p.projectionBounds.ros[side] };
    if (horizon !== 'ros') {
      // Bounds describe a total rather than a per-game forecast. Preserve known
      // weeks and apply the bound to only the unknown active weeks.
      const weeks = horizonWeeks(league, 'remaining').filter(
        (w) => w !== p.byeWeek,
      );
      const unknown = weeks.filter(
        (w) => playerWeek(p, league, w).points === null,
      );
      const known = weeks.reduce(
        (sum, w) => sum + (playerWeek(p, league, w).points ?? 0),
        0,
      );
      next.weeklyOverrides = { ...next.weeklyOverrides };
      for (const week of unknown)
        next.weeklyOverrides[week] =
          Math.max(0, p.projectionBounds.ros[side] - known) / unknown.length;
    }
  }
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
    streamSpecialists?: boolean;
    scenarios?: ScenarioSettings;
    scenarioCache?: ScenarioCache;
    projectionCache?: Map<number, Map<number, ReturnType<typeof playerWeek>>>;
    replacementCache?: Map<number, Player[]>;
    specialistCache?: Map<number, Player[]>;
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
      streamSpecialists: options.streamSpecialists,
      specialistCache: options.specialistCache,
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
          streamSpecialists: options.streamSpecialists,
          specialistCache: options.specialistCache,
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
  const scenarioCache =
    options.scenarioCache?.league === league &&
    options.scenarioCache.settings === settings
      ? options.scenarioCache
      : undefined;
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
    const candidates =
      options.streamSpecialists === false
        ? []
        : specialistStreamingCandidates(
            league,
            lower,
            week,
            options.specialistCache,
          );
    const weeklyRoster = [...lower, ...candidates];
    for (let sample = 0; sample < settings.samples; sample++) {
      const forecast = weeklyRoster.map((p) => {
        if (p.currentGame?.week === week && p.currentGame.state !== 'scheduled')
          return { ...p, weekly: playerWeek(p, league, week).points };
        if (scenarioCache) return scenarioCache.forecast(p, week, sample);
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
        const multiplier = roleMultiplier(settings, p, sample);
        return {
          ...p,
          slotId: recovered && p.slotId === 21 ? 20 : p.slotId,
          eligibleSlots: available ? p.eligibleSlots : [],
          weekly: value.points === null ? null : value.points * multiplier,
        };
      });
      const selected = weeklyLineup(league, week, forecast);
      if (sample === 0) missing += selected.missing;
      const score = selected.players.reduce((sum, p) => {
        const game =
          p.currentGame?.week === week && p.currentGame.state !== 'scheduled'
            ? p.currentGame
            : undefined;
        if (game?.remainingFraction === 0) return sum + (game.actual ?? 0);
        const banked = game?.actual ?? 0;
        const mean = p.weekly! - banked;
        const noise = scenarioCache
          ? scenarioCache.noise(p, week, sample)
          : scoreNoise(settings, p, week, sample);
        // Live games draw only the unplayed portion; its spread is the
        // full-game spread scaled by the square root of the time remaining.
        const remaining = game?.remainingFraction ?? 1;
        const sd =
          (p.scoreStdDev ??
            scoreStdDev(p.position, mean / remaining, settings.scoreCv)) *
          Math.sqrt(remaining);
        return (
          sum +
          banked +
          scoreDraw(settings.scoreShape, p.position, mean, sd, noise)
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
