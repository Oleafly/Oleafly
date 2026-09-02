# Checkpoints

Checkpoints are immutable local recovery records created only after a
successful compile. They are separate from Git and never initialize a
repository, create a commit, or change a branch.

## What a Checkpoint contains

A Checkpoint contains `project.json`, the main document, and the exact
project-local inputs proven by the document engine. Files selected by the
project's **Always include** policy are added explicitly. Generated PDFs,
build output, `.git`, `.oleafly`, and unrelated project files are excluded.

Oleafly never widens an uncertain dependency set to the whole project. If the
engine cannot prove every input, the document still compiles and Oleafly shows
a non-blocking reason for skipping the Checkpoint.

The currently shipped engine adapters do not yet provide complete evidence
for every supported compile path. Automatic publication therefore stays
disabled for those paths until the adapters can meet the recovery contract.

## Storage and recovery

- History is stored outside the project in a per-project content-addressed
  store.
- Duplicate content is reused across Checkpoints for the same project.
- Restoring replaces project files transactionally while preserving `.git`
  and `.oleafly`.
- Deleting a project permanently removes its external Checkpoints data.
  Moving a project to the Recycle Bin keeps the history recoverable.
- A duplicated project receives a new identity and starts with empty history.

The Checkpoints panel can restore or delete one record, keep only the latest
record, reset the history, and show reclaimable space.

## Portable encrypted archives

Export and import use a password-encrypted project history archive. Oleafly
streams the logical records through authenticated encryption, so plaintext
history is not written to a temporary file. Import verifies the complete
archive before new roots become visible.

Passwords are never stored. A forgotten archive password cannot be recovered.

The first supported format, archive envelope version 1 with history stream
version 2 and checkpoint records version 1, is Oleafly's minimum restore
compatibility floor. Future releases must keep importing this format or provide
a supported migration before changing the format written by the app. An
unsupported future version is rejected before the current project's history
changes. A checked-in encrypted archive is exercised by the test suite to
protect this recovery promise.

## Project policy compatibility

The portable policy lives in `project.json` under `checkpoints`. Missing policy
data uses the safe engine-dependencies default. New Oleafly versions preserve
unknown policy fields when they update project metadata.

Older Oleafly releases that predate this field cannot preserve data they do
not understand. If one of those releases rewrites `project.json`, it may reset
the Checkpoints policy. The newer app cannot reconstruct policy data after an
older release has removed it.
