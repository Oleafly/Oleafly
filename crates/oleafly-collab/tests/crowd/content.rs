use crate::typist::{Rng, PHRASES, WORDS};

const TOPICS: &[&str] = &[
    "Introduction",
    "Related Work",
    "Background",
    "Method",
    "Experimental Setup",
    "Results",
    "Ablations",
    "Discussion",
    "Limitations",
    "Conclusion",
];

fn sentence(rng: &mut Rng) -> String {
    let mut words: Vec<String> = Vec::new();
    let length = rng.between(8, 18);
    for index in 0..length {
        if index % 6 == 3 && rng.chance(40) {
            words.push((*rng.pick(PHRASES)).to_owned());
        } else {
            words.push((*rng.pick(WORDS)).to_owned());
        }
    }
    let mut text = words.join(" ");
    if let Some(first) = text.get(..1) {
        let upper = first.to_uppercase();
        text.replace_range(..1, &upper);
    }
    if rng.chance(15) {
        text.push_str(&format!(" \\cite{{key{}}}", rng.below(12)));
    }
    if rng.chance(10) {
        text.push_str(&format!(
            " with $x_{} \\le {}$",
            rng.below(9),
            rng.below(100)
        ));
    }
    text.push('.');
    text
}

fn paragraph(rng: &mut Rng) -> String {
    let count = rng.between(3, 7);
    (0..count)
        .map(|_| sentence(rng))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn latex_main(target_bytes: usize, rng: &mut Rng) -> String {
    let mut text = String::from(
        "\\documentclass[11pt]{article}\n\\usepackage{amsmath,amssymb}\n\\usepackage{graphicx}\n\\usepackage[hidelinks]{hyperref}\n\n\\title{Crowd Test Paper}\n\\author{Smith Lab}\n\n\\begin{document}\n\\maketitle\n\n\\begin{abstract}\n",
    );
    text.push_str(&paragraph(rng));
    text.push_str("\n\\end{abstract}\n\n");
    let mut section = 0usize;
    while text.len() < target_bytes {
        let topic = TOPICS[section % TOPICS.len()];
        let round = section / TOPICS.len();
        if round == 0 {
            text.push_str(&format!(
                "\\section{{{topic}}}\n\\label{{sec:{section}}}\n\n"
            ));
        } else {
            text.push_str(&format!(
                "\\section{{{topic} {}}}\n\\label{{sec:{section}}}\n\n",
                round + 1
            ));
        }
        for block in 0..rng.between(3, 6) {
            text.push_str(&paragraph(rng));
            text.push_str("\n\n");
            if block == 1 && rng.chance(35) {
                text.push_str(&format!(
                    "\\begin{{equation}}\n  f(x_{{{0}}}) = \\sum_{{i=1}}^{{n}} w_i x_i^{{{0}}} + b\n\\end{{equation}}\n\n",
                    rng.below(5) + 1
                ));
            }
            if block == 2 && rng.chance(25) {
                text.push_str("\\begin{itemize}\n");
                for _ in 0..rng.between(2, 4) {
                    text.push_str(&format!("  \\item {}\n", sentence(rng)));
                }
                text.push_str("\\end{itemize}\n\n");
            }
        }
        section += 1;
    }
    text.push_str("\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n");
    text
}

pub fn bibliography(rng: &mut Rng) -> String {
    let mut text = String::new();
    for key in 0..12 {
        text.push_str(&format!(
            "@article{{key{key},\n  title = {{{}}},\n  author = {{Lee, Dana and Park, Evan}},\n  journal = {{Journal of {}}},\n  year = {{{}}},\n  volume = {{{}}},\n  pages = {{{}--{}}}\n}}\n\n",
            sentence(rng).trim_end_matches('.'),
            rng.pick(WORDS),
            2000 + rng.below(26),
            rng.below(40) + 1,
            rng.below(300) + 1,
            rng.below(300) + 301
        ));
    }
    text
}

pub fn typst_notes(rng: &mut Rng) -> String {
    let mut text =
        String::from("#set page(paper: \"a4\")\n#set text(size: 11pt)\n\n= Meeting notes\n\n");
    for topic in ["Agenda", "Decisions", "Open questions"] {
        text.push_str(&format!("== {topic}\n\n"));
        for _ in 0..rng.between(3, 5) {
            text.push_str(&format!("- {}\n", sentence(rng)));
        }
        text.push('\n');
    }
    text
}

pub fn readme(rng: &mut Rng) -> String {
    let mut text = String::from("# Crowd test project\n\n");
    text.push_str(&paragraph(rng));
    text.push_str("\n\n## Build\n\n```sh\nlatexmk -pdf main.tex\n```\n\n## Notes\n\n");
    for _ in 0..4 {
        text.push_str(&format!("- {}\n", sentence(rng)));
    }
    text
}

pub fn small_section(index: usize, rng: &mut Rng) -> String {
    format!(
        "\\subsection{{Part {index}}}\n\\label{{part:{index}}}\n\n{}\n",
        paragraph(rng)
    )
}
