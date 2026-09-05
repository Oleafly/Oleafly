# Posters

A poster is read from about two metres away by someone who will give it 90 seconds. Everything below follows from that.

Confirm the board size with the conference before choosing a class option. Printing the wrong size is expensive and cannot be fixed on the day.

## Sizes

| Size | Millimetres | Inches | Where |
| --- | --- | --- | --- |
| A0 | 841 by 1189 | 33.1 by 46.8 | The international default |
| A1 | 594 by 841 | 23.4 by 33.1 | Smaller venues, easier to travel with |
| 36 by 48 in | 914 by 1219 | 36 by 48 | The common United States portrait size |
| 48 by 36 in | 1219 by 914 | 48 by 36 | Landscape |
| 90 by 120 cm | 900 by 1200 | 35.4 by 47.2 | Common in Europe |

Portrait is the usual orientation and suits a top-to-bottom reading flow. Landscape suits timelines and wide figures.

## Font sizes

At the sizes below, set for A0. Scale proportionally for a smaller board, and never go below the minimum column.

| Element | Recommended | Minimum |
| --- | --- | --- |
| Title | 72 to 85 pt | 60 pt |
| Authors | 54 pt | 48 pt |
| Affiliations | 36 pt | 32 pt |
| Section headings | 42 pt | 36 pt |
| Body text | 28 pt | 24 pt |
| Figure captions | 22 pt | 20 pt |
| References | 20 pt | 18 pt |

Sans-serif throughout. Serif faces lose their fine strokes at poster distance and in large-format printing.

## Content budget

The most common poster mistake is treating it as a printed paper.

| Section | Words |
| --- | --- |
| Title | 10 to 15 |
| Introduction or motivation | 100 to 150 |
| Methods | 100 to 200, or a diagram with 50 |
| Results | 150 to 250, most of it captions |
| Conclusion | 75 to 125 |
| References | 5 entries at most |

Total body text under 800 words. Everything else is figures, white space, and headings.

Put the finding in the title. "A single filter step explains the site effect" tells a passing reader whether to stop. "An investigation of site effects in multi-centre data" does not.

## Layout

Three columns on A0 portrait, or two wide ones. Reading flows down each column, then to the next. Number the sections if the flow is not obvious.

Give the largest block on the poster to the main result figure. If a reader looks at one thing, that is what it should be.

Leave real white space. A poster at 80 percent coverage looks dense from a distance and people walk past it. Aim for something closer to 50 percent.

Put a QR code to the paper or the code in a corner, at least 5 cm square, with a short caption saying what it points to.

## beamerposter

The more flexible of the two classes, and the one to use when you want beamer's blocks and columns at poster scale.

```latex
\documentclass[final]{beamer}
\usepackage[size=a0,scale=1.24,orientation=portrait]{beamerposter}
\usetheme{Berlin}
\usecolortheme{seahorse}
\usepackage{graphicx}
\usepackage{booktabs}
\graphicspath{{../figures/}}
```

`scale` multiplies every font size. At `size=a0` with `scale=1.24`, beamer's `\normalsize` lands near 29 pt, which matches the body-text target above. Raise `scale` if the body text still looks small in the rendered PDF, and check by measuring against the title rather than by eye at screen zoom.

For a custom board size:

```latex
\usepackage[size=custom,width=91.4,height=121.9,scale=1.3,orientation=portrait]{beamerposter}
```

Width and height are centimetres.

Content goes in `columns` and `block` the same way as in a beamer deck.

## tikzposter

Simpler, with a distinct look, and it is what the bundled Oleafly poster template uses.

```latex
\documentclass[25pt,a0paper,portrait]{tikzposter}
\usetheme{Default}
\usecolorstyle{Denmark}
\usepackage{graphicx}
\graphicspath{{../figures/}}
```

The class option sets the base font size, so `25pt` with `a0paper` gives readable body text. Content goes in `\block{Title}{...}` inside `\begin{columns}` with `\column{0.5}` fractions.

`tikzposter` handles the layout for you and resists being pushed around. That is a feature when the poster is straightforward and a problem when the venue wants a specific layout. Use `beamerposter` when you need control.

## Colour

Use a colour-blind safe palette. The Okabe and Ito set is a reliable default:

```latex
\definecolor{OIorange}{RGB}{230,159,0}
\definecolor{OIskyblue}{RGB}{86,180,233}
\definecolor{OIgreen}{RGB}{0,158,115}
\definecolor{OIyellow}{RGB}{240,228,66}
\definecolor{OIblue}{RGB}{0,114,178}
\definecolor{OIvermillion}{RGB}{213,94,0}
\definecolor{OIpurple}{RGB}{204,121,167}
```

Never let colour be the only thing distinguishing two series. Add a marker shape, a line style, or a direct label.

Dark text on a light background prints better and is cheaper. A full-bleed dark background uses a lot of ink and shows every scuff.

## Before printing

- Compile and look at the rendered page, not just the source.
- Check the physical size in the PDF properties matches the board.
- Zoom to 100 percent, which is life size, and read the body text. If it is uncomfortable, it is too small.
- Print one page at 25 percent on A4 and read it at arm's length. Anything you cannot read at that scale is too small on the board.
- Check figures are not upscaled raster images. A 300 dpi figure that was 800 pixels wide in the paper becomes a blurry patch at poster scale. Regenerate plots as vector PDF.
- Leave a 2 cm margin the printer can trim into.
