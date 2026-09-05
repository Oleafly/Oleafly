---
name: oleafly-response-letter
description: Turn reviewer comments and the changes already made into a point-by-point response letter, in LaTeX and in plain text. Use when preparing a rebuttal, an author response, or a revision cover letter for a journal or conference, when mapping each reviewer point to the passage that changed, when a resubmission needs every comment answered, or when a response letter has to compile alongside the paper.
license: MIT
compatibility: Any LaTeX project. Finding what changed works best when the project is a git repository, which Oleafly projects are by default. The bundled template compiles on the app engine with no extra packages.
allowed-tools: read_file list_files search_project create_file write_file replace_in_file compile get_log set_main_doc run_command read_skill_file show_location update_todos
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: review
    tools:
      - read_file
      - list_files
      - search_project
      - create_file
      - write_file
      - replace_in_file
      - compile
      - get_log
      - set_main_doc
      - run_command
      - read_skill_file
      - show_location
      - update_todos
---

# Write a response letter

Reviewers gave comments. The paper changed. This turns those two things into a letter that answers every point and shows where in the manuscript the answer lives.

The letter is a working draft for the authors to check and sign. Every claim in it about what changed must be true, because an editor can and will check.

## Procedure

### 1. Capture the comments verbatim

Get the reviewer comments from wherever the user has them: an attached file, pasted text in the chat, or a file already in the project. Save them unedited with `create_file` and `write_file` to `review/comments.md`.

Number every separable point as you go. One reviewer paragraph often holds three requests, and an unnumbered request is a request that gets missed.

```
## Reviewer 1

R1.1 The sample size justification is missing.
R1.2 Table 2 reports means without dispersion.
R1.3 The related work section omits the closest prior method.

## Reviewer 2

R2.1 ...
```

Keep the reviewer's wording exactly. Do not paraphrase, soften, or merge points. If the comments arrive as a PDF, ask the user to paste the text or save it into the project, because reviewer letters are usually confidential and should not go through a network tool.

If no comments were supplied, stop and ask for them. Do not invent plausible reviewer comments.

### 2. Find out what actually changed

Oleafly commits a checkpoint automatically as you work, so the project is normally a git repository with a usable history.

```
run_command  git log --oneline -40
run_command  git diff <revision> -- <path>
run_command  git diff --stat <revision>
```

Pick the revision from before the revision round started. If the user knows the date of submission, `git log --since=<date>` narrows it. `run_command` needs approval, and it runs in the project directory, so use relative paths.

When git is not available, the history does not go back far enough, or the user declines the command, ask the user to describe the changes and work from that. Say clearly in your final report that the mapping is based on their description rather than on a diff.

### 3. Map each point to the manuscript

For every numbered point, find the passage that answers it:

- `search_project` for a distinctive fragment of the new text
- `read_file` around the hit to quote it accurately and get the line number
- Record `file:line` and the exact new sentence

Some points map to no change, because you disagreed, because the request was out of scope, or because the data does not exist. Record those as unaddressed with a reason. Do not quietly skip them.

Track the mapping with `update_todos` so a point cannot fall out of the list.

### 4. Draft both versions

Write two files:

- `review/response.md`, plain text, for pasting into a submission form or an email
- `response.tex`, from `assets/response-template.tex`, for the venues that want a PDF

The template gives you four macros and nothing else to learn:

```latex
\reviewer{1}
\point{R1.1}{The sample size justification is missing.}
\reply{We have added the power calculation that determined the group size.}
\changed{sections/methods.tex, line 84}{With 80\% power at alpha = 0.05 to detect a difference of 0.4 SD, each arm required 99 participants.}
```

`\reviewer` opens a reviewer block, `\point` prints the comment in italics, `\reply` prints your answer, and `\changed` shows where the manuscript changed and quotes the new text. Read `references/tone-and-structure.md` before writing the prose.

### 5. Compile the letter

The letter is a second document in the same project, and a project has one main document at a time. Two ways to handle that:

**Compile it in place.** Note the current main document first, because you have to put it back.

1. `set_main_doc` to `response.tex`
2. `compile`, and `get_log` if it fails
3. `set_main_doc` back to the paper's main file, whether the compile succeeded or not

Never leave the project pointing at the response letter. `set_main_doc` also picks the engine from the file extension and it changes what the preview pane shows, so a project left in that state looks broken to the user next time they open it.

**Or leave it to the user.** Tell them the letter is written and that switching the main document to compile it is a one-click change they can make when they want the PDF. This is the safer option in a long agent run where the restore step might not be reached.

### 6. Check it before you hand it over

- Every numbered point has a reply.
- Every "we have changed X" claim has a real `file:line` behind it.
- Unaddressed points are marked as unaddressed, with a reason.
- No reviewer is contradicted with a different answer than another reviewer got for the same issue.

Then call `show_location` on two or three of the largest changes so the user can see them, and report in chat: how many points, how many addressed, which ones are not, and where the two files are.

## Decision points

| Situation | What to do |
| --- | --- |
| No comments supplied | Ask for them. Never invent reviewer comments. |
| Comments only exist as a PDF | Ask the user to paste or save the text. Reviewer letters are confidential. |
| Project is not a git repository | Work from the user's description and say so in the report. |
| `run_command` declined | Same as above. Do not retry the command in a different form. |
| Two reviewers ask for opposite changes | Answer both in the same terms, explain the choice once, and reference it from the second reply. |
| A request is out of scope | Say so plainly, explain why, and offer what you did instead. |
| A request needs data that does not exist | Mark it unaddressed, say what would be needed, and add a limitation to the paper if one is missing. |
| The venue caps the response length | Cut the reply prose, never the number of points answered. |

## When something goes wrong

- `git diff` output is enormous: narrow it with a path (`git diff <rev> -- sections/`) or use `--stat` first to find which files moved.
- `search_project` cannot find the new sentence: LaTeX wraps lines, so search a short fragment with no punctuation or macros in it.
- The template does not compile: the macros need nothing beyond `article`, `geometry`, `xcolor`, and `parskip`. If it still fails, `get_log` and look for a stray `%` or an unescaped `&`, `_`, or `#` copied out of a reviewer comment. Reviewer text is the usual culprit, because it was written in a plain-text editor.
- You set the main document and then the run ended: tell the user in your reply exactly which file to set back.

## Artifacts

- `review/comments.md`, the reviewer comments verbatim and numbered
- `review/response.md`, the plain-text response
- `response.tex`, the LaTeX response letter

## Done when

- Every reviewer point is numbered and appears in the response.
- Every claimed change is anchored to a file and a line that exists.
- Unaddressed points are visible as unaddressed.
- The main document is back to the paper.
- The user has been told which points still need their decision.
