# AI model catalog

The assistant reads two data files that live in `src-tauri/resources/`. Both are compiled into
the app binary, and both have a copy on the CDN that the app prefers when it can reach it.

## ai-models.json

The trust catalog. For every provider it records which model ids we have actually run the
assistant against, and which ones we know are broken.

```json
{
  "schemaVersion": 2,
  "providers": {
    "google": {
      "verified": ["gemini-3.5-flash"],
      "blocked": {
        "gemini-3-flash-preview": "This preview model's thinking output breaks the assistant loop."
      }
    }
  }
}
```

The CDN copy is at `https://cdn.oleafly.com/catalogs/ai-models.json`.

Schema version 1, where each provider was a plain array of model ids, still parses. Such an array
is read as the verified list with nothing blocked. That fallback matters because the file on the
CDN can be older or newer than the app reading it.

### What the labels mean

A **verified** model has been through a tool-call round trip and came back with a usable tool
call. The assistant runs on it without a warning.

**Blocked** is the other end. Someone tried the model, it failed in a way we can describe, and the
catalog carries that description as one sentence. The assistant refuses to start a run and shows
the sentence instead.

Everything else is **untested**: the provider offered the model, and the catalog has nothing to
say about it. You can still pick it, and the picker tells you it is untested. Custom endpoints
report every model that way, since we have no idea what sits behind them.

Probing a model yourself from the picker writes the result into your own config, which turns an
untested model into a verified one or marks it blocked with whatever went wrong. A reason from the
catalog wins over a local probe.

## model-metadata.json

Context window, output limit, modalities, pricing, and the capability flags the picker shows. It
is a trimmed snapshot of [models.dev](https://models.dev) rather than a hand-written file, so do
not edit it by hand.

Regenerate it with:

```bash
pnpm sync:model-metadata
```

That fetches `https://models.dev/api.json`. Pass a path as the first argument to read a local copy
instead:

```bash
pnpm sync:model-metadata ~/Downloads/api.json
```

The script keeps only the providers the app supports, drops the upstream fields nothing renders,
sorts providers and models by id so a re-run produces a readable diff, and prints a model count per
provider. Commit the result with whatever change prompted the refresh.

Ollama has no models.dev entry, so local models never carry metadata. Neither do ids the upstream
data does not know, which is normal for dated snapshot aliases such as `gpt-5-2025-08-07`. Missing
metadata is not an error. The picker just shows less.

The CDN mirror is at `https://cdn.oleafly.com/catalogs/model-metadata.json`.

## The CDN copies move on their own

Neither CDN file is tied to an app release. A model that turns out to be broken can be blocked for
everyone on the day we find out, without waiting for a build. The bundled copies are the floor:
they are what an app with no network falls back to, so keep them current enough to be worth
falling back to.
