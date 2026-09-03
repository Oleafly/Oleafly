---
title: Markdown notes
bibliography: refs.bib
---

# Overview

Some prose with $E = mc^2$ and a footnote[^1] attached.

!include chapters/one.md
{{< include chapters/two.md >}}
{% include "chapters/three" %}

```
!include chapters/never.md
```

Inline `!include chapters/never-inline.md` code stays put.

[^1]: The footnote text.
