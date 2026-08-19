# Product capabilities

This page is a product-level capability map. It records what the application
surface is designed to provide without duplicating task walkthroughs.

| Capability area | Public engineering reference |
| --- | --- |
| Editor and language services | [Editor](Editor.md) |
| PDF and compiled-artifact preview | [PDF preview](PDFPreview.md) |
| Project lifecycle and library | [General](General.md), [Project library](ProjectLibrary.md) |
| Git history and remote collaboration | [Source control](SourceControl.md) |
| AI assistance and external clients | [AI Copilot](AICopilot.md), [Integrations](Integrations.md), [MCP](mcp.md) |
| Citations and literature metadata | [Citations](Citations.md) |
| Templates and diagrams | [Templates](Templates.md), [Diagram composer](DiagramComposer.md) |
| Compilation and conversion | [Compilation engines](CompilationEngines.md), [Export](Export.md) |
| Compile, submission, accessibility, reference, privacy, and ATS checks | [Preflight](Preflight.md) |
| Release and update operations | [Releasing](releasing.md), [Code signing](signing.md), [Auto-updates](updates.md) |

## Product boundary

The local workflow includes project files, indexing, compilation with available
engines, preview, Git history, and deterministic preflight. Network-backed
providers, literature lookup, GitHub operations, optional downloads, and update
feeds are explicit integrations. See [Integrations](Integrations.md) for the
boundary and data-handling rules.

## Status source of truth

Capability claims should be backed by the implementation and its tests. Engine
capabilities come from the `DocumentEngine` descriptor; editor acceptance is
tracked in `test/fixtures/editor-support/contract.json`; package ownership and
maintenance rules are documented in [Product architecture](Architecture.md).
