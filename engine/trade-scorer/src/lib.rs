use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize)]
struct Player {
    id: i64,
    position: usize,
    eligibility: u32,
    ir: bool,
    ros: Option<f64>,
    weekly: Vec<Option<f64>>,
    unavailable: Vec<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    total: f64,
    missing: usize,
    complete: bool,
    week_totals: Vec<f64>,
    week_filled: Vec<usize>,
    week_selected: Vec<Vec<i64>>,
}
#[derive(Deserialize)]
pub struct Input {
    slots: Vec<usize>,
    players: Vec<Player>,
    specialists: Vec<Vec<usize>>,
    rosters: Vec<Vec<usize>>,
    expected: Vec<Expected>,
}
#[derive(Clone)]
struct Candidate {
    index: usize,
    score: f64,
    eligibility: u32,
}
struct Lineup {
    total: f64,
    selected: Vec<usize>,
}

// The same ordinary-position shortcut and tie fallback as the TypeScript solver.
fn lineup(candidates: &[Candidate], slots: &[usize], players: &[Player]) -> Lineup {
    let mut counts = [0usize; 7];
    let mut starting = 0u32;
    for &slot in slots {
        counts[slot] += 1;
        starting |= 1 << slot;
    }
    if counts[6] > 1 {
        return matching(candidates, slots);
    }
    let mut groups: [Vec<&Candidate>; 6] = std::array::from_fn(|_| Vec::new());
    for c in candidates {
        let eligibility = c.eligibility & starting;
        if eligibility == 0 {
            continue;
        }
        let position = players[c.index].position;
        if position >= 6 {
            return matching(candidates, slots);
        }
        let mut expected = if counts[position] > 0 {
            1 << position
        } else {
            0
        };
        if counts[6] > 0 && (1..=3).contains(&position) {
            expected |= 1 << 6;
        }
        if eligibility != expected {
            return matching(candidates, slots);
        }
        groups[position].push(c);
    }
    let mut chosen = HashSet::new();
    let mut flex = Vec::new();
    for (position, group) in groups.iter_mut().enumerate() {
        group.sort_by(|a, b| b.score.total_cmp(&a.score));
        let count = counts[position].min(group.len());
        if count > 0
            && count < group.len()
            && (group[count - 1].score - group[count].score).abs() <= 1e-8
        {
            return matching(candidates, slots);
        }
        for c in &group[..count] {
            chosen.insert(c.index);
        }
        if (1..=3).contains(&position) {
            flex.extend_from_slice(&group[count..]);
        }
    }
    if counts[6] > 0 && !flex.is_empty() {
        flex.sort_by(|a, b| b.score.total_cmp(&a.score));
        if flex.len() > 1 && (flex[0].score - flex[1].score).abs() <= 1e-8 {
            return matching(candidates, slots);
        }
        chosen.insert(flex[0].index);
    }
    let selected = candidates
        .iter()
        .filter(|c| chosen.contains(&c.index))
        .map(|c| c.index)
        .collect();
    Lineup {
        total: candidates
            .iter()
            .filter(|c| chosen.contains(&c.index))
            .map(|c| c.score)
            .sum(),
        selected,
    }
}
#[derive(Clone)]
struct Edge {
    to: usize,
    rev: usize,
    cap: bool,
    cost: f64,
}
fn add(graph: &mut [Vec<Edge>], from: usize, to: usize, cost: f64) {
    let rev = graph[to].len();
    let back = graph[from].len();
    graph[from].push(Edge {
        to,
        rev,
        cap: true,
        cost,
    });
    graph[to].push(Edge {
        to: from,
        rev: back,
        cap: false,
        cost: -cost,
    });
}
fn matching(candidates: &[Candidate], slots: &[usize]) -> Lineup {
    let slot_start = 1 + candidates.len();
    let sink = slot_start + slots.len();
    let n = sink + 1;
    let mut graph = vec![Vec::new(); n];
    for (i, c) in candidates.iter().enumerate() {
        add(&mut graph, 0, 1 + i, 0.0);
        for (j, &slot) in slots.iter().enumerate() {
            if c.eligibility & (1 << slot) != 0 {
                add(&mut graph, 1 + i, slot_start + j, -c.score);
            }
        }
    }
    for j in 0..slots.len() {
        add(&mut graph, slot_start + j, sink, 0.0);
    }
    let mut cost = 0.0;
    for _ in 0..slots.len() {
        let mut dist = vec![f64::INFINITY; n];
        let mut prev = vec![(0, 0); n];
        dist[0] = 0.0;
        for _ in 0..n - 1 {
            let mut changed = false;
            for u in 0..n {
                if dist[u].is_finite() {
                    for (ei, e) in graph[u].iter().enumerate() {
                        if e.cap && dist[u] + e.cost < dist[e.to] - 1e-8 {
                            dist[e.to] = dist[u] + e.cost;
                            prev[e.to] = (u, ei);
                            changed = true;
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }
        if !dist[sink].is_finite() {
            break;
        }
        let mut v = sink;
        while v != 0 {
            let (u, ei) = prev[v];
            let to = graph[u][ei].to;
            let rev = graph[u][ei].rev;
            graph[u][ei].cap = false;
            graph[to][rev].cap = true;
            v = u;
        }
        cost += dist[sink];
    }
    let selected = candidates
        .iter()
        .enumerate()
        .filter(|(i, _)| {
            graph[i + 1]
                .iter()
                .any(|e| e.to >= slot_start && e.to < sink && !e.cap)
        })
        .map(|(_, c)| c.index)
        .collect();
    Lineup {
        total: if cost == 0.0 { 0.0 } else { -cost },
        selected,
    }
}
fn same(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-7
}
fn evaluate(input: &Input, roster: &[usize], expected: &Expected) -> Result<f64, String> {
    let owned: HashSet<i64> = roster.iter().map(|&i| input.players[i].id).collect();
    let mut total = 0.0;
    let mut missing = 0;
    let mut replacements = HashSet::new();
    for week in 0..input.specialists.len() {
        let mut candidates = Vec::with_capacity(roster.len() + 20);
        for &i in roster {
            let p = &input.players[i];
            if !p.ir && p.weekly[week].is_none() {
                missing += 1;
            }
            if !p.ir {
                if let Some(score) = p.weekly[week] {
                    candidates.push(Candidate {
                        index: i,
                        score,
                        eligibility: if p.unavailable[week] {
                            0
                        } else {
                            p.eligibility
                        },
                    });
                }
            }
        }
        for &i in &input.specialists[week] {
            let p = &input.players[i];
            if !owned.contains(&p.id) {
                candidates.push(Candidate {
                    index: i,
                    score: p.weekly[week].unwrap(),
                    eligibility: p.eligibility,
                });
            }
        }
        let result = lineup(&candidates, &input.slots, &input.players);
        let selected: Vec<i64> = result
            .selected
            .iter()
            .map(|&i| input.players[i].id)
            .collect();
        if !same(result.total, expected.week_totals[week])
            || result.selected.len() != expected.week_filled[week]
            || selected != expected.week_selected[week]
        {
            return Err(format!(
                "week {week}: total {} vs {}, selected {:?} vs {:?}",
                result.total, expected.week_totals[week], selected, expected.week_selected[week]
            ));
        }
        for &i in &result.selected {
            if !owned.contains(&input.players[i].id) {
                replacements.insert(i);
            }
        }
        total += result.total;
    }
    let mut structural: Vec<Candidate> = roster
        .iter()
        .chain(replacements.iter())
        .filter(|&&i| !input.players[i].ir)
        .map(|&i| Candidate {
            index: i,
            score: input.players[i].ros.unwrap_or(0.0),
            eligibility: input.players[i].eligibility,
        })
        .collect();
    // Structural completeness only depends on coverage, not ordering or points.
    structural.sort_by_key(|c| c.index);
    let complete = !input.specialists.is_empty()
        && lineup(&structural, &input.slots, &input.players)
            .selected
            .len()
            == input.slots.len()
        && !input.slots.is_empty();
    if !same(total, expected.total) || missing != expected.missing || complete != expected.complete
    {
        return Err(format!(
            "summary: {total}/{missing}/{complete} vs {}/{}/{}",
            expected.total, expected.missing, expected.complete
        ));
    }
    Ok(total)
}

pub fn parse(bytes: &[u8]) -> Result<Input, String> {
    let input: Input = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if input.rosters.len() != input.expected.len() {
        return Err("corpus length mismatch".into());
    }
    let weeks = input.specialists.len();
    if input.slots.iter().any(|&s| s > 6)
        || input
            .players
            .iter()
            .any(|p| p.position > 5 || p.weekly.len() != weeks || p.unavailable.len() != weeks)
        || input
            .rosters
            .iter()
            .chain(input.specialists.iter())
            .flatten()
            .any(|&i| i >= input.players.len())
        || input.expected.iter().any(|e| {
            e.week_totals.len() != weeks
                || e.week_filled.len() != weeks
                || e.week_selected.len() != weeks
        })
    {
        return Err("invalid corpus dimensions or indices".into());
    }
    Ok(input)
}
impl Input {
    pub fn roster_count(&self) -> usize {
        self.rosters.len()
    }
    pub fn week_count(&self) -> usize {
        self.specialists.len()
    }
}
pub fn score(input: &Input, start: usize, end: usize) -> Result<f64, String> {
    if start > end || end > input.rosters.len() {
        return Err("invalid roster range".into());
    }
    let mut checksum = 0.0;
    for i in start..end {
        checksum += evaluate(input, &input.rosters[i], &input.expected[i])
            .map_err(|e| format!("roster {i}: {e}"))?;
    }
    Ok(checksum)
}
pub mod runtime;
#[cfg(target_arch = "wasm32")]
mod wasm;
#[cfg(test)]
mod tests {
    use super::*;
    fn player(id: i64, position: usize, eligibility: u32) -> Player {
        Player {
            id,
            position,
            eligibility,
            ir: false,
            ros: Some(1.0),
            weekly: vec![Some(1.0)],
            unavailable: vec![false],
        }
    }
    fn exhaustive(
        candidates: &[Candidate],
        slots: &[usize],
        at: usize,
        used: &mut Vec<usize>,
        score: f64,
        best: &mut (usize, f64),
    ) {
        if at == slots.len() {
            if used.len() > best.0 || (used.len() == best.0 && score > best.1) {
                *best = (used.len(), score);
            }
            return;
        }
        exhaustive(candidates, slots, at + 1, used, score, best);
        for c in candidates {
            if !used.contains(&c.index) && c.eligibility & (1 << slots[at]) != 0 {
                used.push(c.index);
                exhaustive(candidates, slots, at + 1, used, score + c.score, best);
                used.pop();
            }
        }
    }
    #[test]
    fn scores_match_exhaustive_assignments() {
        let slots = [1, 1, 2, 6];
        let mut seed = 29u32;
        for _ in 0..200 {
            let mut players = Vec::new();
            let mut candidates = Vec::new();
            for i in 0..7 {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let position = if seed.is_multiple_of(2) { 1 } else { 2 };
                let eligibility = if seed.is_multiple_of(9) {
                    0
                } else {
                    (1 << position) | (1 << 6)
                };
                let score = ((seed >> 16) % 12) as f64 - 5.0;
                players.push(player(i as i64, position, eligibility));
                candidates.push(Candidate {
                    index: i,
                    score,
                    eligibility,
                });
            }
            let actual = lineup(&candidates, &slots, &players);
            let mut best = (0, f64::NEG_INFINITY);
            exhaustive(&candidates, &slots, 0, &mut Vec::new(), 0.0, &mut best);
            assert_eq!(actual.selected.len(), best.0);
            assert!(same(actual.total, best.1));
        }
    }
    #[test]
    fn equal_scores_keep_input_order() {
        let players = vec![
            player(3, 1, (1 << 1) | (1 << 6)),
            player(1, 1, (1 << 1) | (1 << 6)),
            player(2, 1, (1 << 1) | (1 << 6)),
        ];
        let candidates: Vec<_> = players
            .iter()
            .enumerate()
            .map(|(i, p)| Candidate {
                index: i,
                score: 10.0,
                eligibility: p.eligibility,
            })
            .collect();
        assert_eq!(lineup(&candidates, &[1, 6], &players).selected, vec![0, 1]);
    }
    #[test]
    fn nonstandard_eligibility_uses_matching() {
        let players = vec![
            player(1, 1, (1 << 1) | (1 << 6)),
            player(2, 1, 1 << 1),
            player(3, 1, 1 << 6),
        ];
        let candidates = vec![
            Candidate {
                index: 0,
                score: 100.0,
                eligibility: players[0].eligibility,
            },
            Candidate {
                index: 1,
                score: 90.0,
                eligibility: players[1].eligibility,
            },
            Candidate {
                index: 2,
                score: 80.0,
                eligibility: players[2].eligibility,
            },
        ];
        let result = lineup(&candidates, &[1, 6], &players);
        assert_eq!(result.total, 190.0);
        assert_eq!(result.selected, vec![0, 1]);
    }
    #[test]
    fn weekly_validation_catches_wrong_selected_players_and_ir() {
        let mut ir = player(2, 0, 1);
        ir.ir = true;
        ir.weekly = vec![Some(0.0)];
        let input = Input {
            slots: vec![0],
            players: vec![player(1, 0, 1), ir],
            specialists: vec![vec![]],
            rosters: vec![],
            expected: vec![],
        };
        let expected = Expected {
            total: 1.0,
            missing: 0,
            complete: true,
            week_totals: vec![1.0],
            week_filled: vec![1],
            week_selected: vec![vec![1]],
        };
        assert_eq!(evaluate(&input, &[0, 1], &expected).unwrap(), 1.0);
        let wrong = Expected {
            week_selected: vec![vec![2]],
            ..expected
        };
        assert!(evaluate(&input, &[0, 1], &wrong).is_err());
    }
}
