const MS_PER_HOUR: i64 = 3_600_000;
const MS_PER_DAY: i64 = 24 * MS_PER_HOUR;

fn deepseek_peak(unix_ms: i64) -> bool {
    let weekday = (unix_ms.div_euclid(MS_PER_DAY) + 3).rem_euclid(7);
    let hour = unix_ms.rem_euclid(MS_PER_DAY) / MS_PER_HOUR;
    weekday < 5 && ((1..4).contains(&hour) || (6..10).contains(&hour))
}

pub fn has_peak_hours(provider_id: &str) -> bool {
    provider_id == "deepseek"
}

pub fn peak_hours_multiplier(unix_ms: i64) -> f64 {
    if deepseek_peak(unix_ms) {
        2.0
    } else {
        1.0
    }
}

pub fn peak_price_multiplier(provider_id: &str, unix_ms: i64) -> f64 {
    if has_peak_hours(provider_id) {
        peak_hours_multiplier(unix_ms)
    } else {
        1.0
    }
}

pub fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepseek_doubles_on_weekday_peak_hours_in_utc() {
        for (unix_ms, multiplier) in [
            (1_792_981_800_000, 2.0),
            (1_792_976_399_000, 1.0),
            (1_792_976_400_000, 2.0),
            (1_792_987_200_000, 1.0),
            (1_792_994_399_000, 1.0),
            (1_792_994_400_000, 2.0),
            (1_793_008_799_000, 2.0),
            (1_793_008_800_000, 1.0),
            (1_793_340_000_000, 2.0),
            (1_793_412_000_000, 1.0),
            (1_793_516_400_000, 1.0),
        ] {
            assert_eq!(
                peak_price_multiplier("deepseek", unix_ms),
                multiplier,
                "{unix_ms}"
            );
        }
    }

    #[test]
    fn other_providers_keep_their_listed_price_at_deepseek_peak() {
        assert_eq!(peak_price_multiplier("openai", 1_792_981_800_000), 1.0);
        assert_eq!(peak_price_multiplier("openrouter", 1_792_981_800_000), 1.0);
    }

    #[test]
    fn the_clock_reads_after_the_epoch() {
        assert!(now_unix_ms() > 1_792_000_000_000);
    }
}
