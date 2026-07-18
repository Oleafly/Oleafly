---
title: "Set up AI"
description: "Bring your own key from nine providers or run fully local with Ollama: connecting, switching models, custom instructions, and exactly where your keys live."
---

Oleafly's AI is strictly bring-your-own: you connect a provider you already have (or a local model), your key stays on your machine, and requests go directly from the app to that provider. There is no Oleafly server in the loop and no markup on your tokens.

Everything here lives in Settings, **AI Assistant**, also reachable from the chat panel's **Connect a provider** button.

## The providers

| Provider | Models offered |
|---|---|
| **OpenAI** | GPT-4o, GPT-4o mini, GPT-4.1, GPT-4.1 mini, o3-mini |
| **Anthropic** | Claude Sonnet 4, Claude 3.5 Sonnet, Claude 3.5 Haiku |
| **Z.AI (GLM Coding Plan)** | GLM-5.2, GLM-4.6, GLM-4.5 Air, GLM-4.5 |
| **Groq** | Llama 3.3 70B, Llama 3.1 8B Instant |
| **OpenRouter** | GPT-4o mini, Claude 3.5 Sonnet, Gemini Flash 1.5, Llama 3.3 70B |
| **DeepSeek** | DeepSeek V3 (chat), DeepSeek R1 (reasoner) |
| **Mistral** | Mistral Large, Codestral, Mistral Small |
| **xAI (Grok)** | Grok 2, Grok Beta |
| **Ollama (local)** | Whatever you've pulled: Llama 3.2, Qwen 2.5, Mistral, Gemma 2, ... |

Each provider card carries a **Get key** link straight to the right page. Reasoning models (GLM, DeepSeek R1) stream their thinking phase live into the chat; see [Chat & tools](/OpenLeaf/ai-chat/#reasoning-models-think-out-loud).

## Connecting a provider

1. Expand the provider's card and paste your API key.
2. **Save.** The provider becomes **Active** immediately (green badge) and a **Model** dropdown appears; pick the model you want as default.
3. Done. The chat panel header now shows your model.

Configure as many providers as you like: extras show a grey **Connected** badge with an **Activate** button, and the chat panel's model menu switches between all of them on the fly. The trash icon deletes a key.

![Provider cards in Settings, AI Assistant](/OpenLeaf/media/settings-ai.png)

## Going local with Ollama

Zero-cloud AI in three steps:

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3.2`
2. In the Ollama card, click **Check for Ollama**. Oleafly detects the local server and lists your installed models.
3. Pick one. That's the whole connection; no key exists because nothing leaves your machine.

The card handles the failure case too: if Ollama isn't running you get the exact commands to fix it and a **Re-check** button. A custom host URL (for Ollama on another machine) hides under "Change host (advanced)".

## Custom instructions

The **Custom instructions** box appends your standing preferences to every AI request, chat and inline edits alike: "Always write in British English. Keep explanations short. Prefer the enumitem package for lists."

Instructions are sandboxed: they steer tone, style, and content, but they can't override the assistant's tools, its approval rules, or its safety behavior.

## Where your keys live, precisely

- Keys and host URLs are stored in Oleafly's local config on your disk. The settings screen says it plainly: keys are stored locally only.
- Requests go app-to-provider over HTTPS (or app-to-localhost for Ollama).
- Attachment bytes are never saved into chat history; only file names and types are.

## What the assistant can do once connected

The settings page lists the assistant's tools with plain-English descriptions, from `read_file` to `compile`. The full story, including the approval flow that gates every file change, is on [Chat & tools](/OpenLeaf/ai-chat/).
