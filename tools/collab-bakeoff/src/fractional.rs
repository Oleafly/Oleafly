const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
const BASE: u8 = 36;

fn value_of(byte: u8) -> u8 {
    DIGITS
        .iter()
        .position(|digit| *digit == byte)
        .map_or(0, |index| index as u8)
}

pub fn between(low: &str, high: Option<&str>) -> String {
    let low: Vec<u8> = low.bytes().map(value_of).collect();
    let high: Option<Vec<u8>> = high.map(|text| text.bytes().map(value_of).collect());
    midpoint(&low, high.as_deref())
        .into_iter()
        .map(|digit| DIGITS[usize::from(digit)] as char)
        .collect()
}

pub fn after(last: &str) -> String {
    between(last, None)
}

fn midpoint(low: &[u8], high: Option<&[u8]>) -> Vec<u8> {
    if let Some(high) = high {
        let mut shared = 0;
        while shared < high.len() && low.get(shared).copied().unwrap_or(0) == high[shared] {
            shared += 1;
        }
        if shared > 0 {
            let mut result = high[..shared].to_vec();
            let rest = low.get(shared..).unwrap_or(&[]);
            result.extend(midpoint(rest, Some(&high[shared..])));
            return result;
        }
    }
    let low_digit = low.first().copied().unwrap_or(0);
    let high_digit = high
        .and_then(|digits| digits.first().copied())
        .unwrap_or(BASE);
    if high_digit.saturating_sub(low_digit) > 1 {
        return vec![low_digit.midpoint(high_digit)];
    }
    if let Some(high) = high {
        if high.len() > 1 {
            return vec![high[0]];
        }
    }
    let mut result = vec![low_digit];
    result.extend(midpoint(low.get(1..).unwrap_or(&[]), None));
    result
}
