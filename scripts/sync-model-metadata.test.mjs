import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_IDS,
  SCHEMA_VERSION,
  SOURCE_NAME,
  buildSnapshot,
  normalizeCost,
  normalizeModalities,
  normalizeStatus,
  serializeSnapshot,
  summarize,
  trimModel,
} from "./sync-model-metadata.mjs";

const fixture = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-mid": {
        id: "gpt-mid",
        name: "GPT Mid",
        description: "dropped",
        family: "gpt",
        attachment: true,
        reasoning: false,
        tool_call: true,
        structured_output: true,
        temperature: true,
        knowledge: "2024-06",
        release_date: "2024-05-13",
        last_updated: "2024-08-06",
        modalities: { input: ["text", "image"], output: ["text"] },
        open_weights: false,
        limit: { context: 128000, output: 16384 },
        cost: { input: 2.5, output: 10, cache_read: 1.25, cache_write: 3.75 },
      },
      "gpt-bare": {
        id: "gpt-bare",
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  anthropic: {
    id: "anthropic",
    models: {
      "claude-old": {
        id: "claude-old",
        name: "Claude Old",
        status: "deprecated",
        tool_call: true,
        limit: { context: 200000, output: 8192 },
        cost: { input: 3, output: 15 },
      },
    },
  },
  zai: {
    id: "zai",
    models: {
      "glm-preview": {
        id: "glm-preview",
        name: "GLM Preview",
        status: "BETA",
        tool_call: true,
        limit: { context: 0, output: 4096 },
      },
    },
  },
  cerebras: {
    id: "cerebras",
    models: { "unmapped-model": { id: "unmapped-model", name: "Unmapped" } },
  },
  ollama: {
    id: "ollama",
    models: {},
  },
};

test("maps only the providers the app knows about", () => {
  const snapshot = buildSnapshot(fixture, { generatedAt: "2026-09-03T00:00:00.000Z" });
  assert.deepEqual(Object.keys(snapshot.providers), ["anthropic", "openai", "zai"]);
  assert.equal(snapshot.schemaVersion, SCHEMA_VERSION);
  assert.equal(snapshot.source, SOURCE_NAME);
  assert.equal(snapshot.generatedAt, "2026-09-03T00:00:00.000Z");
  assert.equal(PROVIDER_IDS.zai, "zai");
  assert.equal(PROVIDER_IDS.ollama, undefined);
});

test("sorts providers and models by id", () => {
  const snapshot = buildSnapshot(fixture);
  assert.deepEqual(Object.keys(snapshot.providers), ["anthropic", "openai", "zai"]);
  assert.deepEqual(Object.keys(snapshot.providers.openai), ["gpt-bare", "gpt-mid"]);
});

test("trims a model to the snapshot shape", () => {
  const snapshot = buildSnapshot(fixture);
  assert.deepEqual(snapshot.providers.openai["gpt-mid"], {
    name: "GPT Mid",
    contextWindow: 128000,
    outputLimit: 16384,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    toolCall: true,
    reasoning: false,
    attachment: true,
    structuredOutput: true,
    status: "active",
    releaseDate: "2024-05-13",
    lastUpdated: "2024-08-06",
    cost: { input: 2.5, output: 10, cacheRead: 1.25 },
  });
});

test("defaults missing booleans to false and omits missing limits", () => {
  const snapshot = buildSnapshot(fixture);
  const bare = snapshot.providers.openai["gpt-bare"];
  assert.deepEqual(bare, {
    name: "gpt-bare",
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCall: false,
    reasoning: false,
    attachment: false,
    structuredOutput: false,
    status: "active",
  });
  assert.equal("contextWindow" in bare, false);
  assert.equal("outputLimit" in bare, false);
  assert.equal("cost" in bare, false);
});

test("keeps an upstream status and normalizes its case", () => {
  const snapshot = buildSnapshot(fixture);
  assert.equal(snapshot.providers.anthropic["claude-old"].status, "deprecated");
  assert.equal(snapshot.providers.zai["glm-preview"].status, "beta");
});

test("drops a zero context limit rather than writing zero", () => {
  const preview = buildSnapshot(fixture).providers.zai["glm-preview"];
  assert.equal("contextWindow" in preview, false);
  assert.equal(preview.outputLimit, 4096);
});

test("normalizes statuses outside the known set to active", () => {
  assert.equal(normalizeStatus(undefined), "active");
  assert.equal(normalizeStatus("retired"), "active");
  assert.equal(normalizeStatus(" Alpha "), "alpha");
});

test("drops unknown modalities and duplicates but keeps upstream order", () => {
  assert.deepEqual(normalizeModalities(["text", "text", "hologram", "IMAGE"]), ["text", "image"]);
  assert.deepEqual(normalizeModalities(undefined), []);
});

test("keeps only the three cost fields the app shows", () => {
  assert.deepEqual(normalizeCost({ input: 1, output: 2, cache_read: 0.5, reasoning: 9 }), {
    input: 1,
    output: 2,
    cacheRead: 0.5,
  });
  assert.equal(normalizeCost({ tiers: [] }), undefined);
  assert.equal(normalizeCost(undefined), undefined);
});

test("falls back to the model id when upstream has no name", () => {
  assert.equal(trimModel("some-model", { name: "   " }).name, "some-model");
  assert.equal(trimModel("some-model", null).name, "some-model");
});

test("summarizes provider model counts", () => {
  const { rows, total } = summarize(buildSnapshot(fixture));
  assert.deepEqual(rows, [
    { providerId: "anthropic", count: 1 },
    { providerId: "openai", count: 2 },
    { providerId: "zai", count: 1 },
  ]);
  assert.equal(total, 4);
});

test("serializes with two-space indentation and a trailing newline", () => {
  const text = serializeSnapshot(buildSnapshot(fixture, { generatedAt: "2026-09-03T00:00:00.000Z" }));
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.includes('\n  "source": "models.dev",'));
  assert.deepEqual(JSON.parse(text).schemaVersion, SCHEMA_VERSION);
});

test("rejects a payload that is not an object", () => {
  assert.throws(() => buildSnapshot("nope"), TypeError);
});
