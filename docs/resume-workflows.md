# Resume workflows

Oleafly uses the same project model for resumes as it does for other technical
documents: editable source files, local compilation, automatic Git history, and
optional AI assistance. There is no separate Resume Mode toggle.

## Start from a resume template

Open **New project**, filter the gallery for ATS-friendly templates, and choose
a design that matches the role and amount of experience you need to present.
Templates remain normal, editable project files; they are not tied to a hosted
resume service or proprietary document format.

Some templates use fonts that Oleafly downloads on first use. Those fonts are
copied into the project so the document remains self-contained afterward.

## Check what a parser can read

Compile the resume, then open **Preflight**. Oleafly checks both the source and
the generated PDF and reports:

- ATS readiness and accessibility scores
- detected name, email, phone number, links, and standard resume sections
- reading order and extracted plain text
- text that is missing, garbled, or hidden behind icon fonts
- multi-column layouts, layout tables, missing metadata, and other common risks

These checks are readiness aids, not a guarantee that every employer's
applicant-tracking system will assign the same result. Review the extracted text
and test important applications against the employer's submission preview when
one is available.

## Keep role-specific variants

Every project is a real Git repository. Use branches or duplicate projects for
role-specific variants, such as:

- a research-oriented CV
- a concise industry resume
- a version tailored to a particular role

Automatic commits, history, diffs, and restore let you reuse an older bullet or
compare variants without keeping files such as `resume-final-v4.tex`.

## Tailor with optional AI

With an AI provider configured, paste a job description into the assistant and
ask it to improve selected bullets or emphasize relevant experience. Oleafly
shows file-changing edits as an approval diff before applying them. After an
accepted edit, the assistant can compile the project and inspect the resulting
PDF text.

![An AI-tailored resume edit waiting for approval](../media/resume-tailor.gif)

AI is optional. Template editing, compilation, Git history, and Preflight work
without an AI provider.

## Export

Export the compiled PDF or download the complete project as a ZIP. For tagged,
accessibility-oriented output, Preflight can prepare the source for LuaLaTeX;
use a compatible TeX Live installation or the optional TinyTeX download, then
re-run the checks on the produced PDF.

## Related guides

- [Features](features.md)
- [Getting started](getting-started.md)
- [AI Assistant](ai-assistant.md)
- [GitHub Sync](github-sync.md)
- [Document engines](document-engines.md)
