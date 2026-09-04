# Checkpoints

A checkpoint is an immutable local record of the sources that produced one
successful compile. Checkpoints are separate from Git. They never initialize a
repository, create a commit, or change a branch.

## When a checkpoint is saved

Oleafly saves a checkpoint after a successful compile, in the background. The
compile result, the editor, saves, and the preview never wait for it. A new
project gets its first checkpoint from its first successful compile.

A checkpoint is saved only when the sources changed. If the files the compile
used are byte for byte the same as the newest checkpoint, nothing is written
and history keeps its order. Each checkpoint is therefore a distinct version.

There is no queue. If a newer compile succeeds while a checkpoint is still
being saved, the older save is cancelled and the newer state is saved instead.

## What a checkpoint contains

A checkpoint holds `project.json`, the main document, and every project-local
file the document engine proved it read while producing the PDF: included
sources, images, bibliographies, fonts, and data files. Generated PDFs, build
output, logs, `.git`, `.oleafly`, and files the compile did not use are left
out. Oleafly never widens an uncertain dependency set to the whole project. If
the engine cannot prove every input, the document still compiles and Oleafly
shows a short reason for skipping the checkpoint.

Automatic publication supports the controlled Tectonic, Typst, and Markdown
with Pandoc compile paths. Markdown checkpoints work with any Pandoc the app
accepts (2.19 or newer), and each checkpoint records which Pandoc build proved
it. The proof of a checkpoint is a sealed replay:
Oleafly compiles the sealed inputs a second time in the same controlled
environment and keeps the checkpoint only if that replay reproduces the
controlled compile byte for byte. It is skipped when the replay does not
reproduce the controlled compile or when the evidence includes an external,
protected, or unreadable input. The PDF you see after a compile and the
checkpoint's proof compile can differ by a fraction of a point in word spacing,
because Tectonic reruns TeX inside one process and the output depends on what
the build directory already held from the last compile. latexmk, Biber, shell
escape, and draft mode remain unavailable for checkpoints.

There is nothing to configure. A checkpoint has no include list and no ignore
list, so no project setting can leave a file out of one.

## The Versioning window

The Versioning window has two tabs. Git History lists the project's commits and
restores the project to any of them. Saved Checkpoints lists the checkpoints.

The checkpoints tab opens on the timeline, newest on top, with the version
number, time, engine, main document, file count, and stored size. Expand an
entry to see its files and which of them were compiler inputs, which were
included by rule, and which were recorded but not stored. Restore replaces the
files in the checkpoint transactionally and preserves `.git`, `.oleafly`, and
every file the checkpoint does not contain. Delete removes one record.

A checkpoint can also carry a label. The pencil on an entry opens a text field
that takes up to 80 characters on one line. Saving puts the label in the entry
title and keeps the version number next to it as a small tag. Clearing the text
removes the label. Labels are part of the checkpoint record, so they survive
export and import of an encrypted archive.

An Advanced section sits below the timeline and starts collapsed. It reports
how many checkpoints exist and how much room they take. It shows where the
store lives, opens that folder, and inspects the store's SQLite catalog:
format version, lineage, table counts, and packs. Export and Import move a
complete history as an encrypted archive. Keep latest and Reset trim the
history.

The toolbar has one Versioning button, and it opens the window on the tab used
last. The command palette has two entries. "Git history" opens the Git History
tab and "Checkpoints" opens the Saved Checkpoints tab.

## Settings

Settings has two checkpoint switches, under Data Storage in the Local store
tab. One turns automatic checkpoints off. The other hides the notice shown when
a checkpoint is skipped. The storage location and the catalog inspector are no
longer in Settings. They are in the Advanced section of the Versioning window.

## Storage

History is stored outside the project in a per-project content-addressed
store under the Oleafly data directory. Duplicate content is stored once for
the same project. Capture is streamed with bounded memory and explicit file,
checkpoint, and chunk-reference limits, and an oversized capture is skipped
without publishing. Deleting a project permanently removes its checkpoint
data. Moving a project to the Recycle Bin keeps the history recoverable. A
duplicated project receives a new identity and starts with empty history.

## Portable encrypted archives

Export and import use a password-encrypted history archive. Oleafly streams
the records through authenticated encryption, so plaintext history is never
written to a temporary file, and import verifies the complete archive before
any new record becomes visible.

Passwords are never stored, and a forgotten password cannot be recovered.
Archives written by this version use envelope version 2 with an Argon2id
derived key. Envelope version 1, which used PBKDF2, stays importable. An
archive from a newer, unsupported version is rejected before the current
history changes. A checked-in archive of each supported version is exercised by
the test suite to protect this promise.

## Compatibility

A missing `checkpoints` object in `project.json` means engine-dependencies
mode with empty rules. Newer Oleafly versions preserve unknown fields when they
rewrite project metadata. Releases that predate the field cannot preserve what
they do not understand, so an older release that rewrites `project.json` may
reset the rules.
