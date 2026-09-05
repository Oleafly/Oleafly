# The matplotlib route

Everything here runs through `run_command`, which asks the user for approval, executes in the project directory with a 120 second budget, and inherits the login shell environment. There is no filesystem or network sandbox, so a figure script should read its input and write its output and nothing else.

## Check the interpreter first

```
python3 --version
python3 -c "import matplotlib; print(matplotlib.__version__)"
```

If either fails, say so and switch to TikZ or pgfplots rather than installing anything. If the user wants the Python route, ask before installing a package.

## Shape of a figure script

Keep the whole recipe in the file so the figure can be rebuilt a year later.

```python
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt

mpl.use("Agg")

OKABE_ITO = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#000000"]

MM = 1 / 25.4
OUT = Path("figures/results.pdf")


def load():
    ...


def main():
    x, series = load()
    fig, ax = plt.subplots(figsize=(89 * MM, 60 * MM), layout="constrained")
    for (label, y), color, marker in zip(series.items(), OKABE_ITO, ["o", "s", "^", "D"]):
        ax.plot(x, y, color=color, marker=marker, markersize=3, linewidth=1.2, label=label)
    ax.set_xlabel("Time (hours)")
    ax.set_ylabel("Response (unit)")
    ax.legend(frameon=False)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT)


if __name__ == "__main__":
    main()
```

Points that matter:

- `mpl.use("Agg")` keeps it headless.
- `layout="constrained"` handles colorbars, nested grids and mosaics. Do not call `tight_layout()` afterwards; it turns constrained layout off.
- Set the physical size in the figure, not by scaling in `\includegraphics`. Scaling changes the font size relative to the body text and is the most common reason a figure looks wrong on the page.
- Do not pass `bbox_inches="tight"` when the exact page size matters. It silently changes the dimensions you just set.
- Every series gets a color **and** a marker or line style.
- Save PDF for the manuscript. PNG only when the content is a photograph or a screenshot, at 300 dpi or better.

## Sizes

| Target | Width |
|---|---|
| Single column, most journals | 85 to 90 mm |
| One and a half columns | 120 to 140 mm |
| Double column, full width | 170 to 180 mm |
| Slide | 254 by 143 mm at 16:9 |

These are the usual ranges, not a rule. The exact figure width and the accepted formats come from the target journal's current author instructions. `scientific-visualization`'s `references/journal_requirements.md` has dated snapshots; treat them as a starting point and check the live page before submission.

Height follows from the content. A wider-than-tall aspect suits time series; square suits scatter plots where both axes share units.

## Using the vendored assets

`load_skill` with id `scientific-visualization` returns the skill's absolute directory. From there:

| File | What it gives |
|---|---|
| `assets/publication.mplstyle` | A style sheet for manuscript figures |
| `assets/presentation.mplstyle` | Larger type for slides |
| `assets/nature.mplstyle` | A Nature-oriented variant |
| `assets/color_palettes.py` | Named palettes including Okabe-Ito |
| `assets/publisher_profiles.json` | Per-publisher size and format profiles |
| `scripts/style_presets.py` | `style_context(...)` for scoped styles |
| `scripts/figure_export.py` | An exporter that refuses silent overwrites, writes atomically, and records provenance |
| `scripts/palette_audit.py` | Contrast and grayscale separation check |
| `scripts/image_metadata.py` | Reads back what actually landed in the file |

Two ways to use them:

1. Run one directly: `python3 "<skill dir>/scripts/palette_audit.py" ...`. They need Python 3.11 or newer.
2. Copy the style sheet into the project (`figures/publication.mplstyle`) and load it with `plt.style.use("figures/publication.mplstyle")`. This keeps the project self-contained, which matters when the user shares it.

Prefer option 2 for anything the manuscript depends on.

## Data provenance

Write down, in the script or in a sibling note, where the numbers came from and what was done to them: the source file, the filtering, the aggregation, the normalization, the bin edges, the smoothing window, the estimator, the uncertainty definition, and the random seed. A figure whose recipe is not recorded cannot be defended in review.

## Checking the output

1. `list_files` to confirm the file landed where you expected.
2. `compile` the document that includes it.
3. `verify_pdf_pages` on the page that holds it, when PDF page capture is enabled, and look at the type size relative to the body text.
4. If the figure is a raster, confirm it is not blurry at final size before calling it done.
