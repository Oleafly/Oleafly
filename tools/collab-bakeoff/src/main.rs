use std::fs;
use std::process::ExitCode;

use collab_bakeoff::cli::{self, Options};
use collab_bakeoff::heap::CountingAlloc;
use collab_bakeoff::matrix;
use collab_bakeoff::measure::{self, MeasureConfig};
use collab_bakeoff::report::{self, Report};
use collab_bakeoff::scenarios;

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let options = match cli::parse(&args) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    match run(&options) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run(options: &Options) -> Result<(), String> {
    std::panic::set_hook(Box::new(|_| {}));
    let corpus: Vec<_> = scenarios::corpus(options.scale, options.seed)
        .into_iter()
        .filter(|scenario| {
            options
                .only
                .as_ref()
                .is_none_or(|only| scenario.name.contains(only.as_str()))
        })
        .collect();
    let mut outcomes = Vec::new();
    for scenario in &corpus {
        for engine in &options.engines {
            eprintln!("scenario {} on {}", scenario.name, engine.name());
            outcomes.push(matrix::run_scenario(*engine, scenario));
        }
    }
    let mut measurements = Vec::new();
    if !options.skip_measurements {
        let config = MeasureConfig::for_scale(options.scale, options.seed, options.months);
        for engine in &options.engines {
            eprintln!("measuring {}", engine.name());
            measurements.push(measure::measure_kind(*engine, &config));
        }
    }
    let report = Report {
        versions: report::versions(),
        seed: options.seed,
        scale: options.scale,
        platform: report::platform(),
        engines: options.engines.clone(),
        matrix: outcomes,
        measurements,
    };
    fs::create_dir_all(&options.out)
        .map_err(|error| format!("create {}: {error}", options.out.display()))?;
    let json = report::to_json(&report).map_err(|error| format!("encode the report: {error}"))?;
    let json_path = options.out.join("report.json");
    fs::write(&json_path, json)
        .map_err(|error| format!("write {}: {error}", json_path.display()))?;
    let markdown = report::to_markdown(&report);
    let markdown_path = options.out.join("report.md");
    fs::write(&markdown_path, &markdown)
        .map_err(|error| format!("write {}: {error}", markdown_path.display()))?;
    if let Some(path) = &options.decision {
        let current = fs::read_to_string(path)
            .map_err(|error| format!("read {}: {error}", path.display()))?;
        fs::write(path, report::splice_results(&current, &markdown))
            .map_err(|error| format!("write {}: {error}", path.display()))?;
    }
    println!("{markdown}");
    Ok(())
}
