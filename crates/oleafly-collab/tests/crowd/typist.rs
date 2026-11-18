#![allow(dead_code)]

use oleafly_ot::testing::Rng;

pub const NAMES: &[&str] = &[
    "Bob Smith",
    "Dana Lee",
    "Evan Park",
    "Farah Khan",
    "Gabriel Silva",
    "Hana Sato",
    "Ivan Petrov",
    "Jamal Wright",
    "Keiko Tanaka",
    "Liam Murphy",
    "Maya Patel",
    "Noah Fischer",
    "Olivia Rossi",
    "Pablo Garcia",
    "Quinn Taylor",
    "Rosa Martinez",
    "Samir Haddad",
    "Tara Singh",
    "Umar Farouk",
    "Vera Novak",
    "Wei Zhang",
    "Ximena Lopez",
    "Yusuf Demir",
    "Zoe Clarke",
    "Aiden Brooks",
    "Bianca Costa",
    "Chen Wu",
    "Diego Ramos",
    "Elena Ivanova",
    "Felix Wagner",
    "Grace Kim",
    "Hugo Laurent",
    "Isla Grant",
    "Jonas Berg",
    "Kavya Rao",
    "Lucas Moreau",
    "Mina Choi",
    "Nadia Hassan",
    "Oscar Lindqvist",
    "Priya Nair",
    "Rafael Souza",
    "Sofia Greco",
    "Tomas Novotny",
    "Uma Iyer",
    "Viktor Horvath",
    "Wren Okafor",
    "Yara Haddad",
    "Zain Malik",
    "Amara Obi",
    "Bruno Keller",
    "Clara Jensen",
    "Dmitri Volkov",
    "Esther Cohen",
    "Fiona Walsh",
    "Goran Petrovic",
    "Helen Zhou",
    "Ines Duarte",
    "Jun Ito",
    "Kofi Mensah",
    "Leila Ahmadi",
    "Mateo Herrera",
    "Nina Kowalski",
];

pub const WORDS: &[&str] = &[
    "model",
    "results",
    "data",
    "method",
    "analysis",
    "sample",
    "error",
    "bound",
    "theorem",
    "proof",
    "lemma",
    "baseline",
    "variance",
    "estimate",
    "network",
    "signal",
    "protocol",
    "latency",
    "throughput",
    "dataset",
    "figure",
    "table",
    "section",
    "appendix",
    "parameter",
    "gradient",
    "kernel",
    "cluster",
    "sensor",
    "trial",
    "cohort",
    "measure",
    "effect",
    "regime",
    "boundary",
    "solver",
    "matrix",
    "vector",
    "graph",
    "cache",
    "replica",
    "server",
    "client",
];

pub const PHRASES: &[&str] = &[
    "as shown in the previous section",
    "we observe that",
    "the results suggest a clear trend",
    "in contrast to prior work",
    "under mild assumptions",
    "see Table 2 for details",
    "this holds for every sample",
    "with high probability",
    "the error stays below one percent",
    "we leave this to future work",
    "following the standard setup",
    "the baseline fails here",
    "a simple argument shows",
    "on all three datasets",
    "as expected",
    "which matches the theory",
    "after a short warm-up",
    "for a fixed budget",
];

pub const SPICE: &[&str] = &["é", "ü", "π", "→", "≤", "😀", "Ω", "ß", "∑"];

pub fn phrase(rng: &mut Rng) -> String {
    let mut text = match rng.below(10) {
        0..=4 => format!("{} ", rng.pick(WORDS)),
        5..=8 => format!("{} ", rng.pick(PHRASES)),
        _ => format!("{} {} ", rng.pick(WORDS), rng.pick(SPICE)),
    };
    if rng.chance(8) {
        text.insert(0, '\n');
    }
    text
}

pub fn keystroke(rng: &mut Rng) -> String {
    if rng.chance(3) {
        return (*rng.pick(SPICE)).to_owned();
    }
    let letters = b"etaoinshrdlucmfwypvbgk  ";
    let letter = letters[rng.below(letters.len())];
    char::from(letter).to_string()
}
