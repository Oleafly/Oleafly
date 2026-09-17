# Hunspell dictionaries

Five language packs live in this directory and ship inside the app: `en_US`,
`en_GB`, `en_AU`, `de_DE`, and `fr_FR`. They work with no network and no
setup. Every other language in the spelling-dictionary list is downloaded when
you pick it, and is stored in `~/.oleafly/assets/dictionaries/<locale>/` so it
works offline afterwards.

All of these packs come from the
[`wooorm/dictionaries`](https://github.com/wooorm/dictionaries) collection,
which republishes the upstream Hunspell dictionaries as npm packages. Keep the
upstream license and attribution when redistributing Oleafly.

## The catalog

`src-tauri/resources/dictionary-packs.json` lists every pack: its locale id,
language and region names, the npm package and pinned version it came from, the
SHA-256 and byte size of each file, and its license. Regenerate it with:

```
pnpm dictionaries:catalog
pnpm dictionaries:test
```

The generator reads the latest published version of each `dictionary-<code>`
package, downloads `index.aff` and `index.dic` from jsDelivr at that exact
version, and records what it hashed. A download is only renamed into place
after its SHA-256 matches the catalog, so a corrupted or substituted file is
discarded rather than used.

The worker loads the selected pack exactly. A missing, unreadable, or
not-yet-downloaded pack is a visible unavailable state; it never silently
substitutes another locale.

## Licenses

The five packs in this directory are `(MIT AND BSD)` for the English variants,
`(GPL-2.0 OR GPL-3.0)` for German, and `MPL-2.0` for French. The downloadable
packs carry the licenses below, as published on npm:

- `(BSD-3-Clause OR CC-BY-3.0)`: nl_NL
- `(GPL-2.0 OR GPL-3.0)`: de_AT, de_CH, de_DE
- `(GPL-2.0 OR LGPL-2.1)`: ca_ES
- `(GPL-2.0 OR LGPL-2.1 OR MPL-1.1)`: bg_BG, br_FR, da_DK, el_GR, fo_FO, hu_HU,
  hy_AM, ko_KR, pt_PT, ro_RO, sk_SK
- `(GPL-2.0 OR LGPL-2.1 OR MPL-1.1 OR CC-BY-SA-3.0)`: sr_Latn, sr_RS
- `(GPL-3.0 OR LGPL-2.1)`: sl_SI
- `(GPL-3.0 OR LGPL-3.0 OR MPL-1.1)`: es_AR, es_BO, es_CL, es_CO, es_CR, es_CU,
  es_DO, es_EC, es_ES, es_GT, es_HN, es_MX, es_NI, es_PA, es_PE, es_PH, es_PR,
  es_PY, es_SV, es_US, es_UY, es_VE
- `(GPL-3.0 OR LGPL-3.0 OR MPL-2.0)`: pl_PL
- `(LGPL-2.1 OR SISSL)`: hr_HR
- `(LGPL-3.0 OR MPL-2.0)`: pt_BR
- `(MIT AND BSD)`: en_AU, en_CA, en_GB, en_US
- `AGPL-3.0`: he_IL
- `Apache-2.0`: fa_IR, tk_TM
- `BSD-3-Clause`: lt_LT, ru_RU
- `CC-BY-SA-3.0`: is_IS
- `EUPL-1.1`: lb_LU
- `GPL-2.0`: cs_CZ, eo, eu_ES, ga_IE, la, nb_NO, nn_NO, oc_FR, vi_VN
- `GPL-3.0`: fy_NL, gd_GB, gl_ES, it_IT, mk_MK, rw_RW, uk_UA
- `LGPL-2.1`: en_ZA, et_EE, lv_LV, ne_NP
- `LGPL-3.0`: cy_GB, sv_FI, sv_SE
- `LPPL-1.3c`: mn_MN
- `MIT`: ka_GE, tr_TR
- `MPL-2.0`: fr_FR

Each catalog entry also records the URL of that pack's license file, so the
full text is one fetch away.
