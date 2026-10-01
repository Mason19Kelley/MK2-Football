# Rust trade-scoring benchmark

The benchmark suite compares native Rust, browser WebAssembly, and TypeScript roster scoring. The application now uses the shared Rust scorer compiled to WebAssembly inside its existing browser worker. Trade enumeration, roster planning, ranking, and display metadata remain in TypeScript; no backend is required.

The harness copies the current TypeScript engine to a temporary directory and adds a tracing wrapper there. It captures every roster evaluated by a one-for-one, deterministic points search with minimum gains of 1 and the waiver baseline enabled. Production source files are not instrumented. Rust receives the entire corpus once. Native Rust scores the whole batch internally; the browser worker invokes Rust in chunks of 2,000 rosters without transferring roster/player objects between calls.

## Run

Requires Node/npm dependencies and a Rust toolchain with Cargo. From the repository root:

```sh
npm run benchmark:rust -- /absolute/path/to/forecast-snapshot.json MY_TEAM_ID PARTNER_ID 3
```

A small smoke run needs no private snapshot:

```sh
npm run benchmark:rust -- --demo 1 2 3
cargo test --manifest-path engine/trade-scorer/Cargo.toml
```

The harness generates `data/trade-history/rust-benchmark/corpus.json` and `report.json`. This directory is ignored by Git. Each run replaces these local artifacts. The corpus is large (about 207 MB for the measured league) and contains exported player data; keep it local.

To replay only the existing corpus:

```sh
benchmarks/rust-trades/target/release/trade-kernel-benchmark \
  data/trade-history/rust-benchmark/corpus.json 3
```

## Measured result

October 1, 2026, Apple M4 Pro, arm64, Node v25.2.0, Rust 1.98.1, release build with thin LTO, one process/thread:

| Measurement                                              |    Time |
| -------------------------------------------------------- | ------: |
| TypeScript full search with tracing                      | 31.69 s |
| TypeScript scoring calls, excluding trace collection     | 27.45 s |
| TypeScript scoring replay with parity checks             | 26.94 s |
| Rust scoring replay with parity checks, median of 3 runs |  3.17 s |
| Rust corpus read and JSON parsing, measured separately   |  0.57 s |

The workload was Team 3 → Team 1, remaining weeks 4–17, 182 trade packages, 150,460 roster evaluations, and zero qualifying offers. Rust replay timings were 3.216 s, 3.172 s, and 3.162 s. The measured scoring speedup was **8.65×** relative to the TypeScript scoring-call time, or **8.49×** relative to the checked TypeScript replay.

All 150,460 roster totals, missing-projection counts, and structural completeness flags matched. Every weekly total, filled-slot count, and ordered list of selected player IDs matched across 2,106,440 weekly lineups. Comparisons use a 1e-7 absolute tolerance for scores and exact equality for counts/flags/player IDs; a mismatch exits with an error and identifies the roster/week.

## Scope and interpretation

Rust implements the same ordinary-position-plus-one-FLEX shortcut and matching fallback for unusual eligibility or ties. It respects IR, precomputed weekly availability, negative scores, owned-player exclusion from the specialist pool, and structural lineup coverage. Unit tests compare varied lineups against exhaustive assignments, preserve tie order, exercise the matching fallback, and verify rejection of wrong expected outputs.

This is a numeric scoring prototype, not a complete `TradeEvaluation` implementation. JavaScript prepares projections and specialist pools once. Rust does not generate estimated-score/unknown-bye annotations, the legacy ROS display lineup, or display player objects. TypeScript includes that work in its timing. Therefore the 8.65× result measures this Rust implementation and its compact representation against the current TypeScript scorer; it is not a controlled measurement of language choice alone.

Trade enumeration, add/drop planning, ranking, forecast preparation, worker startup, and browser/network overhead are outside the Rust replay. The reference full search includes trace collection overhead. Do not advertise 3.17 s as full-search latency. The native run does not measure parallel execution, WebAssembly, server hardware, or production request serialization. The browser experiment below measures WebAssembly separately.

Supported input scope: deterministic weekly point forecasts, waiver baseline enabled, ordinary QB/RB/WR/TE/D/ST/K/FLEX slots, one-for-one searches, and no uncertainty scenarios or projection bounds. Other model configurations are explicitly rejected by the harness. The numeric replay harness has narrower scope than the production integration described below.

## Browser WebAssembly benchmark

The native executable and WASM module share `engine/trade-scorer/src/lib.rs`; `engine/trade-scorer/src/wasm.rs` adds a small buffer/load/score/clear ABI. There is no wasm-bindgen dependency or JavaScript callback inside the Rust scoring loop.

Install a Rust toolchain with the browser target, following the [Rust target documentation](https://doc.rust-lang.org/stable/rustc/platform-support/wasm32-unknown-unknown.html):

```sh
rustup target add wasm32-unknown-unknown
npm run benchmark:wasm -- data/trade-history/rust-benchmark/corpus.json 3
node benchmarks/rust-trades/wasm-smoke.mjs
```

If Rust came from Homebrew, its installation may only have the host target. Use a rustup-managed toolchain with the WASM target for the build; do not assume the Homebrew compiler has that target. The experiment used an isolated rustup installation in `/tmp/ff-wasm-toolchain`, without changing the shell's default compiler or PATH.

`browser.ts` starts a temporary HTTP server bound to 127.0.0.1 and launches Playwright Chromium. It serves the local corpus and compiled WASM module, and transpiles the current application scorer for the TypeScript comparison. It does not require Next.js, expose a production route, or write benchmark data into public assets. Separate module workers run the engines sequentially with identical prepared numeric inputs and parity checks. Worker messages report loading, progress, each timed run, completion, and errors. The page runs a 10 ms heartbeat throughout; workers terminate on completion, error, or timeout. The server and browser close at the end.

Browser results on the same machine and workload, Chromium 153.0.8010.12, three runs each:

| Measurement                                       |          TypeScript worker |        Rust WASM worker |
| ------------------------------------------------- | -------------------------: | ----------------------: |
| Scoring runs                                      | 17.972 / 17.934 / 17.870 s | 3.683 / 3.635 / 3.674 s |
| Median scoring time                               |                   17.934 s |                 3.674 s |
| Median wall time, including progress/yields       |                   18.318 s |                 4.034 s |
| Initialization, including local fetch and parsing |                    0.628 s |                 1.027 s |
| Main-thread heartbeat ticks across all runs/setup |                      5,553 |                   1,315 |

The browser scoring speedup was **4.88×**; including progress messages and cooperative yielding, the replay wall-time speedup was **4.54×**. The WASM module was 207,921 bytes (about 203 KiB). All 150,460 roster results and 2,106,440 weekly lineups matched in every run. Both workers' aggregate checksums matched as well. The output is saved locally to `data/trade-history/rust-benchmark/browser-report.json`.

The TypeScript browser scorer receives precomputed projections and specialist pools, as Rust does. Its timing therefore differs from the previous Node/full-search capture. These browser results are the useful comparison for choosing a browser scoring implementation. They remain an implementation benchmark: TypeScript still builds display metadata that the numeric Rust prototype omits.

The roughly 207 MB corpus includes all traced rosters and expected answers for validation. It is not the payload a production Rust engine would receive; a real engine would receive league/player forecasts and generate roster alternatives itself. Do not extrapolate the measured corpus fetch/parse time to production network overhead or call the 3.674 s replay a complete trade search.

## Recommendation

The production worker integration below follows this benchmark. A native server remains an option if slower client devices or shared-result caching justify its operational cost.

## Production integration and complete-search benchmark

`lib/trade-worker.ts` loads the checked-in `public/trade-scorer-v1.wasm` asset for deterministic weekly points searches with the waiver baseline enabled, ordinary QB/RB/WR/TE/D/ST/K/FLEX slots, no projection bounds, and the same horizon for both teams. Equal and unequal package sizes use the same accelerated evaluator. Other settings retain TypeScript. HTTP, module loading, or scoring failures also fall back to TypeScript. Cancellation terminates the worker, including during module loading.

The runtime model is prepared once per search. Calls pass compact roster indices through a reused memory buffer. Rust returns ordered lineup selections and numeric scores; TypeScript reconstructs the complete evaluation metadata. The source is in `engine/trade-scorer/src/runtime.rs` and `lib/trade-wasm.ts`. Normal Next.js builds require no Rust installation. After editing Rust, rebuild the shipped asset with:

```sh
rustup target add wasm32-unknown-unknown
npm run build:trade-scorer
```

Measure the complete search with the application's actual finder and runtime adapter in separate Chromium workers:

```sh
npm run benchmark:search -- /absolute/path/to/forecast-snapshot.json MY_TEAM_ID PARTNER_ID
```

The October 1 measured pairing (MECHANIC/Team 3, TonyTwoTimes/Team 1), weeks 4–17, 182 one-for-one packages, minimum gains 1, produced these complete-search timings, including scorer startup:

| Engine           |    Time |
| ---------------- | ------: |
| TypeScript       | 22.90 s |
| Rust WebAssembly |  8.00 s |

This single paired run was **2.86× faster**. The full returned search results matched, including baseline plans and lineup details, within a 1e-7 score tolerance and exact metadata equality. This pairing produced zero qualifying offers; unit and browser fixtures additionally verify positive offers and unequal trades. Results are machine/workload specific. The complete-search report is written to the ignored local `data/trade-history/rust-benchmark/search-report.json`.
