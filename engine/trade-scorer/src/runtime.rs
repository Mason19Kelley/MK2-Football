//! Runtime scoring returns compact numeric lineups. JavaScript reconstructs
//! display metadata from the same prepared forecasts; no forecasts cross the
//! WASM boundary while evaluating roster alternatives.
use super::{lineup, Candidate, Player};
use serde::Deserialize;
use std::collections::HashMap;
#[derive(Deserialize)]
pub struct Model {
    slots: Vec<usize>,
    players: Vec<Player>,
    specialists: Vec<Vec<usize>>,
    // Per-week free agents for one-week fills of temporary vacancies.
    #[serde(default)]
    fills: Vec<Vec<usize>>,
    #[serde(skip)]
    core_slots: Vec<usize>,
    #[serde(skip)]
    identities: Vec<usize>,
    #[serde(skip)]
    owned: Vec<u32>,
    #[serde(skip)]
    seen: Vec<u32>,
    #[serde(skip)]
    generation: u32,
    #[serde(skip)]
    candidates: Vec<Candidate>,
    #[serde(skip)]
    replacements: Vec<usize>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reused_flags_preserve_ownership_across_rosters_and_generation_wrap() {
        let player = |id, position, ir, ros, weekly| {
            serde_json::json!({
                "id": id, "position": position, "eligibility": 1 << position,
                "ir": ir, "ros": ros, "weekly": [weekly], "unavailable": [false],
            })
        };
        let bytes = serde_json::to_vec(&serde_json::json!({
            "slots": [0, 5],
            "players": [
                player(10, 0, false, 10, 5),
                player(20, 5, false, 4, 4),
                player(20, 5, false, 7, 7),
                player(20, 5, true, 7, 7),
            ],
            "specialists": [[1]],
        }))
        .unwrap();
        let mut model = Model::parse(&bytes).unwrap();
        let mut output = Vec::new();
        let cases: &[(&[usize], &[f64])] = &[
            (&[0], &[10., 1., 2., 1., 0., 9., 2., 0., 0., 1.]),
            (&[0, 2], &[17., 2., 2., 1., 0., 2., 12., 2., 0., 0., 2.]),
            (&[0, 3], &[10., 1., 2., 0., 0., 5., 1., 0., 0.]),
            (&[], &[0., 0., 2., 0., 4., 1., 0., 1.]),
        ];
        for generation in [0, u32::MAX] {
            model.generation = generation;
            for &(roster, expected) in cases {
                model.evaluate_into(roster, 0, 1, &mut output).unwrap();
                assert_eq!(output, expected);
            }
        }
        assert!(model.evaluate_into(&[99], 0, 1, &mut output).is_err());
        assert!(model.evaluate_into(&[0], 0, 2, &mut output).is_err());
    }
}
impl Model {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let mut model: Self = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        let weeks = model.specialists.len();
        if model.slots.iter().any(|&s| s > 6)
            || model
                .players
                .iter()
                .any(|p| p.position > 5 || p.weekly.len() != weeks || p.unavailable.len() != weeks)
            || (!model.fills.is_empty() && model.fills.len() != weeks)
            || model
                .specialists
                .iter()
                .chain(model.fills.iter())
                .enumerate()
                .any(|(w, indices)| {
                    indices.iter().any(|&i| {
                        model
                            .players
                            .get(i)
                            .is_none_or(|p| p.ir || p.weekly[w % weeks].is_none())
                    })
                })
        {
            return Err("invalid scoring model".into());
        }
        // Active, IR and specialist entries for the same player share an identity.
        // Allocate membership flags once; scoring only advances their generation.
        let mut identities = HashMap::new();
        model.identities = model
            .players
            .iter()
            .map(|p| {
                let next = identities.len();
                *identities.entry(p.id).or_insert(next)
            })
            .collect();
        // K and D/ST (slot indices 4 and 5) are streamed separately.
        model.core_slots = model
            .slots
            .iter()
            .copied()
            .filter(|&s| s != 4 && s != 5)
            .collect();
        model.owned.resize(identities.len(), 0);
        model.seen.resize(identities.len(), 0);
        Ok(model)
    }
    pub fn evaluate_into(
        &mut self,
        roster: &[usize],
        first: usize,
        last: usize,
        output: &mut Vec<f64>,
    ) -> Result<(), String> {
        if first > last
            || last > self.specialists.len()
            || roster.iter().any(|&i| i >= self.players.len())
        {
            return Err("invalid roster or period".into());
        }
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.owned.fill(0);
            self.seen.fill(0);
            self.generation = 1;
        }
        let generation = self.generation;
        for &i in roster {
            self.owned[self.identities[i]] = generation;
        }
        let candidates = &mut self.candidates;
        candidates.clear();
        candidates.extend(roster.iter().filter_map(|&i| {
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
        }));
        let base = lineup(candidates, &self.slots, &self.players);
        let base_complete = !self.core_slots.is_empty()
            && lineup(candidates, &self.core_slots, &self.players)
                .selected
                .len()
                == self.core_slots.len();
        output.clear();
        output.extend([
            base.total,
            base.selected.len() as f64,
            self.slots.len() as f64,
            0.0,
        ]);
        output.extend(base.selected.iter().map(|&i| i as f64));
        let replacements = &mut self.replacements;
        replacements.clear();
        for week in first..last {
            candidates.clear();
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
                if self.owned[self.identities[i]] != generation {
                    candidates.push(Candidate {
                        index: i,
                        score: p.weekly[week].unwrap(),
                        eligibility: p.eligibility,
                    });
                }
            }
            let mut result = lineup(candidates, &self.slots, &self.players);
            // Mirrors evaluateRoster's bye fills: owned players keep priority,
            // free agents only cover vacancies, a bench player is
            // dropped for the week and re-added, and real points are summed.
            let vacancies = self.slots.len() - result.selected.len();
            let fills = self.fills.get(week).map_or(&[][..], |f| &f[..]);
            if vacancies > 0 && base_complete && !fills.is_empty() {
                let owned = &self.owned;
                let identities = &self.identities;
                let picked: Vec<usize> = result
                    .selected
                    .iter()
                    .copied()
                    .filter(|&i| owned[identities[i]] != generation)
                    .collect();
                let mut all: Vec<Candidate> = candidates
                    .iter()
                    .filter(|c| owned[identities[c.index]] == generation)
                    .map(|c| Candidate {
                        index: c.index,
                        score: c.score,
                        eligibility: c.eligibility,
                    })
                    .collect();
                let owned_count = all.len();
                for &i in &picked {
                    all.push(Candidate {
                        index: i,
                        score: self.players[i].weekly[week].unwrap_or(0.0),
                        eligibility: self.players[i].eligibility,
                    });
                }
                for &i in fills {
                    if owned[identities[i]] == generation
                        || picked.iter().any(|&j| identities[j] == identities[i])
                    {
                        continue;
                    }
                    all.push(Candidate {
                        index: i,
                        score: self.players[i].weekly[week].unwrap(),
                        eligibility: self.players[i].eligibility,
                    });
                }
                let bonus = 1.0 + all.iter().map(|c| c.score.abs()).sum::<f64>();
                for c in &mut all[..owned_count] {
                    c.score += bonus;
                }
                let supplemented = lineup(&all, &self.slots, &self.players);
                let total = supplemented
                    .selected
                    .iter()
                    .map(|&i| self.players[i].weekly[week].unwrap_or(0.0))
                    .sum();
                result = super::Lineup {
                    total,
                    selected: supplemented.selected,
                };
            }
            output.extend([result.total, result.selected.len() as f64, missing as f64]);
            output.extend(result.selected.iter().map(|&i| i as f64));
            for &i in &result.selected {
                if self.owned[self.identities[i]] != generation
                    && self.seen[self.identities[i]] != generation
                {
                    self.seen[self.identities[i]] = generation;
                    replacements.push(i);
                }
            }
        }
        candidates.clear();
        candidates.extend(roster.iter().chain(replacements.iter()).filter_map(|&i| {
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
        }));
        output[3] = f64::from(
            first < last
                && !self.slots.is_empty()
                && lineup(candidates, &self.slots, &self.players)
                    .selected
                    .len()
                    == self.slots.len(),
        );
        Ok(())
    }
}
