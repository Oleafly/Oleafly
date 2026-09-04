# Checkpoints

A checkpoint is a snapshot of your project folder, saved automatically after a
compile succeeds. Checkpoints are separate from Git. They never initialize a
repository, create a commit, or change a branch.

## When Oleafly saves one

Two conditions, and nothing else. The compile succeeded, and the project folder
differs from the newest checkpoint on record.

The save runs on its own background task. Starting it costs the compile nothing,
because no file is read and no store is opened until after the compile has
returned its result. A new project gets its first checkpoint from its first
successful compile.

There is no queue. Compile again while a save is still running and that save
stops, so the newer state is the one recorded. Compile five times in quick
succession and you end up with one checkpoint, holding the last state.

## What a checkpoint holds

The project folder as it stands after the compile. Everything under the project
root, whatever its type, whether or not the document refers to it. Oleafly does
not work out which files the compiler read and keep only those.

Left out: `.git`, `.oleafly`, `node_modules`, and any directory named
`_minted-*` or `pythontex-files-*`. Build output lives inside `.oleafly`, so the
compiled PDF and the log go out with it.

There is nothing to configure. Checkpoints have no include list and no ignore
list. No setting in `project.json` can keep a file out of one or push a file
into one.

Every engine is covered, since a checkpoint does not depend on how the document
was built.

## When it fails

Oleafly does not refuse to save a checkpoint. There is no toolchain check and no
second compile to prove the first one. Nothing is judged too uncertain to
record. Compile succeeded, folder changed, snapshot taken.

One message can reach you, and only one: checkpoint storage is full or not
writable. It says what went wrong and what to do about it, and Settings can turn
it off. Everything else that goes wrong goes to the app log and stays there,
because there is nothing for you to act on.

## The Versioning window

The Versioning window has two tabs. Git History lists the project's commits and
restores the project to any of them. Saved Checkpoints lists the checkpoints.

The checkpoints tab opens on the timeline, newest on top, with the version
number, time, engine, main document, file count, and stored size. Expand an
entry to see the files it holds and their sizes.

Restore writes the checkpoint's files back over your current copies. A file the
checkpoint holds that you deleted afterwards comes back. A file you added after
the checkpoint was taken stays where it is, since the checkpoint says nothing
about it. `.git` and `.oleafly` are left alone. The write runs as one
transaction, so an interrupted restore rolls back instead of leaving you with
half a project.

Delete removes one checkpoint, and it is always safe to do. Every checkpoint
stands on its own, and Oleafly reclaims only the stored data that no remaining
checkpoint refers to.

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
checkpoint storage is full or not writable. The storage location and the
catalog inspector are no longer in Settings. They are in the Advanced section
of the Versioning window.

## Storage

History is stored outside the project in a per-project content-addressed store
under the Oleafly data directory. Duplicate content is stored once for the same
project. Capture is streamed with bounded memory and explicit file, checkpoint,
and chunk-reference limits, and a capture that exceeds them is not published.
Deleting a project permanently removes its checkpoint data. Moving a project to
the Recycle Bin keeps the history recoverable. A duplicated project receives a
new identity and starts with empty history.

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

A `checkpoints` object in `project.json` no longer decides what is captured.
Oleafly keeps the field so a project written by another version survives a
round trip unchanged. Newer Oleafly versions preserve unknown fields when they
rewrite project metadata. Releases that predate the field cannot preserve what
they do not understand, so an older release that rewrites `project.json` may
drop it.
