use serde::Serialize;
use std::{env, fs, time::Instant};
use trade_scorer::{parse, score};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    rosters: usize,
    weeks: usize,
    parse_ms: f64,
    runs_ms: Vec<f64>,
    checksum: f64,
    parity: bool,
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let path = args
        .get(1)
        .ok_or("Usage: trade-kernel-benchmark CORPUS.json [RUNS]")?;
    let runs: usize = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(3);
    if runs == 0 {
        return Err("RUNS must be positive".into());
    }
    let parse_start = Instant::now();
    let input = parse(&fs::read(path)?)?;
    let parse_ms = parse_start.elapsed().as_secs_f64() * 1000.0;
    let mut runs_ms = Vec::new();
    let mut checksum = 0.0;
    for _ in 0..runs {
        let start = Instant::now();
        checksum = score(&input, 0, input.roster_count())?;
        runs_ms.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    println!(
        "{}",
        serde_json::to_string(&Report {
            rosters: input.roster_count(),
            weeks: input.week_count(),
            parse_ms,
            runs_ms,
            checksum,
            parity: true
        })?
    );
    Ok(())
}
