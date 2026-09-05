# Tooling notes

Facts about how Oleafly runs tools that change what a good procedure looks like. Read this once, then stop guessing about the runtime.

## Approval

Every tool call is classified read, write, network or shell.

- Read tools (`read_file`, `list_files`, `search_project`, `project_map`, `get_todos`, `list_notes`, `project_library_search`, `load_skill`, `read_skill_file`) run without prompting under the default policy.
- Network tools (`literature_search`, `verify_citation`, `alphaxiv_search`, `alphaxiv_paper_content`) are auto approved under the default policy and prompt under the stricter one.
- Write tools (`write_file`, `replace_in_file`, `create_file`, `rename_file`, `delete_file`) show a diff card the user has to approve.
- `run_command` is shell class. It prompts in the chat, and then the operating system shows its own confirmation dialog, unless the user has granted full access or an allow rule for this project.

A declined call comes back as `{"declined": true, "status": "declined"}`. That is the user saying no. Do not retry the same call, and do not route around it with a different tool. Ask what they would prefer instead.

Ten separate `run_command` calls means ten approval prompts. Batch what belongs together into one shell line.

## run_command

- One shell line, run through the login shell from the project root.
- 120 second timeout. Over that, the process tree is killed and the result has `timed_out: true`.
- 200 KiB combined stdout and stderr cap. Over that, the result has `truncated: true` and you have lost the tail.
- No filesystem or network sandbox beyond the approval gate. It can do anything the user can.
- On Windows it is `cmd /C`, not a login shell, so PATH additions made by a shell profile are not visible.

Two consequences. Long or chatty scripts should write to a file under `research/` and be read back with `read_file`. And never assume a tool exists because it exists on your machine: check with `command -v <tool>` inside the same command, or accept the failure gracefully.

## Vendored skill scripts

Vendored skills ship Python under `<skill dir>/scripts/`. The scripts are not in the project, so relative paths do not reach them. `load_skill` returns the absolute directory. Quote it.

```
python3 "<skill dir>/scripts/validate_citations.py" references.bib --report research/bib-report.json
```

Requirements vary by skill and are stated in each skill's `compatibility` line. `paper-lookup` and `scientific-writing` use only the Python standard library. `citation-management` needs `requests`, and its Google Scholar path additionally needs `scholarly`. Check the frontmatter that `load_skill` returned before assuming a script will import cleanly, and prefer the standard library ones when either would do.

If a script fails on a missing module, do not install packages. Fall back to the native Oleafly tool and tell the user which capability was unavailable.

## Subagents

`spawn_agent` returns `{id, taskPath, status}` immediately. Up to eight run at once by default, and a subagent cannot spawn further agents.

Subagents share your project tools and your approval gates, so a subagent that writes files will raise approval cards the user has to answer while you are waiting. Give read heavy work to subagents and keep writing in the main run.

`wait_agent` with `{"timeout_ms": 300000}` returns whichever agent finishes first, with a bounded view of its answer. Prefer one long wait over repeated short polls. `close_agent` with `{"agent": "<id>"}` frees the slot: finished agents hold their slot until closed.

An agent's prompt must be self contained. It does not see your conversation.

## Compile

`compile` takes `{}`. It persists the active editor file, builds, and returns `{success, errors, has_pdf, log_tail}`. `log_tail` is the last 4000 characters. `get_log` with `{}` returns the last 20000 characters when you need more context around an error.

Compile after each section rather than at the end. A red build found after six edits costs more to diagnose than one found after one.

`get_pdf_text` with `{}` returns the last PDF page by page, capped at 20000 characters. Use it to confirm that what you wrote actually rendered, particularly for citations, which fail silently into a question mark rather than an error.

## Notes and todos

`update_todos` replaces the whole checklist on every call, so always send the complete list. `remember_note` content is injected into every later turn, so keep it short and durable. `list_notes` gives ids, `forget_note` removes by id.
