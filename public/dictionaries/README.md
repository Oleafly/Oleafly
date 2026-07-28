# Hunspell dictionaries

The language packs in this directory are vendored from the
[`wooorm/dictionaries`](https://github.com/wooorm/dictionaries) distribution.
Keep the upstream license and attribution when redistributing Oleafly. Packs
are selected by locale (`en_US`, `en_GB`, `en_AU`, `de_DE`, and `fr_FR`).
The worker loads the selected pack exactly. A missing or unreadable pack is a
visible unavailable state; it never silently substitutes another locale.
