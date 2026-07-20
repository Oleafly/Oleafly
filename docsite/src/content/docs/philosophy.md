---
title: "Philosophy"
description: "Local-first, files you own, privacy by architecture, and no lock-in. The principles behind Oleafly and why it works the way it does."
---

Oleafly is built on a small number of firm convictions. They explain most of the product decisions you'll notice while using it.

## Your work lives on your disk

Every Oleafly project is a plain folder on your computer: your `.tex` files, your `.bib`, your images, and a real `.git` repository, sitting under `~/.openleaf/projects/`. There is no proprietary format, no database, no cloud copy you have to trust.

This is not a caching strategy or an offline mode bolted onto a web app. Local is the architecture. The consequence is simple: you can open your project folder with any editor, sync it with any tool, back it up however you back up everything else, and if you ever stop using Oleafly, you lose nothing.

## No accounts, no servers, no telemetry decisions to worry about

You do not sign up for Oleafly. You download it and write. There is no login, no usage tier, and no server-side compile queue between you and your PDF. The compiler runs on your machine, so compile speed is your machine's speed, and your unpublished research never leaves your computer to become a page of typeset output.

## Offline is a feature, not a degraded state

The bundled Tectonic engine downloads a LaTeX package only the first time you use it, then caches it. After that, writing and compiling work with the network cable unplugged. An explicit Offline mode (Settings, General) goes further and guarantees the compiler never touches the network at all.

The same principle extends through the product: spellcheck and grammar run as local WASM, the diagram composer works without any API key, and the AI assistant can run fully local through Ollama.

## Privacy by architecture, not by policy

Where Oleafly does talk to the network, it talks directly and minimally, and the docs tell you exactly what is sent:

- **AI assistant:** your API keys are stored locally and requests go straight from the app to the provider you chose. There is no Oleafly backend in the middle. Prefer zero network? Use Ollama.
- **Citation lookup:** only the identifier or title you typed is sent, to doi.org, arXiv, or Crossref.
- **Updates:** the app checks a signed release feed and verifies signatures before installing anything.

## History should be free

Version history is not a premium feature. Every project is a Git repository, so diffs, restores, and a full commit log are simply there, and [GitHub sync](/Oleafly/github-sync/) is one connection away when you want an off-machine backup or to move between computers. Because it is real Git, your history is portable too.

## The document you submit matters more than the one you see

A PDF can look perfect and still fail the two audiences that never complain out loud: resume parsers and screen readers. Oleafly treats machine readability as a first-class output. The compiler produces real, selectable Unicode text with embedded fonts, the resume templates follow ATS-safe layout rules, and the [Preflight panel](/Oleafly/preflight/) shows you what a parser or a screen reader actually receives, before you hit submit.

## AI that acts, but never without you

The AI assistant is an agent, not an autocomplete: it can read your project, edit files, compile, and check the result. But every file-changing action pauses for your approval with a red/green diff, and the assistant snapshots your project in Git before its first edit so you can always roll back. You stay the author.

## Free and open source

Oleafly is AGPL-licensed and developed in the open at [github.com/Oleafly/Oleafly](https://github.com/Oleafly/Oleafly). The templates it ships are permissively licensed, each with its license text included. If you want to see how something works or make it better, the [Engineering section](/Oleafly/engineering/contributing/) is the place to start.
