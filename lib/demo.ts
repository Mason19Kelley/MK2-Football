import { League, Player, Position, Team, slotNames } from './types';
// Illustrative fixtures, not live NFL data or current rankings.
const pool: [number, string, Position, string, number][] = [
  [3918298, 'Josh Allen', 'QB', 'BUF', 24.8],
  [3116593, 'Baker Mayfield', 'QB', 'TB', 20.1],
  [3139477, 'Patrick Mahomes', 'QB', 'KC', 22.6],
  [3915511, 'Joe Burrow', 'QB', 'CIN', 23.4],
  [4038941, 'Justin Herbert', 'QB', 'LAC', 21.2],
  [4241479, 'Jalen Hurts', 'QB', 'PHI', 24.1],
  [4361741, 'Brock Purdy', 'QB', 'SF', 19.9],
  [4432577, 'C.J. Stroud', 'QB', 'HOU', 20.4],
  [4362628, 'Ja’Marr Chase', 'WR', 'CIN', 21.6],
  [4262921, 'Justin Jefferson', 'WR', 'MIN', 20.8],
  [4241389, 'CeeDee Lamb', 'WR', 'DAL', 19.7],
  [4688813, 'Puka Nacua', 'WR', 'LAR', 19.4],
  [4372016, 'Amon-Ra St. Brown', 'WR', 'DET', 19.1],
  [4685398, 'Malik Nabers', 'WR', 'NYG', 17.4],
  [3116406, 'Tyreek Hill', 'WR', 'MIA', 18.8],
  [4047646, 'A.J. Brown', 'WR', 'PHI', 18.4],
  [3895856, 'DJ Moore', 'WR', 'CHI', 15.1],
  [4035687, 'DK Metcalf', 'WR', 'PIT', 15.6],
  [4047650, 'Terry McLaurin', 'WR', 'WSH', 16.2],
  [4360939, 'Garrett Wilson', 'WR', 'NYJ', 16.8],
  [2976212, 'Mike Evans', 'WR', 'TB', 16.1],
  [4241463, 'Tee Higgins', 'WR', 'CIN', 15.5],
  [4429025, 'Drake London', 'WR', 'ATL', 17.2],
  [4430878, 'Nico Collins', 'WR', 'HOU', 17.8],
  [4429795, 'Chris Olave', 'WR', 'NO', 14.8],
  [4361370, 'DeVonta Smith', 'WR', 'PHI', 14.2],
  [4361259, 'Jaylen Waddle', 'WR', 'MIA', 14.6],
  [4426515, 'George Pickens', 'WR', 'DAL', 14.1],
  [4431299, 'Jaxon Smith-Njigba', 'WR', 'SEA', 16.7],
  [4430027, 'Zay Flowers', 'WR', 'BAL', 14.3],
  [4248528, 'Jameson Williams', 'WR', 'DET', 13.1],
  [4361579, 'Rashod Bateman', 'WR', 'BAL', 10.3],
  [3929630, 'Saquon Barkley', 'RB', 'PHI', 20.3],
  [4430809, 'Bijan Robinson', 'RB', 'ATL', 20.1],
  [4241985, 'Jahmyr Gibbs', 'RB', 'DET', 19.3],
  [3117251, 'Christian McCaffrey', 'RB', 'SF', 18.6],
  [4242335, 'Jonathan Taylor', 'RB', 'IND', 17.8],
  [3043078, 'Derrick Henry', 'RB', 'BAL', 18.2],
  [4429160, 'Breece Hall', 'RB', 'NYJ', 16.4],
  [4362238, 'De’Von Achane', 'RB', 'MIA', 18.1],
  [3051392, 'James Conner', 'RB', 'ARI', 14.2],
  [4427366, 'Kyren Williams', 'RB', 'LAR', 16.6],
  [4241457, 'James Cook', 'RB', 'BUF', 16.1],
  [3931390, 'Josh Jacobs', 'RB', 'GB', 16.8],
  [3116389, 'Alvin Kamara', 'RB', 'NO', 16.4],
  [4047365, 'David Montgomery', 'RB', 'DET', 14.1],
  [4242214, 'Chuba Hubbard', 'RB', 'CAR', 13.6],
  [4240757, 'D’Andre Swift', 'RB', 'CHI', 13.1],
  [4035538, 'Tony Pollard', 'RB', 'TEN', 12.6],
  [4361411, 'Brian Robinson Jr.', 'RB', 'WSH', 12.4],
  [4240657, 'Rhamondre Stevenson', 'RB', 'NE', 12.1],
  [4429794, 'Zach Charbonnet', 'RB', 'SEA', 10.3],
  [4430737, 'Tank Bigsby', 'RB', 'JAX', 9.6],
  [4430968, 'Tyjae Spears', 'RB', 'TEN', 9.1],
  [4567048, 'Blake Corum', 'RB', 'LAR', 8.9],
  [4429955, 'Tyler Allgeier', 'RB', 'ATL', 8.8],
  [15847, 'Travis Kelce', 'TE', 'KC', 13.6],
  [4432665, 'Brock Bowers', 'TE', 'LV', 16.1],
  [3040151, 'George Kittle', 'TE', 'SF', 14.2],
  [4360248, 'Trey McBride', 'TE', 'ARI', 15.8],
  [4036131, 'Sam LaPorta', 'TE', 'DET', 12.8],
  [3116365, 'Mark Andrews', 'TE', 'BAL', 12.4],
  [4240600, 'T.J. Hockenson', 'TE', 'MIN', 11.8],
  [4429096, 'Dalton Kincaid', 'TE', 'BUF', 10.4],
];
function player(
  row: (typeof pool)[number],
  slotId: number,
  index: number,
): Player {
  const [id, name, position, nflTeam, weekly] = row;
  return {
    id,
    name,
    position,
    nflTeam,
    slot: slotNames[slotId],
    slotId,
    eligibleSlots:
      position === 'QB'
        ? [0, 7, 20]
        : position === 'RB'
          ? [2, 3, 7, 23, 20]
          : position === 'WR'
            ? [3, 4, 5, 7, 23, 20]
            : [5, 6, 7, 23, 20],
    status: index === 12 ? 'QUESTIONABLE' : 'ACTIVE',
    weekly,
    ros: Math.round(weekly * 12.5 * 10) / 10,
    season: Math.round(weekly * 16 * 10) / 10,
    actual: Math.round(weekly * 3.1 * 10) / 10,
    projectionSource: 'sample',
  };
}
const names = [
  'The Sunday Club',
  'Gridiron Gang',
  'Hurts So Good',
  'Fourth & Long',
  'The End Zone',
  'No Punt Intended',
  'Red Zone Royals',
  'Sunday Scaries',
];
const owners = [
  'Alex Morgan',
  'Jordan Davis',
  'Chris Parker',
  'Taylor Reed',
  'Sam Bennett',
  'Jamie Wilson',
  'Casey Brooks',
  'Drew Campbell',
];
const teams: Team[] = names.map((name, i) => {
  const rows: [(typeof pool)[number], number][] = [
    [pool[i], 0],
    [pool[32 + i], 2],
    [pool[40 + i], 2],
    [pool[8 + i], 4],
    [pool[16 + i], 4],
    [pool[56 + i], 6],
    [pool[24 + i], 23],
    [pool[48 + i], 20],
  ];
  const players = rows.map(([r, s], j) => player(r, s, j));
  players.push({
    id: -100 - i,
    name: [
      'Baltimore Ravens',
      'Buffalo Bills',
      'Denver Broncos',
      'Philadelphia Eagles',
      'Pittsburgh Steelers',
      'Houston Texans',
      'Minnesota Vikings',
      'Detroit Lions',
    ][i],
    position: 'D/ST',
    nflTeam: ['BAL', 'BUF', 'DEN', 'PHI', 'PIT', 'HOU', 'MIN', 'DET'][i],
    slot: 'D/ST',
    slotId: 16,
    eligibleSlots: [16, 20],
    status: 'ACTIVE',
    weekly: 7.4 + i * 0.2,
    ros: 92.5 + i * 2.5,
    season: 120,
    actual: 23,
    projectionSource: 'sample',
  });
  players.push({
    id: -200 - i,
    name: [
      'Brandon Aubrey',
      'Harrison Butker',
      'Jake Elliott',
      'Cameron Dicker',
      'Chris Boswell',
      'Ka’imi Fairbairn',
      'Tyler Bass',
      'Jason Sanders',
    ][i],
    position: 'K',
    nflTeam: ['DAL', 'KC', 'PHI', 'LAC', 'PIT', 'HOU', 'BUF', 'MIA'][i],
    slot: 'K',
    slotId: 17,
    eligibleSlots: [17, 20],
    status: 'ACTIVE',
    weekly: 8.8 + i * 0.1,
    ros: 110 + i * 1.3,
    season: 145,
    actual: 27,
    projectionSource: 'sample',
  });
  return {
    id: i + 1,
    name,
    abbreviation: ['TSC', 'GG', 'HSG', 'F&L', 'EZ', 'NPI', 'RZR', 'SS'][i],
    owner: owners[i],
    wins: [3, 2, 2, 2, 1, 1, 1, 0][i],
    losses: [0, 1, 1, 1, 2, 2, 2, 3][i],
    ties: 0,
    pointsFor: 438.2 - i * 18.6,
    players,
  };
});
export const demoLeague: League = {
  id: 'demo',
  name: 'The Sunday League',
  season: 2026,
  week: 4,
  finalWeek: 17,
  playoffStartWeek: 15,
  scoring: 'PPR',
  source: 'demo',
  syncedAt: '',
  teams,
  slots: [
    { id: 0, label: 'QB', count: 1 },
    { id: 2, label: 'RB', count: 2 },
    { id: 4, label: 'WR', count: 2 },
    { id: 6, label: 'TE', count: 1 },
    { id: 23, label: 'FLEX', count: 1 },
    { id: 16, label: 'D/ST', count: 1 },
    { id: 17, label: 'K', count: 1 },
  ],
  warnings: [
    'Sample league: all rosters, records, and projections are illustrative. Connect ESPN to see your league.',
  ],
};

// Restore sample defenses removed by older app versions without replacing
// cached roster changes or custom projections. Real leagues must sync ESPN.
export function restoreDemoDefenses(league: League): League {
  if (
    league.source !== 'demo' ||
    !league.slots.some((s) => s.id === 0) ||
    !league.slots.some((s) => s.id === 6)
  )
    return league;
  return {
    ...league,
    slots: league.slots.some((s) => s.id === 16)
      ? league.slots
      : [...league.slots, { id: 16, label: 'D/ST', count: 1 }],
    teams: league.teams.map((t) => {
      const defense = demoLeague.teams
        .find((sample) => sample.id === t.id)
        ?.players.find((p) => p.position === 'D/ST');
      return !defense || t.players.some((p) => p.position === 'D/ST')
        ? t
        : { ...t, players: [...t.players, defense] };
    }),
  };
}

const waiverRows: typeof pool = [
  [14881, 'Geno Smith', 'QB', 'LV', 17.2],
  [4242589, 'Gardner Minshew', 'QB', 'KC', 13.1],
  [4038818, 'Rico Dowdle', 'RB', 'CAR', 15.7],
  [4035537, 'Justice Hill', 'RB', 'BAL', 9.2],
  [4230444, 'Darnell Mooney', 'WR', 'ATL', 12.8],
  [4431570, 'Josh Downs', 'WR', 'IND', 13.3],
  [3046439, 'Hunter Henry', 'TE', 'NE', 10.2],
  [4240925, 'Cade Otton', 'TE', 'TB', 9.3],
];
demoLeague.waiverWire = {
  syncedAt: '',
  truncated: false,
  players: waiverRows.map((row, i) => ({
    ...player(row, 20, i),
    availability: i % 3 === 0 ? 'WAIVERS' : 'FREEAGENT',
    percentOwned: 65 - i * 5,
  })),
};
demoLeague.waiverWire.players.push({
  ...teams[0].players.find((p) => p.position === 'K')!,
  id: -301,
  name: 'Jake Bates',
  nflTeam: 'DET',
  slot: 'BN',
  slotId: 20,
  weekly: 9.2,
  ros: 115,
  availability: 'FREEAGENT',
  percentOwned: 35,
});
demoLeague.waiverWire.players.push({
  ...teams[0].players.find((p) => p.position === 'D/ST')!,
  id: -401,
  name: 'New England Patriots',
  nflTeam: 'NE',
  slot: 'BN',
  slotId: 20,
  weekly: 6.8,
  ros: 85,
  availability: 'WAIVERS',
  percentOwned: 28,
});

// Illustrative bye weeks and forecasts, consistent within each NFL team.
const demoByes: Record<string, number> = {};
for (const [i, team] of Object.entries([
  ...new Set([
    ...teams.flatMap((t) => t.players.map((p) => p.nflTeam)),
    ...demoLeague.waiverWire.players.map((p) => p.nflTeam),
  ]),
]))
  demoByes[team] = 5 + (Number(i) % 9);
for (const p of [
  ...teams.flatMap((t) => t.players),
  ...demoLeague.waiverWire.players,
]) {
  p.byeWeek = demoByes[p.nflTeam];
  p.weeklyProjections = Object.fromEntries(
    Array.from({ length: 14 }, (_, i) => {
      const week = i + 4;
      return [
        week,
        week === p.byeWeek
          ? 0
          : week === 4
            ? p.weekly!
            : (p.ros! - p.weekly!) / 12,
      ];
    }),
  );
}
