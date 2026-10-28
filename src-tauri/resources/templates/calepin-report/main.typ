#import "/.calepin/calepin.typ" as calepin
#show: calepin.document

#set document(title: [Title of Your Report], author: "Your Name")
#set page(paper: "us-letter", margin: 1in)
#set text(size: 11pt)
#set heading(numbering: "1.")

#calepin.setup(echo: true, eval: true, results: "verbatim")

#title()

= Introduction

This report is an ordinary Typst document with code chunks. Calepin runs
each chunk, then places its output right below the code. Chunks run once you
allow code in this project.

= Analysis

The chunk below defines the data and prints a summary. Later chunks can use
the same variables, because each language keeps one session for the whole
document.

```python
values = [2.1, 2.4, 1.9, 2.8, 2.2]
mean = sum(values) / len(values)
print(f"The mean of {len(values)} values is {mean:.2f}.")
```

```python
#| echo: false
spread = max(values) - min(values)
print(f"The values span {spread:.1f} units.")
```

#let py = calepin.inline.with("python")

Results can also appear inside a sentence: the largest value is
#py[`print(max(values))`].

= Conclusion

Summarize what the analysis shows. If Python is not installed, Calepin shows
a short note in place of each chunk's output, and the rest of the report
still builds.
