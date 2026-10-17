use std::path::PathBuf;
use std::slice::Iter;
use std::str::FromStr;

use crate::matrix::EngineKind;
use crate::trace::{MonthsConfig, Scale};

pub const DEFAULT_SEED: u64 = 20_261_011;

pub const USAGE: &str = "usage: collab-bakeoff [--out DIR] [--seed N] [--scale small|full] \
[--engines loro,yrs,automerge] [--only NAME] [--days N] [--edits-per-day N] \
[--decision FILE] [--skip-measurements]";

#[derive(Clone, Debug, PartialEq)]
pub struct Options {
    pub out: PathBuf,
    pub seed: u64,
    pub scale: Scale,
    pub engines: Vec<EngineKind>,
    pub decision: Option<PathBuf>,
    pub months: MonthsConfig,
    pub only: Option<String>,
    pub skip_measurements: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            out: PathBuf::from("tools/collab-bakeoff/target/bakeoff"),
            seed: DEFAULT_SEED,
            scale: Scale::Full,
            engines: EngineKind::ALL.to_vec(),
            decision: None,
            months: MonthsConfig::six_months(),
            only: None,
            skip_measurements: false,
        }
    }
}

fn value(rest: &mut Iter<'_, String>, flag: &str) -> Result<String, String> {
    rest.next()
        .cloned()
        .ok_or_else(|| format!("{flag} needs a value"))
}

fn number<T: FromStr>(text: &str, flag: &str) -> Result<T, String> {
    text.parse()
        .map_err(|_| format!("{flag} needs a number, got {text}"))
}

fn scale(text: &str) -> Result<Scale, String> {
    match text {
        "small" => Ok(Scale::Small),
        "full" => Ok(Scale::Full),
        other => Err(format!("unknown scale {other}")),
    }
}

fn engines(text: &str) -> Result<Vec<EngineKind>, String> {
    text.split(',')
        .map(|name| EngineKind::parse(name.trim()).ok_or_else(|| format!("unknown engine {name}")))
        .collect()
}

pub fn parse(args: &[String]) -> Result<Options, String> {
    let mut options = Options::default();
    let mut rest = args.iter();
    while let Some(flag) = rest.next() {
        match flag.as_str() {
            "--out" => options.out = PathBuf::from(value(&mut rest, flag)?),
            "--seed" => options.seed = number(&value(&mut rest, flag)?, flag)?,
            "--scale" => options.scale = scale(&value(&mut rest, flag)?)?,
            "--engines" => options.engines = engines(&value(&mut rest, flag)?)?,
            "--only" => options.only = Some(value(&mut rest, flag)?),
            "--days" => options.months.days = number(&value(&mut rest, flag)?, flag)?,
            "--edits-per-day" => {
                options.months.edits_per_day = number(&value(&mut rest, flag)?, flag)?
            }
            "--decision" => options.decision = Some(PathBuf::from(value(&mut rest, flag)?)),
            "--skip-measurements" => options.skip_measurements = true,
            other => return Err(format!("unknown argument {other}\n{USAGE}")),
        }
    }
    Ok(options)
}
