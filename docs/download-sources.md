# Download sources

Oleafly downloads some large pieces only when a project needs them: the
TinyTeX distribution, other Typst versions, the Tinymist language server, font
packs, and the TeX packages Tectonic reads from its bundle. Each of these files
has a size and SHA-256 checksum written into the app, and Oleafly refuses a
download that doesn't match. That is why the source can be changed safely: a
mirror can make a download faster or reachable, but it can't change what gets
installed.

Settings > Downloads > Sources has two choices.

## Where downloads come from

| Choice | Order Oleafly tries |
| --- | --- |
| Oleafly mirror first (default) | `mirrors.oleafly.com`, then the original host (GitHub for most files). |
| Original hosts | The original host only. Files that only the Oleafly mirror carries still come from it. |
| Your own mirror | Your address, then `mirrors.oleafly.com`, then the original host. |

A host that failed during this session moves to the end of the list for an
hour, so a blocked host costs one timeout instead of one per download. TinyTeX
downloads continue from where they stopped when Oleafly moves to the next
host.

The Tectonic bundle follows the same choice. `OLEAFLY_TEX_BUNDLE_URL` still
overrides it when set.

## TeX package repository

When you add a package in Settings > Engines > LaTeX, or a compile installs a
missing one, tlmgr downloads it from a TeX Live repository.

- Nearest CTAN mirror, the default, uses
  `https://mirror.ctan.org/systems/texlive/tlnet`. That address sends each
  request to a CTAN mirror close to you.
- A specific repository takes the HTTPS address of any TeX Live repository,
  such as a university's CTAN mirror. The address ends in
  `/systems/texlive/tlnet`.

The TinyTeX that Oleafly installs always uses this setting. A TeX Live you
installed yourself uses it only when you enter an address; otherwise tlmgr
keeps its own configured repository. Oleafly passes the address with
`--repository` on each run and never changes tlmgr's saved configuration.

When the repository has moved on to a newer TeX Live year than the installed
one, Oleafly retries against that year's archive, whichever repository is set.

A package search that has to reach the repository can take a while on a slow
connection, because tlmgr downloads the repository's full package list.
Oleafly waits up to 10 minutes. If it gives up, the error names the repository
it was waiting on.

MiKTeX installs packages with its own package manager, so this setting doesn't
affect it.

## Setting it for a whole machine

Two environment variables override the saved settings. Settings shows the
value and locks the choice while a variable is set. `oleafly` on the command
line reads the same saved settings and variables.

| Variable | Value |
| --- | --- |
| `OLEAFLY_DOWNLOAD_MIRROR` | `automatic`, `original`, or the HTTPS address of your own mirror. |
| `OLEAFLY_TEX_REPOSITORY` | The HTTPS address of a TeX Live repository. |

A value that isn't valid is ignored, and the saved setting applies.

## Hosting your own mirror

Your mirror is a copy of the files Oleafly lists, at the same paths as on
`mirrors.oleafly.com`. To build one from a checkout of this repository:

```bash
node scripts/check-mirror-files.mjs --list > mirror-files.txt
```

```bash
wget --force-directories --no-host-directories --directory-prefix=oleafly-mirror --input-file=mirror-files.txt
```

That is about 6 GB, half of it the 2.9 GB Tectonic bundle. The list also has
the Tectonic, Pandoc and Biber archives that building Oleafly from source
downloads, so the same copy serves those builds. Serve the
`oleafly-mirror` folder over HTTPS and enter its address, for example
`https://mirror.example.edu/oleafly`, as your own mirror.

The server has to answer HTTP range requests, because Tectonic reads single
packages out of the bundle instead of downloading all of it. This should return
`206`:

```bash
curl -r 0-1023 -s -o /dev/null -w "%{http_code}\n" https://mirror.example.edu/oleafly/tex-bundles/tlextras-2022.0r0.tar
```

New Oleafly releases can add files, such as a newer TinyTeX or Typst version.
Rebuild the list after updating Oleafly. A file your mirror doesn't have yet is
fetched from the next source, so an old mirror slows those downloads down but
doesn't break them.

## Not covered yet

These still come from their own hosts whatever the setting: spelling
dictionaries, template packs, app updates, Typst Universe packages, and online
services such as AI providers and literature search.

## Checking the Oleafly mirror

CI runs `pnpm mirror:check`, which sends a HEAD request for every listed file
and fails when one is missing or has the wrong size. For a file the bucket has,
it then reads one byte through the edge cache and fails when the edge still
answers 404 from before the upload. Purge that address in the Cloudflare
dashboard to clear it. A refusal or outage only
produces a warning. The check uses HEAD because the mirror's edge cache keeps
the answer to a GET for a missing file for days, even after the file is
uploaded.
