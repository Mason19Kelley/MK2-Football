//! Runtime scoring returns compact numeric lineups. JavaScript reconstructs
//! display metadata from the same prepared forecasts; no forecasts cross the
//! WASM boundary while evaluating roster alternatives.
use super::{lineup, Candidate, Player};
use serde::Deserialize;
use std::collections::HashSet;
#[derive(Deserialize)]
pub struct Model {
    slots: Vec<usize>,
    players: Vec<Player>,
    specialists: Vec<Vec<usize>>,
}
impl Model {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let model: Self = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        let weeks = model.specialists.len();
        if model.slots.iter().any(|&s| s > 6)
            || model
                .players
                .iter()
                .any(|p| p.position > 5 || p.weekly.len() != weeks || p.unavailable.len() != weeks)
            || model.specialists.iter().enumerate().any(|(w, indices)| {
                indices.iter().any(|&i| {
                    model
                        .players
                        .get(i)
                        .is_none_or(|p| p.ir || p.weekly[w].is_none())
                })
            })
        {
            return Err("invalid scoring model".into());
        }
        Ok(model)
    }
    pub fn evaluate(
        &self,
        roster: &[usize],
        first: usize,
        last: usize,
    ) -> Result<Vec<f64>, String> {
        if first > last
            || last > self.specialists.len()
            || roster.iter().any(|&i| i >= self.players.len())
        {
            return Err("invalid roster or period".into());
        }
        let owned: HashSet<i64> = roster.iter().map(|&i| self.players[i].id).collect();
        let base_candidates: Vec<Candidate> = roster
            .iter()
            .filter_map(|&i| {
                let p = &self.players[i];
                if p.ir {
                    None
                } else {
                    p.ros.map(|score| Candidate {
                        index: i,
                        score,
                        eligibility: p.eligibility,
                    })
                }
            })
            .collect();
        let base = lineup(&base_candidates, &self.slots, &self.players);
        let mut output = vec![
            base.total,
            base.selected.len() as f64,
            self.slots.len() as f64,
            0.0,
        ];
        output.extend(base.selected.iter().map(|&i| i as f64));
        let mut replacements = Vec::new();
        let mut seen = HashSet::new();
        for week in first..last {
            let mut candidates = Vec::with_capacity(roster.len() + self.specialists[week].len());
            let mut missing = 0;
            for &i in roster {
                let p = &self.players[i];
                if p.ir {
                    continue;
                }
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
                } else {
                    missing += 1;
                }
            }
            for &i in &self.specialists[week] {
                let p = &self.players[i];
                if !owned.contains(&p.id) {
                    candidates.push(Candidate {
                        index: i,
                        score: p.weekly[week].unwrap(),
                        eligibility: p.eligibility,
                    });
                }
            }
            let result = lineup(&candidates, &self.slots, &self.players);
            output.extend([result.total, result.selected.len() as f64, missing as f64]);
            output.extend(result.selected.iter().map(|&i| i as f64));
            for &i in &result.selected {
                if !owned.contains(&self.players[i].id) && seen.insert(self.players[i].id) {
                    replacements.push(i);
                }
            }
        }
        let structural: Vec<Candidate> = roster
            .iter()
            .chain(replacements.iter())
            .filter_map(|&i| {
                let p = &self.players[i];
                if p.ir {
                    None
                } else {
                    Some(Candidate {
                        index: i,
                        score: p.ros.unwrap_or(0.0),
                        eligibility: p.eligibility,
                    })
                }
            })
            .collect();
        output[3] = f64::from(
            first < last
                && !self.slots.is_empty()
                && lineup(&structural, &self.slots, &self.players)
                    .selected
                    .len()
                    == self.slots.len(),
        );
        Ok(output)
    }
}
