# oleafly-desktop agent guide

Workspace-wide rules live in `../AGENTS.md` (git hygiene, security, humanizer,
CI reproduction). This file adds repo-specific duties.

## AI model catalog maintenance (routine check)

Model lineups rot fast: in mid-2026 alone, Anthropic, DeepSeek, xAI, Groq, and
Perplexity each retired ids the app was still listing. Whenever you touch the
AI provider surface, and at least monthly, verify the catalogs against each
provider's official docs. Never trust training data for model ids or prices.

Four places must stay in sync:

1. `src-tauri/resources/ai-models.json` — an allow-list that
   `src-tauri/src/ai_model_registry.rs` intersects with each provider's live
   `/models` listing. A model missing here is hidden from the picker even when
   the provider serves it. An unknown provider id filters to an empty list,
   and Ollama and custom providers are filtered like everyone else, so keep
   the Ollama section stocked with common local pulls.
2. The CDN copy in `../oleafly-assets/catalogs/ai-models.json`, served from
   `cdn.oleafly.com/catalogs/ai-models.json`. It overrides the bundled file at
   runtime. Ship the app change in a release before deploying catalog
   additions that older builds cannot drive (new wire requirements, new
   protocols), or released builds will surface models that fail.
3. `crates/oleafly-agent/src/provider.rs` (`CATALOG` `default_model`) together
   with `packages/ai-core/src/providers.ts`. The first entry of each
   provider's `models` array must equal the Rust default;
   `packages/ai-core/src/catalog-parity.test.ts` enforces it by scraping the
   Rust source.
4. `src/lib/ai-pricing.ts` — the per-model rate card the cost estimate uses.
   Unknown ids fall back to a generic estimate, so add rows for anything the
   picker recommends.

Check against the providers' own pages, with a search for anything ambiguous:
Anthropic (platform.claude.com pricing and model-deprecations), OpenAI
(developers.openai.com pricing and deprecations), Google
(ai.google.dev/gemini-api/docs/models), xAI (docs.x.ai/docs/models), Groq
(console.groq.com/docs/models and docs/deprecations), DeepSeek
(api-docs.deepseek.com/quick_start/pricing), Mistral (docs.mistral.ai models
overview), Perplexity (docs.perplexity.ai models), Z.AI release notes.

Gemini has one wire-level requirement the others do not: Gemini 3 models
return a part-level `thoughtSignature` beside `functionCall`, and the request
that replays history must echo it or the API returns a 400. The handling
lives in `crates/oleafly-agent` (`ToolCall::thought_signature`, the Google
translator, and `google_part`). Keep it intact when touching the Google wire.
