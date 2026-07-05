use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

use crate::paths;

const DEFAULT_MAIN_TEX: &str = "\\documentclass[11pt]{article}\n\
\\usepackage[T1]{fontenc}\n\
\\usepackage{hyperref}\n\
\n\
\\title{Untitled}\n\
\\author{}\n\
\n\
\\begin{document}\n\
\\maketitle\n\
\n\
\\section{Introduction}\n\
Write your \\LaTeX{} here.\n\
\n\
\\end{document}\n";

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct ProjectMeta {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_main_doc")]
    pub main_doc: String,
    #[serde(default = "default_engine")]
    pub engine: String,
    #[serde(default)]
    pub exports: Vec<ExportRecord>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct ExportRecord {
    pub date: f64,
    pub filename: String,
    pub path: String,
}

fn default_main_doc() -> String {
    "main.tex".to_string()
}
fn default_engine() -> String {
    "xetex".to_string()
}

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub main_doc: String,
    pub updated_at: f64,
}

/// Resolve a project-relative path, rejecting traversal escapes.
fn resolve(project_id: &str, rel: &str) -> Result<PathBuf, String> {
    let root = paths::project_dir(project_id)?;
    resolve_within(&root, rel)
}

/// Public resolver for other modules (e.g. compile/export) so a user-supplied
/// `main_doc` can't escape the project via an absolute path or `..`.
pub fn resolve_in_project(project_id: &str, rel: &str) -> Result<PathBuf, String> {
    resolve(project_id, rel)
}

/// Join `rel` onto `root`, rejecting anything that would escape `root`.
///
/// Guards against three escape vectors:
///   1. Absolute paths (`/etc/passwd`) - `Path::join` would discard `root`.
///   2. `..` traversal and drive prefixes (`C:\`).
///   3. Symlinks inside the project pointing outside - the resolved real path
///      (or its nearest existing ancestor, for not-yet-created files) must stay
///      within `root`.
fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("illegal path: {rel}"));
    }
    if rel_path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!("illegal path: {rel}"));
    }
    let joined = root.join(rel_path);
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    if let Some(anchor) = nearest_existing(&joined) {
        let real = anchor.canonicalize().map_err(|e| e.to_string())?;
        if !real.starts_with(&real_root) {
            return Err(format!("illegal path: {rel}"));
        }
    }
    Ok(joined)
}

/// The deepest ancestor of `path` (including itself) that exists on disk.
fn nearest_existing(path: &Path) -> Option<PathBuf> {
    let mut cur = Some(path);
    while let Some(p) = cur {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        cur = p.parent();
    }
    None
}

fn meta_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(paths::project_dir(project_id)?.join("project.json"))
}

pub fn read_meta(project_id: &str) -> Result<ProjectMeta, String> {
    let p = meta_path(project_id)?;
    if !p.exists() {
        return Ok(ProjectMeta {
            name: project_id.to_string(),
            main_doc: default_main_doc(),
            engine: default_engine(),
            exports: Vec::new(),
        });
    }
    let s = std::fs::read_to_string(&p).map_err(|e| format!("failed to read project.json: {e}"))?;
    let mut meta: ProjectMeta =
        serde_json::from_str(&s).map_err(|e| format!("invalid project.json: {e}"))?;
    if meta.main_doc.is_empty() {
        meta.main_doc = default_main_doc();
    }
    if meta.engine.is_empty() {
        meta.engine = default_engine();
    }
    Ok(meta)
}

pub fn write_meta(project_id: &str, meta: &ProjectMeta) -> Result<(), String> {
    let p = meta_path(project_id)?;
    let s = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(&p, s).map_err(|e| format!("failed to write project.json: {e}"))
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<FileEntry>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut items: Vec<_> = entries
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    items.sort_by_key(|e| e.file_name());
    for entry in items {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".openleaf" || name_str == ".localleaf" || name_str == ".git" {
            continue;
        }
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap_or(&path);
        out.push(FileEntry {
            path: rel.to_string_lossy().into_owned(),
            is_dir: path.is_dir(),
        });
        if path.is_dir() {
            walk(root, &path, out)?;
        }
    }
    Ok(())
}

// --- Tauri commands ---

#[tauri::command]
pub fn list_files(project_id: String) -> Result<Vec<FileEntry>, String> {
    let root = paths::project_dir(&project_id)?;
    let mut out = Vec::new();
    walk(&root, &root, &mut out)?;
    Ok(out)
}

#[tauri::command]
pub fn read_file(project_id: String, path: String) -> Result<String, String> {
    let p = resolve(&project_id, &path)?;
    std::fs::read_to_string(&p).map_err(|e| format!("failed to read {path}: {e}"))
}

#[tauri::command]
pub fn write_file(project_id: String, path: String, content: String) -> Result<(), String> {
    let p = resolve(&project_id, &path)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, content).map_err(|e| format!("failed to write {path}: {e}"))
}

#[tauri::command]
pub fn create_file(project_id: String, path: String, is_dir: bool) -> Result<(), String> {
    let p = resolve(&project_id, &path)?;
    if is_dir {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if p.exists() {
            return Err(format!("{path} already exists"));
        }
        std::fs::write(&p, "").map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_file(project_id: String, path: String) -> Result<(), String> {
    if path.is_empty() || path == "." {
        return Err("refusing to delete project root".into());
    }
    let p = resolve(&project_id, &path)?;
    if p.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    }
    .map_err(|e| format!("failed to delete {path}: {e}"))
}

#[tauri::command]
pub fn rename_file(project_id: String, from: String, to: String) -> Result<(), String> {
    let src = resolve(&project_id, &from)?;
    let dst = resolve(&project_id, &to)?;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("rename failed: {e}"))
}

/// Byte-level copy of a file within a project (handles binary files like PDFs).
#[tauri::command]
pub fn copy_file(project_id: String, from: String, to: String) -> Result<(), String> {
    let src = resolve(&project_id, &from)?;
    let dst = resolve(&project_id, &to)?;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dst).map_err(|e| format!("copy failed: {e}"))?;
    Ok(())
}

/// Write base64-encoded bytes to a project file (used to save a compiled PDF
/// into the project tree).
#[tauri::command]
pub fn save_file_base64(project_id: String, path: String, data: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let p = resolve(&project_id, &path)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = STANDARD
        .decode(data.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    std::fs::write(&p, bytes).map_err(|e| format!("failed to write {path}: {e}"))
}

/// Read a project file as base64 (for rendering binary files like PDFs).
#[tauri::command]
pub fn read_file_base64(project_id: String, path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let p = resolve(&project_id, &path)?;
    let bytes = std::fs::read(&p).map_err(|e| format!("failed to read {path}: {e}"))?;
    Ok(STANDARD.encode(&bytes))
}

/// Append a line to the global app log at `~/.openleaf/app.log` (append-only,
/// created if missing). Used by the frontend to record caught errors so users
/// can share the file for debugging.
#[tauri::command]
pub fn append_app_log(message: String) -> Result<(), String> {
    use std::io::Write;
    let log_path = paths::openleaf_root()?.join("app.log");
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("failed to open app log: {e}"))?;
    writeln!(file, "[{secs}] {message}").map_err(|e| format!("failed to write app log: {e}"))
}

#[tauri::command]
pub fn set_main_doc(project_id: String, main_doc: String) -> Result<ProjectMeta, String> {
    let mut meta = read_meta(&project_id)?;
    meta.main_doc = main_doc;
    write_meta(&project_id, &meta)?;
    Ok(meta)
}

#[tauri::command]
pub fn get_project(project_id: String) -> Result<ProjectMeta, String> {
    read_meta(&project_id)
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let root = paths::projects_root()?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let meta = read_meta(&id).unwrap_or_default();
        let updated_at = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        out.push(ProjectInfo {
            name: if meta.name.is_empty() {
                id.clone()
            } else {
                meta.name
            },
            main_doc: meta.main_doc,
            id,
            updated_at,
        });
    }
    out.sort_by(|a, b| {
        b.updated_at
            .partial_cmp(&a.updated_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

#[tauri::command]
pub fn create_project(name: String) -> Result<String, String> {
    let root = paths::projects_root()?;
    // unique id: a random meaningful hyphenated slug
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("main.tex"), DEFAULT_MAIN_TEX).map_err(|e| e.to_string())?;
    write_meta(
        &id,
        &ProjectMeta {
            name,
            main_doc: default_main_doc(),
            engine: default_engine(),
            exports: Vec::new(),
        },
    )?;
    Ok(id)
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else if c == ' ' || c == '-' || c == '_' {
                '-'
            } else {
                '\0'
            }
        })
        .filter(|c| *c != '\0')
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

// Random, human-meaningful project ids like "flying-pink-pikachu".
const ADJECTIVES: &[&str] = &[
    "flying", "swift", "cosmic", "velvet", "silent", "crimson", "lucky", "hidden", "mellow",
    "quantum", "amber", "frosty", "jolly", "nimble", "rosy", "sunny", "tidy", "vivid", "witty",
    "brave",
];
const COLORS: &[&str] = &[
    "pink", "azure", "emerald", "indigo", "maroon", "olive", "teal", "violet", "cyan", "coral",
    "lavender", "ruby", "slate", "gold", "mint",
];
const ANIMALS: &[&str] = &[
    "pikachu", "falcon", "otter", "panda", "lynx", "koala", "heron", "narwhal", "panther", "raven",
    "sable", "tiger", "viper", "wallaby", "yak", "zebu", "fox", "wolf", "crane", "moth",
];

fn pick<'a>(list: &'a [&'a str], seed: &mut u64) -> &'a str {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    list[((*seed >> 33) as usize) % list.len()]
}

/// Generate a unique random slug under `root`, retrying until it doesn't exist.
fn unique_random_slug(root: &Path) -> Result<String, String> {
    for _ in 0..32 {
        let mut seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        // burn a couple of rounds so the time-seed doesn't bias the first pick
        pick(ADJECTIVES, &mut seed);
        pick(COLORS, &mut seed);
        let candidate = format!(
            "{}-{}-{}",
            pick(ADJECTIVES, &mut seed),
            pick(COLORS, &mut seed),
            pick(ANIMALS, &mut seed)
        );
        if !root.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    // Extremely unlikely fallback.
    Ok(slugify(&format!(
        "project-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
    )))
}

// --- Templates ---

/// A starter template: a map of relative path -> file content.
pub type Template = &'static [(&'static str, &'static str)];

const BLANK_TEMPLATE: Template = &[("main.tex", DEFAULT_MAIN_TEX)];

const ATS_RESUME_TEMPLATE: Template = &[(
    "main.tex",
    "\\documentclass[11pt,letterpaper]{article}\n\
\\usepackage[T1]{fontenc}\n\
\\usepackage[margin=0.6in]{geometry}\n\
\\usepackage{titlesec}\n\
\\usepackage{enumitem}\n\
\\usepackage{hyperref}\n\
\n\
% ATS-friendly: single column, no tables-for-layout, real selectable text,\n\
% embedded subset fonts. Avoid \\tabular for layout; keep a linear reading order.\n\
\\setlength{\\parindent}{0pt}\n\
\\pagenumbering{gobble}\n\
\\titleformat{\\section}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]\n\
\\titlespacing*{\\section}{0pt}{10pt}{4pt}\n\
\\setlist[itemize]{leftmargin=12pt,itemsep=1pt,topsep=2pt}\n\
\n\
\\begin{document}\n\
\n\
% ===== Header =====\n\
\\begin{center}\n\
  {\\Huge \\textbf{Jane Doe}}\\\\[3pt]\n\
  \\small\n\
  \\href{mailto:jane.doe@email.com}{jane.doe@email.com} $\\cdot$\n\
  (555) 123-4567 $\\cdot$\n\
  San Francisco, CA $\\cdot$\n\
  \\href{https://linkedin.com/in/janedoe}{linkedin.com/in/janedoe} $\\cdot$\n\
  \\href{https://github.com/janedoe}{github.com/janedoe}\n\
\\end{center}\n\
\n\
% ===== Summary =====\n\
\\section*{Summary}\n\
Senior Software Engineer with 6+ years building scalable distributed systems\n\
and shipping high-impact products end-to-end.\n\
\n\
% ===== Experience =====\n\
\\section*{Experience}\n\
\\textbf{Senior Software Engineer} \\hfill \\textbf{Acme Corp} \\\\\n\
\\textit{San Francisco, CA} \\hfill \\textit{Jan 2022 -- Present}\n\
\\begin{itemize}\n\
  \\item Led migration of a monolith to microservices, reducing p99 latency by 40\\%.\n\
  \\item Designed a multi-tenant data pipeline processing 5B events/day.\n\
  \\item Mentored 4 engineers and established the team's code-review culture.\n\
\\end{itemize}\n\
\\vspace{4pt}\n\
\\textbf{Software Engineer} \\hfill \\textbf{Startup Inc} \\\\\n\
\\textit{Remote} \\hfill \\textit{Jun 2019 -- Dec 2021}\n\
\\begin{itemize}\n\
  \\item Built the core payments service handling \\$20M/yr in transactions.\n\
  \\item Cut infrastructure cost 30\\% by right-sizing autoscaling groups.\n\
\\end{itemize}\n\
\n\
% ===== Education =====\n\
\\section*{Education}\n\
\\textbf{B.S. Computer Science} \\hfill \\textbf{State University} \\\\\n\
\\textit{2015 -- 2019}\n\
\n\
% ===== Skills =====\n\
\\section*{Skills}\n\
\\textbf{Languages:} Python, Go, Rust, TypeScript \\\\\n\
\\textbf{Infrastructure:} Kubernetes, AWS, Terraform, PostgreSQL, Kafka\n\
\n\
\\end{document}\n",
)];

const ONE_PAGE_RESUME_TEMPLATE: Template = &[(
    "main.tex",
    r#"\documentclass[11pt,letterpaper]{article}
\usepackage[T1]{fontenc}
\usepackage[margin=0.5in]{geometry}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{hyperref}

% ATS-friendly: single column, real selectable text, no tables-for-layout,
% embedded subset fonts. Linear reading order so parsers extract cleanly.
\setlength{\parindent}{0pt}
\pagenumbering{gobble}
\hypersetup{colorlinks=true, urlcolor=black, linkcolor=black}

\titleformat{\section}{\large\bfseries\uppercase}{}{0em}{}[\vspace{2pt}\titlerule]
\titlespacing*{\section}{0pt}{8pt}{4pt}
\setlist[itemize]{leftmargin=14pt, itemsep=1pt, topsep=2pt, parsep=0pt}

% role{Title}{Company}{Location}{Dates}
\newcommand{\role}[4]{%
  \textbf{#1} \hfill #2 \\
  \textit{#3} \hfill \textit{#4}%
}

\begin{document}

\begin{center}
  {\Huge \textbf{Alex Chen}}\\[3pt]
  \small
  Senior Software Engineer\\[2pt]
  \href{mailto:alex.chen@gmail.com}{alex.chen@gmail.com}\,$\cdot$\,
  (650) 555-0142\,$\cdot$\,
  Mountain View, CA\,$\cdot$\,
  \href{https://alexchen.dev}{alexchen.dev}\,$\cdot$\,
  \href{https://github.com/alexchen}{github.com/alexchen}\,$\cdot$\,
  \href{https://linkedin.com/in/alexchen}{linkedin.com/in/alexchen}
\end{center}
\vspace{2pt}

\section*{Summary}
Senior Software Engineer (L5) with 9+ years designing and operating large-scale
distributed systems. Deep experience in backend infrastructure, performance, and
reliability, with a track record of shipping products used by hundreds of
millions of users and mentoring engineers toward senior roles.

\section*{Experience}
\role{Senior Software Engineer (L5)}{Google}{Mountain View, CA}{Mar 2020 -- Present}
\begin{itemize}
  \item Tech lead for a Search serving component handling 2M+ queries/second; drove a redesign that cut p99 latency 38\% and saved an estimated \$14M/year in compute.
  \item Designed and launched a globally-replicated feature store on Spanner backing 40+ ML models, adopted by 12 teams across Search and Ads.
  \item Led migration of a 300-service fleet to a new RPC framework, improving tail latency and reducing on-call pages by 45\%.
  \item Mentored 6 engineers (2 promoted to senior); ran the team's design-review and readability programs.
\end{itemize}
\vspace{3pt}
\role{Software Engineer (L4)}{Google}{Mountain View, CA}{Jul 2017 -- Mar 2020}
\begin{itemize}
  \item Built a real-time aggregation pipeline (C++, Flume) processing 8B events/day for a Search-quality dashboard used org-wide.
  \item Cut batch-job cost 30\% by reworking sharding and introducing incremental recomputation.
\end{itemize}
\vspace{3pt}
\role{Software Engineer}{Stripe}{San Francisco, CA}{Aug 2015 -- Jun 2017}
\begin{itemize}
  \item Shipped core ledger and reconciliation services for a payments platform processing \$60B+/year.
  \item Reduced a reconciliation run from 6 hours to 25 minutes via parallelization and a columnar store.
\end{itemize}

\section*{Selected Projects}
\textbf{Ratel} \hfill \href{https://github.com/alexchen/ratel}{github.com/alexchen/ratel} \\
\textit{Go, Raft, gRPC} --- open-source distributed rate limiter doing 4M+ decisions/sec/node; 1.5k GitHub stars.\par\vspace{4pt}
\textbf{tql} \hfill \href{https://github.com/alexchen/tql}{github.com/alexchen/tql} \\
\textit{Rust} --- a typed query builder for Postgres with compile-time-checked SQL.

\section*{Education}
\textbf{M.S. Computer Science} \hfill Stanford University \\
\textit{2013 -- 2015} \hfill \textit{Focus: Distributed Systems}\par\vspace{4pt}
\textbf{B.S. Computer Science} \hfill University of Illinois Urbana-Champaign \\
\textit{2009 -- 2013} \hfill \textit{GPA: 3.9 / 4.0}

\section*{Skills}
\textbf{Languages:} C++, Go, Rust, Python, Java, SQL \\
\textbf{Systems:} Spanner, Bigtable, Kubernetes, Kafka, gRPC / Protobuf, Redis \\
\textbf{Focus:} Distributed systems, performance, reliability (SLOs), system design, mentoring

\end{document}
"#,
)];

const IEEE_TEMPLATE: Template = &[
    (
        "main.tex",
        r#"\documentclass[conference]{IEEEtran}
\IEEEoverridecommandlockouts
\usepackage{cite}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{multirow}
\usepackage{textcomp}
\usepackage{xcolor}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning,fit,backgrounds}
\usepackage{hyperref}

\begin{document}

\title{Attention Is All You Need}

\author{%
\IEEEauthorblockN{Ashish Vaswani\thanks{Equal contribution. Listing order is random.}\quad Noam Shazeer\footnotemark[1]\quad Niki Parmar\footnotemark[1]\quad Jakob Uszkoreit\footnotemark[1]}
\IEEEauthorblockA{\textit{Google Brain / Google Research} \\
\{avaswani, noam, nikip, usz\}@google.com}
\and
\IEEEauthorblockN{Llion Jones\footnotemark[1]\quad Aidan N. Gomez\footnotemark[1]\quad {\L}ukasz Kaiser\footnotemark[1]\quad Illia Polosukhin\footnotemark[1]}
\IEEEauthorblockA{\textit{Google Research / University of Toronto} \\
llion@google.com,\ aidan@cs.toronto.edu}
}

\maketitle

\begin{abstract}
The dominant sequence transduction models are based on complex recurrent or
convolutional neural networks that include an encoder and a decoder. The best
performing models also connect the encoder and decoder through an attention
mechanism. We propose a new simple network architecture, the Transformer, based
solely on attention mechanisms, dispensing with recurrence and convolutions
entirely. Experiments on two machine translation tasks show these models to be
superior in quality while being more parallelizable and requiring significantly
less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German
translation task, improving over the existing best results, including ensembles,
by over 2 BLEU. On the WMT 2014 English-to-French translation task, our model
establishes a new single-model state-of-the-art BLEU score of 41.8 after training
for 3.5 days on eight GPUs, a small fraction of the training costs of the best
models from the literature.
\end{abstract}

\begin{IEEEkeywords}
attention, self-attention, sequence transduction, neural machine translation, Transformer
\end{IEEEkeywords}

\section{Introduction}
Recurrent neural networks, long short-term memory~\cite{hochreiter1997} and gated
recurrent~\cite{cho2014} neural networks in particular, have been firmly
established as state-of-the-art approaches in sequence modeling and transduction
problems such as language modeling and machine translation. Recurrent models
typically factor computation along the symbol positions of the input and output
sequences. Aligning the positions to steps in computation time, they generate a
sequence of hidden states $h_t$, as a function of the previous hidden state
$h_{t-1}$ and the input for position $t$. This inherently sequential nature
precludes parallelization within training examples, which becomes critical at
longer sequence lengths, as memory constraints limit batching across examples.

Attention mechanisms have become an integral part of compelling sequence modeling
and transduction models, allowing modeling of dependencies without regard to
their distance in the input or output sequences~\cite{bahdanau2015}. In this work
we propose the Transformer, a model architecture eschewing recurrence and instead
relying entirely on an attention mechanism to draw global dependencies between
input and output. The Transformer allows for significantly more parallelization
and can reach a new state of the art in translation quality after being trained
for as little as twelve hours on eight P100 GPUs.

\section{Background}
The goal of reducing sequential computation also forms the foundation of the
Extended Neural GPU, ByteNet~\cite{kalchbrenner2016} and
ConvS2S~\cite{gehring2017}, all of which use convolutional neural networks as a
basic building block. In these models the number of operations required to relate
signals from two arbitrary input or output positions grows in the distance
between positions, linearly for ConvS2S and logarithmically for ByteNet. In the
Transformer this is reduced to a constant number of operations, albeit at the cost
of reduced effective resolution due to averaging attention-weighted positions, an
effect we counteract with multi-head attention.

Self-attention, sometimes called intra-attention, is an attention mechanism
relating different positions of a single sequence in order to compute a
representation of the sequence. Self-attention has been used successfully in a
variety of tasks including reading comprehension, abstractive summarization, and
learning task-independent sentence representations~\cite{cheng2016,lin2017}. To
the best of our knowledge, however, the Transformer is the first transduction
model relying entirely on self-attention to compute representations of its input
and output without using sequence-aligned RNNs or convolution.

\section{Model Architecture}
Most competitive neural sequence transduction models have an encoder-decoder
structure~\cite{sutskever2014}. Here, the encoder maps an input sequence of symbol
representations $(x_1, \dots, x_n)$ to a sequence of continuous representations
$\mathbf{z} = (z_1, \dots, z_n)$. Given $\mathbf{z}$, the decoder then generates
an output sequence $(y_1, \dots, y_m)$ of symbols one element at a time. At each
step the model is auto-regressive, consuming the previously generated symbols as
additional input when generating the next.

The Transformer follows this overall architecture using stacked self-attention
and point-wise, fully connected layers for both the encoder and decoder, shown in
the two halves of Fig.~\ref{fig:arch}.

\begin{figure}[t]
\centering
\begin{tikzpicture}[
  font=\scriptsize,
  box/.style={draw, rounded corners=2pt, minimum width=3.1cm, minimum height=0.5cm, align=center, fill=blue!5},
  addn/.style={draw, rounded corners=2pt, minimum width=3.1cm, minimum height=0.4cm, align=center, fill=orange!12},
  emb/.style={draw, rounded corners=2pt, minimum width=2.3cm, minimum height=0.45cm, align=center, fill=gray!8},
  >={Stealth[length=2mm]}
]
% Encoder stack
\node[emb] (ei) {Input\\Embedding};
\node[addn, above=0.35cm of ei] (ea1) {Multi-Head\\Attention};
\node[addn, above=0.3cm of ea1] (ea2) {Add \& Norm};
\node[box, above=0.3cm of ea2] (ef) {Feed\\Forward};
\node[addn, above=0.3cm of ef] (ea3) {Add \& Norm};
\draw[->] (ei) -- (ea1);
\draw[->] (ea1) -- (ea2);
\draw[->] (ea2) -- (ef);
\draw[->] (ef) -- (ea3);
\node[above=0.15cm of ea3] {\textit{Encoder} $\times N$};

% Decoder stack
\node[emb, right=1.4cm of ei] (di) {Output\\Embedding};
\node[addn, above=0.35cm of di] (da1) {Masked\\Multi-Head Attn};
\node[addn, above=0.3cm of da1] (da2) {Add \& Norm};
\node[addn, above=0.3cm of da2] (dx) {Cross\\Attention};
\node[addn, above=0.3cm of dx] (da3) {Add \& Norm};
\node[box, above=0.3cm of da3] (df) {Feed Forward};
\draw[->] (di) -- (da1);
\draw[->] (da1) -- (da2);
\draw[->] (da2) -- (dx);
\draw[->] (dx) -- (da3);
\draw[->] (da3) -- (df);
\draw[->] (ea3.east) to[out=0,in=180] (dx.west);
\node[above=0.15cm of df] {\textit{Decoder} $\times N$};
\end{tikzpicture}
\caption{The Transformer follows an encoder-decoder structure built from stacked
self-attention and point-wise feed-forward layers. The decoder additionally
attends over the encoder output (cross attention).}
\label{fig:arch}
\end{figure}

\subsection{Encoder and Decoder Stacks}
\textbf{Encoder.} The encoder is composed of a stack of $N = 6$ identical layers.
Each layer has two sub-layers. The first is a multi-head self-attention mechanism,
and the second is a simple, position-wise fully connected feed-forward network. We
employ a residual connection around each of the two sub-layers, followed by layer
normalization~\cite{ba2016}. That is, the output of each sub-layer is
$\mathrm{LayerNorm}(x + \mathrm{Sublayer}(x))$. All sub-layers, as well as the
embedding layers, produce outputs of dimension $d_{\text{model}} = 512$.

\textbf{Decoder.} The decoder is also composed of a stack of $N = 6$ identical
layers. In addition to the two sub-layers in each encoder layer, the decoder
inserts a third sub-layer, which performs multi-head attention over the output of
the encoder stack. We also modify the self-attention sub-layer in the decoder
stack to prevent positions from attending to subsequent positions. This masking,
combined with the fact that the output embeddings are offset by one position,
ensures that the predictions for position $i$ can depend only on the known outputs
at positions less than $i$.

\subsection{Attention}
An attention function can be described as mapping a query and a set of key-value
pairs to an output, where the query, keys, values, and output are all vectors. The
output is computed as a weighted sum of the values, where the weight assigned to
each value is computed by a compatibility function of the query with the
corresponding key.

\textbf{Scaled Dot-Product Attention.} We compute the dot products of the query
with all keys, divide each by $\sqrt{d_k}$, and apply a softmax function to obtain
the weights on the values. In practice, we compute the attention function on a set
of queries simultaneously, packed together into a matrix $Q$. The keys and values
are also packed together into matrices $K$ and $V$:
\begin{equation}
\mathrm{Attention}(Q, K, V) = \mathrm{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V.
\label{eq:sdpa}
\end{equation}
While for small values of $d_k$ additive and dot-product attention perform
similarly, dot-product attention is much faster and more space-efficient in
practice. We suspect that for large values of $d_k$ the dot products grow large in
magnitude, pushing the softmax function into regions where it has extremely small
gradients. To counteract this effect, we scale the dot products by
$\frac{1}{\sqrt{d_k}}$.

\textbf{Multi-Head Attention.} Instead of performing a single attention function
with $d_{\text{model}}$-dimensional keys, values, and queries, we found it
beneficial to linearly project the queries, keys, and values $h$ times with
different, learned linear projections. On each of these projected versions we then
perform the attention function in parallel and concatenate the results:
\begin{equation}
\mathrm{MultiHead}(Q, K, V) = \mathrm{Concat}(\mathrm{head}_1, \dots, \mathrm{head}_h)W^{O},
\label{eq:mha}
\end{equation}
\begin{equation}
\text{where } \mathrm{head}_i = \mathrm{Attention}(QW_i^{Q}, KW_i^{K}, VW_i^{V}).
\end{equation}
In this work we employ $h = 8$ parallel attention heads. For each we use
$d_k = d_v = d_{\text{model}}/h = 64$. Due to the reduced dimension of each head,
the total computational cost is similar to that of single-head attention with full
dimensionality.

\subsection{Position-wise Feed-Forward Networks}
In addition to attention sub-layers, each layer contains a fully connected
feed-forward network, applied to each position separately and identically. This
consists of two linear transformations with a ReLU activation in between:
\begin{equation}
\mathrm{FFN}(x) = \max(0, xW_1 + b_1)W_2 + b_2.
\label{eq:ffn}
\end{equation}
The dimensionality of input and output is $d_{\text{model}} = 512$, and the inner
layer has dimensionality $d_{ff} = 2048$.

\subsection{Positional Encoding}
Since our model contains no recurrence and no convolution, in order for the model
to make use of the order of the sequence we inject information about the relative
or absolute position of the tokens. We add positional encodings to the input
embeddings, using sine and cosine functions of different frequencies:
\begin{align}
PE_{(pos, 2i)}   &= \sin\!\left(pos / 10000^{2i/d_{\text{model}}}\right),\\
PE_{(pos, 2i+1)} &= \cos\!\left(pos / 10000^{2i/d_{\text{model}}}\right),
\end{align}
where $pos$ is the position and $i$ is the dimension.

\section{Why Self-Attention}
In this section we compare various aspects of self-attention layers to the
recurrent and convolutional layers commonly used for mapping one variable-length
sequence of symbol representations to another. Motivating our use of
self-attention we consider three desiderata: the total computational complexity
per layer; the amount of computation that can be parallelized, as measured by the
minimum number of sequential operations required; and the path length between
long-range dependencies in the network. Table~\ref{tab:complexity} summarizes
these for the different layer types.

\begin{table*}[t]
\centering
\caption{Maximum path lengths, per-layer complexity, and minimum number of
sequential operations for different layer types. $n$ is the sequence length, $d$
the representation dimension, $k$ the kernel size, and $r$ the neighborhood size
in restricted self-attention.}
\label{tab:complexity}
\begin{tabular}{@{}lccc@{}}
\toprule
Layer Type & Complexity per Layer & Sequential Operations & Maximum Path Length \\
\midrule
Self-Attention             & $O(n^2 \cdot d)$        & $O(1)$ & $O(1)$ \\
Recurrent                  & $O(n \cdot d^2)$        & $O(n)$ & $O(n)$ \\
Convolutional              & $O(k \cdot n \cdot d^2)$ & $O(1)$ & $O(\log_k n)$ \\
Self-Attention (restricted) & $O(r \cdot n \cdot d)$  & $O(1)$ & $O(n/r)$ \\
\bottomrule
\end{tabular}
\end{table*}

\section{Training}
We trained on the standard WMT 2014 English-German dataset consisting of about 4.5
million sentence pairs, and the significantly larger WMT 2014 English-French
dataset consisting of 36M sentences. We trained our models on one machine with
eight NVIDIA P100 GPUs. For our base models, each training step took about 0.4
seconds, and we trained for a total of 100{,}000 steps or 12 hours. We used the
Adam optimizer~\cite{kingma2015} with $\beta_1 = 0.9$, $\beta_2 = 0.98$, and
$\epsilon = 10^{-9}$, and varied the learning rate over training according to a
warmup schedule. We applied residual dropout and label smoothing of
$\epsilon_{ls} = 0.1$ for regularization.

\section{Results}
\subsection{Machine Translation}
On the WMT 2014 English-to-German translation task, the big Transformer model
outperforms the best previously reported models, including ensembles, by more than
2.0 BLEU, establishing a new state-of-the-art BLEU score of 28.4. On the WMT 2014
English-to-French task, our big model achieves a BLEU score of 41.8, outperforming
all previously published single models at less than a quarter of the training cost
of the previous state-of-the-art model. Table~\ref{tab:bleu} summarizes our
results and compares translation quality and training costs to other model
architectures.

\begin{table*}[t]
\centering
\caption{The Transformer achieves better BLEU scores than previous
state-of-the-art models on the English-to-German and English-to-French
newstest2014 tests at a fraction of the training cost.}
\label{tab:bleu}
\begin{tabular}{@{}lccc@{}}
\toprule
 & \multicolumn{2}{c}{BLEU} & Training Cost (FLOPs) \\
\cmidrule(lr){2-3}
Model & EN-DE & EN-FR & \\
\midrule
ByteNet                 & 23.75 & --    & --                  \\
GNMT + RL               & 24.6  & 39.92 & $1.4 \times 10^{20}$ \\
ConvS2S                 & 25.16 & 40.46 & $1.5 \times 10^{20}$ \\
GNMT + RL Ensemble      & 26.30 & 41.16 & $1.8 \times 10^{21}$ \\
ConvS2S Ensemble        & 26.36 & 41.29 & $1.2 \times 10^{21}$ \\
\midrule
Transformer (base)      & 27.3  & 38.1  & $3.3 \times 10^{18}$ \\
\textbf{Transformer (big)} & \textbf{28.4} & \textbf{41.8} & $2.3 \times 10^{19}$ \\
\bottomrule
\end{tabular}
\end{table*}

\subsection{Model Variations}
To evaluate the importance of different components of the Transformer, we varied
our base model in different ways, measuring the change in performance on
English-to-German translation. Table~\ref{tab:variations} presents these results.
In rows (A) we vary the number of attention heads and the attention key and value
dimensions, keeping the amount of computation constant. Single-head attention is
0.9 BLEU worse than the best setting, but quality also drops off with too many
heads.

\begin{table}[t]
\centering
\caption{Variations on the Transformer architecture. Unlisted values are identical
to those of the base model. All metrics are on the English-to-German development
set, newstest2013.}
\label{tab:variations}
\begin{tabular}{@{}clcccc@{}}
\toprule
 & & $h$ & $d_k$ & $d_v$ & BLEU \\
\midrule
base & & 8  & 64 & 64 & 25.8 \\
\midrule
\multirow{2}{*}{(A)} & & 1  & 512 & 512 & 24.9 \\
                     & & 16 & 32  & 32  & 25.8 \\
\midrule
(B) & fewer $d_k$        & 8 & 16 & 16 & 25.1 \\
(C) & bigger model       & 8 & 64 & 64 & 26.2 \\
(D) & dropout $0.0$      & 8 & 64 & 64 & 24.6 \\
\bottomrule
\end{tabular}
\end{table}

\section{Conclusion}
In this work we presented the Transformer, the first sequence transduction model
based entirely on attention, replacing the recurrent layers most commonly used in
encoder-decoder architectures with multi-head self-attention. For translation
tasks, the Transformer can be trained significantly faster than architectures
based on recurrent or convolutional layers. On both WMT 2014 English-to-German and
English-to-French translation tasks we achieve a new state of the art. We are
excited about the future of attention-based models and plan to apply them to other
tasks and to input and output modalities other than text.

\bibliographystyle{IEEEtran}
\bibliography{refs}

\end{document}
"#,
    ),
    (
        "refs.bib",
        r#"@article{hochreiter1997,
  author  = {Hochreiter, Sepp and Schmidhuber, J{\"u}rgen},
  title   = {Long Short-Term Memory},
  journal = {Neural Computation},
  volume  = {9},
  number  = {8},
  pages   = {1735--1780},
  year    = {1997},
}

@inproceedings{cho2014,
  author    = {Cho, Kyunghyun and van Merri{\"e}nboer, Bart and Gulcehre, Caglar and Bahdanau, Dzmitry and Bougares, Fethi and Schwenk, Holger and Bengio, Yoshua},
  title     = {Learning Phrase Representations using {RNN} Encoder-Decoder for Statistical Machine Translation},
  booktitle = {EMNLP},
  year      = {2014},
}

@inproceedings{bahdanau2015,
  author    = {Bahdanau, Dzmitry and Cho, Kyunghyun and Bengio, Yoshua},
  title     = {Neural Machine Translation by Jointly Learning to Align and Translate},
  booktitle = {ICLR},
  year      = {2015},
}

@inproceedings{sutskever2014,
  author    = {Sutskever, Ilya and Vinyals, Oriol and Le, Quoc V.},
  title     = {Sequence to Sequence Learning with Neural Networks},
  booktitle = {NeurIPS},
  year      = {2014},
}

@article{kalchbrenner2016,
  author  = {Kalchbrenner, Nal and Espeholt, Lasse and Simonyan, Karen and van den Oord, Aaron and Graves, Alex and Kavukcuoglu, Koray},
  title   = {Neural Machine Translation in Linear Time},
  journal = {arXiv preprint arXiv:1610.10099},
  year    = {2016},
}

@inproceedings{gehring2017,
  author    = {Gehring, Jonas and Auli, Michael and Grangier, David and Yarats, Denis and Dauphin, Yann N.},
  title     = {Convolutional Sequence to Sequence Learning},
  booktitle = {ICML},
  year      = {2017},
}

@inproceedings{cheng2016,
  author    = {Cheng, Jianpeng and Dong, Li and Lapata, Mirella},
  title     = {Long Short-Term Memory-Networks for Machine Reading},
  booktitle = {EMNLP},
  year      = {2016},
}

@inproceedings{lin2017,
  author    = {Lin, Zhouhan and Feng, Minwei and dos Santos, C{\'i}cero Nogueira and Yu, Mo and Xiang, Bing and Zhou, Bowen and Bengio, Yoshua},
  title     = {A Structured Self-Attentive Sentence Embedding},
  booktitle = {ICLR},
  year      = {2017},
}

@article{ba2016,
  author  = {Ba, Jimmy Lei and Kiros, Jamie Ryan and Hinton, Geoffrey E.},
  title   = {Layer Normalization},
  journal = {arXiv preprint arXiv:1607.06450},
  year    = {2016},
}

@inproceedings{kingma2015,
  author    = {Kingma, Diederik P. and Ba, Jimmy},
  title     = {Adam: A Method for Stochastic Optimization},
  booktitle = {ICLR},
  year      = {2015},
}
"#,
    ),
];

pub fn template_for(id: &str) -> Option<Template> {
    match id {
        "blank" => Some(BLANK_TEMPLATE),
        "resume" => Some(ONE_PAGE_RESUME_TEMPLATE),
        "ats-resume" => Some(ATS_RESUME_TEMPLATE),
        "ieee" => Some(IEEE_TEMPLATE),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[tauri::command]
pub fn list_templates() -> Vec<TemplateInfo> {
    vec![
        TemplateInfo {
            id: "blank".into(),
            name: "Blank document".into(),
            description: "A minimal article to start from scratch.".into(),
        },
        TemplateInfo {
            id: "resume".into(),
            name: "One-Page Resume".into(),
            description: "ATS-safe one-page resume, filled out as a senior software engineer example you can edit.".into(),
        },
        TemplateInfo {
            id: "ieee".into(),
            name: "IEEE Research Paper".into(),
            description: "Complete two-column IEEEtran paper, a full worked example with a figure, tables, equations, and a .bib.".into(),
        },
    ]
}

#[tauri::command]
pub fn export_pdf(project_id: String, main_doc: String, dest: String) -> Result<(), String> {
    let build = paths::build_dir(&project_id)?;
    let stem = Path::new(&main_doc)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");
    let pdf = build.join(format!("{stem}.pdf"));
    if !pdf.exists() {
        return Err("No compiled PDF found - recompile first.".into());
    }
    std::fs::copy(&pdf, &dest).map_err(|e| format!("failed to write PDF: {e}"))?;

    // Record in export history (keep the most recent 50).
    let mut meta = read_meta(&project_id)?;
    let filename = Path::new(&dest)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("export.pdf")
        .to_string();
    let date = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    meta.exports.push(ExportRecord {
        date,
        filename,
        path: dest,
    });
    if meta.exports.len() > 50 {
        meta.exports.drain(0..meta.exports.len() - 50);
    }
    write_meta(&project_id, &meta)?;
    Ok(())
}

/// Convert the main document to another format via `pandoc` (md/html/docx).
/// Errors clearly if pandoc isn't installed on the system.
#[tauri::command]
pub fn export_document(
    project_id: String,
    main_doc: String,
    format: String,
    dest: String,
) -> Result<(), String> {
    use std::process::Command;
    let _ = &format; // pandoc infers the output format from the dest extension
    let root = paths::project_dir(&project_id)?;
    // Validate `main_doc` stays inside the project before handing it to pandoc.
    resolve(&project_id, &main_doc)?;
    // Verify pandoc is available.
    let probe = Command::new("pandoc").arg("--version").output();
    if probe.is_err() {
        return Err(
            "pandoc is not installed. Install pandoc to export Word/HTML/Markdown.".to_string(),
        );
    }
    // `--` terminates option parsing so a `main_doc` beginning with `-` can't be
    // interpreted as a pandoc flag (defense-in-depth; it's already validated to
    // stay inside the project).
    let out = Command::new("pandoc")
        .arg("-o")
        .arg(&dest)
        .arg("--")
        .arg(&main_doc)
        .current_dir(&root)
        .output()
        .map_err(|e| format!("failed to run pandoc: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("pandoc failed: {}", err.trim()));
    }
    Ok(())
}

#[tauri::command]
pub fn create_project_from_template(name: String, template_id: String) -> Result<String, String> {
    let template =
        template_for(&template_id).ok_or_else(|| format!("unknown template: {template_id}"))?;
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    let main_doc = template
        .iter()
        .find(|(p, _)| p.ends_with(".tex"))
        .map(|(p, _)| p.to_string())
        .unwrap_or_else(|| "main.tex".to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (path, content) in template {
        let file = dir.join(path);
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&file, content).map_err(|e| e.to_string())?;
    }
    write_meta(
        &id,
        &ProjectMeta {
            name,
            main_doc,
            engine: default_engine(),
            exports: Vec::new(),
        },
    )?;
    Ok(id)
}

// --- Global document search ---

#[derive(Serialize)]
pub struct SearchHit {
    pub project_id: String,
    pub project_name: String,
    pub path: String,
    pub line: u32,
    pub preview: String,
}

const SEARCH_LIMIT: usize = 200;

fn is_searchable(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".tex")
        || n.ends_with(".bib")
        || n.ends_with(".sty")
        || n.ends_with(".cls")
        || n.ends_with(".txt")
        || n.ends_with(".md")
}

fn search_walk(
    project_id: &str,
    project_name: &str,
    root: &Path,
    dir: &Path,
    q_lower: &str,
    hits: &mut Vec<SearchHit>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if hits.len() >= SEARCH_LIMIT {
            return;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".openleaf" || name_str == ".localleaf" || name_str == ".git" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            search_walk(project_id, project_name, root, &path, q_lower, hits);
            continue;
        }
        if !is_searchable(&name_str) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(q_lower) {
                let preview: String = line.trim().chars().take(160).collect();
                hits.push(SearchHit {
                    project_id: project_id.to_string(),
                    project_name: project_name.to_string(),
                    path: rel.clone(),
                    line: (i as u32) + 1,
                    preview,
                });
                if hits.len() >= SEARCH_LIMIT {
                    return;
                }
            }
        }
    }
}

/// Search every project's text files for `query` (case-insensitive, substring).
#[tauri::command]
pub fn search_docs(query: String) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let q_lower = q.to_lowercase();
    let root = paths::projects_root()?;
    let mut hits: Vec<SearchHit> = Vec::new();
    let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if hits.len() >= SEARCH_LIMIT {
            break;
        }
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let project_id = entry.file_name().to_string_lossy().into_owned();
        let meta = read_meta(&project_id).unwrap_or_default();
        let project_name = if meta.name.is_empty() {
            project_id.clone()
        } else {
            meta.name
        };
        search_walk(
            &project_id,
            &project_name,
            &entry.path(),
            &entry.path(),
            &q_lower,
            &mut hits,
        );
    }
    Ok(hits)
}

/// Search a SINGLE project's text files for `query`. Used by the AI assistant so
/// a chat scoped to one project can't surface (and forward to the model) the
/// contents of the user's other projects.
#[tauri::command]
pub fn search_project(project_id: String, query: String) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let q_lower = q.to_lowercase();
    let root = paths::project_dir(&project_id)?;
    let meta = read_meta(&project_id).unwrap_or_default();
    let project_name = if meta.name.is_empty() {
        project_id.clone()
    } else {
        meta.name
    };
    let mut hits: Vec<SearchHit> = Vec::new();
    search_walk(
        &project_id,
        &project_name,
        &root,
        &root,
        &q_lower,
        &mut hits,
    );
    Ok(hits)
}

// --- Download ZIP, Duplicate, Clear cache ---

/// Zip a project's source files (excluding `.openleaf`, `.git`) to `dest`.
#[tauri::command]
pub fn download_project_zip(project_id: String, dest: String) -> Result<(), String> {
    let root = paths::project_dir(&project_id)?;
    let file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    fn add_dir(
        writer: &mut zip::ZipWriter<std::fs::File>,
        opts: zip::write::SimpleFileOptions,
        base: &Path,
        dir: &Path,
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == ".openleaf" || name_str == ".localleaf" || name_str == ".git" {
                continue;
            }
            let path = entry.path();
            let rel = path.strip_prefix(base).unwrap_or(&path);
            let zip_name = rel.to_string_lossy().replace('\\', "/");
            if path.is_dir() {
                writer
                    .add_directory(&zip_name, opts)
                    .map_err(|e| e.to_string())?;
                add_dir(writer, opts, base, &path)?;
            } else {
                writer
                    .start_file(&zip_name, opts)
                    .map_err(|e| e.to_string())?;
                let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
                std::io::copy(&mut f, writer).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    add_dir(&mut writer, opts, &root, &root)?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Duplicate a project (copy everything including `.git` history).
#[tauri::command]
pub fn duplicate_project(project_id: String, new_name: String) -> Result<String, String> {
    let root = paths::projects_root()?;
    let src = paths::project_dir(&project_id)?;
    let new_id = unique_random_slug(&root)?;
    let dst = root.join(&new_id);
    copy_dir_recursive(&src, &dst)?;
    // Update the project name in the copy.
    if let Ok(mut meta) = read_meta(&new_id) {
        meta.name = new_name;
        let _ = write_meta(&new_id, &meta);
    }
    Ok(new_id)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Clear the build cache (forces a clean rebuild on next compile).
#[tauri::command]
pub fn clear_build_cache(project_id: String) -> Result<(), String> {
    let build = paths::build_dir(&project_id)?;
    // Remove everything inside build except the entry wrapper.
    if let Ok(entries) = std::fs::read_dir(&build) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Delete a project (removes its directory entirely).
#[tauri::command]
pub fn delete_project(project_id: String) -> Result<(), String> {
    paths::validate_project_id(&project_id)?;
    let root = paths::projects_root()?;
    let dir = root.join(&project_id);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("failed to delete project: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        // A process-wide counter guarantees uniqueness even when tests run in
        // parallel (a plain timestamp can collide within the same nanosecond).
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let base = std::env::temp_dir().join(format!("openleaf-test-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn rejects_absolute_paths() {
        let root = temp_root();
        assert!(resolve_within(&root, "/etc/passwd").is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = temp_root();
        assert!(resolve_within(&root, "../secret").is_err());
        assert!(resolve_within(&root, "a/../../secret").is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn allows_normal_relative_paths() {
        let root = temp_root();
        let p = resolve_within(&root, "sub/dir/file.tex").unwrap();
        assert!(p.starts_with(&root));
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let root = temp_root();
        let outside = temp_root();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        // Writing "through" the symlink would land outside the project root.
        assert!(resolve_within(&root, "escape/x.tex").is_err());
        std::fs::remove_dir_all(&outside).ok();
        std::fs::remove_dir_all(&root).ok();
    }
}
