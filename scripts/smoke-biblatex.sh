#!/usr/bin/env bash
#
# Runs the packaged Tectonic and Biber on a real biblatex document, then on
# documents that try to run code through Biber with shell-escape off.
#   ./scripts/smoke-biblatex.sh <target-triple>
set -euo pipefail

TARGET="${1:?usage: smoke-biblatex.sh <target-triple>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

EXT=""
[[ "$TARGET" == *windows* ]] && EXT=".exe"
TOOLS="$TMP/tools"
mkdir -p "$TOOLS" "$TMP/unpack"
cp "$ROOT/src-tauri/binaries/tectonic-$TARGET$EXT" "$TOOLS/tectonic$EXT"
cp "$ROOT/src-tauri/binaries/tectonic-biber-$TARGET$EXT" "$TOOLS/tectonic-biber$EXT"
export PATH="$TOOLS:$PATH"
export PAR_GLOBAL_TMPDIR="$TMP/unpack"

"$TOOLS/tectonic-biber$EXT" --version | grep -F "biber version: 2.17"

MARKER_DIR="$TMP/markers"
mkdir -p "$MARKER_DIR"
# TeX and Perl both need forward slashes on Windows.
if command -v cygpath >/dev/null 2>&1; then
  MARKER_DIR="$(cygpath -m "$MARKER_DIR")"
fi

BUNDLE_URL="${OLEAFLY_TEX_BUNDLE_URL:-https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar}"

compile() {
  local name="$1"
  local attempt=1
  local bundle=(--bundle "$BUNDLE_URL")
  cd "$TMP/$name"
  mkdir -p out
  while :; do
    if tectonic -X compile ${bundle[@]+"${bundle[@]}"} --keep-logs --keep-intermediates \
      --outdir out main.tex >out/run.log 2>&1; then
      return 0
    fi
    if ! grep -qE "couldn't get it from the internet|this bundle isn't cached|failed to download|error connecting to" out/run.log; then
      return 1
    fi
    if [[ "$attempt" -ge 4 ]]; then
      return 1
    fi
    # Fall back to Tectonic's own bundle, which rate-limits CI runners.
    [[ "$attempt" -ge 2 ]] && bundle=()
    attempt=$((attempt + 1))
    sleep $((attempt * 5))
  done
}

project() {
  local name="$1"
  mkdir -p "$TMP/$name"
  printf '%s\n' \
    '@book{knuth, author={Donald Knuth}, title={The TeXbook}, publisher={Addison-Wesley}, year={1984}}' \
    >"$TMP/$name/refs.bib"
  cat >"$TMP/$name/main.tex"
}

project real <<'TEX'
\documentclass{article}
\usepackage[backend=biber]{biblatex}
\addbibresource{refs.bib}
\DeclareSourcemap{\maps[datatype=bibtex]{\map{
  \step[fieldsource=title,match=\regexp{(The)\s+(TeXbook)},replace=\regexp{$2,\x20\L$1\E!\x20\U$1}]
}}}
\begin{document}
Hello \cite{knuth}.
\printbibliography
\end{document}
TEX
if ! compile real; then
  cat out/run.log
  echo "a biblatex document failed to compile" >&2
  exit 1
fi
[[ -s "$TMP/real/out/main.pdf" ]]
grep -F "Knuth" "$TMP/real/out/main.bbl" >/dev/null
# The replacement above proves source maps still expand their groups.
grep -F "TeXbook, the! THE" "$TMP/real/out/main.bbl" >/dev/null

attack() {
  local name="$1"
  local marker="$MARKER_DIR/$name"
  sed "s|@MARKER@|$marker|g" | project "$name"
  compile "$name" || true
  if [[ -e "$marker" ]]; then
    echo "$name: the document reached the system through Biber" >&2
    exit 1
  fi
  echo "✓ $name stopped"
}

attack datasource-type <<'TEX'
\documentclass{article}
\usepackage[backend=biber]{biblatex}
\addbibresource[datatype={bibtex;open(F,q(>@MARKER@))}]{refs.bib}
\begin{document}\cite{knuth}\printbibliography\end{document}
TEX

attack sort-locale <<'TEX'
\documentclass{article}
\usepackage[backend=biber]{biblatex}
\addbibresource{refs.bib}
\DeclareSortingTemplate{evil}{\sort[locale={x'); open(F,q(>@MARKER@)); ('}]{\field{title}}}
\ExecuteBibliographyOptions{sorting=evil}
\begin{document}\cite{knuth}\printbibliography\end{document}
TEX

attack source-map <<'TEX'
\documentclass{article}
\usepackage[backend=biber]{biblatex}
\addbibresource{refs.bib}
\DeclareSourcemap{\maps[datatype=bibtex]{\map{
  \step[fieldsource=title,match=\regexp{.+},replace=\regexp{@{[open(F,q(>@MARKER@))]}}]
}}}
\begin{document}\cite{knuth}\printbibliography\end{document}
TEX

attack collate-option <<'TEX'
\documentclass{article}
\usepackage{logreq}
\AtEndPreamble{\logrequest[package=x,priority=1,active=1]{\generic{biber}\cmdline{%
  \binary{biber}\option{--collate-options=level=>open(F,q(>@MARKER@))}\infile{\jobname}}}}
\usepackage[backend=biber]{biblatex}
\addbibresource{refs.bib}
\begin{document}\cite{knuth}\printbibliography\end{document}
TEX

attack output-file <<'TEX'
\documentclass{article}
\usepackage{logreq}
\AtEndPreamble{\logrequest[package=x,priority=1,active=1]{\generic{biber}\cmdline{%
  \binary{biber}\option{--output-file=@MARKER@}\infile{\jobname}}}}
\usepackage[backend=biber]{biblatex}
\addbibresource{refs.bib}
\begin{document}\cite{knuth}\printbibliography\end{document}
TEX

echo "✓ biblatex smoke passed for $TARGET"
