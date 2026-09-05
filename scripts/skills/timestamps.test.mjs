import assert from "node:assert/strict";
import test from "node:test";
import {
  assertShelfNewerThanFloor,
  floorGeneratedAt,
  packVersionDate,
  shelfGeneratedAt,
} from "./timestamps.mjs";

test("the floor stamp comes from the pack version date", () => {
  assert.equal(packVersionDate("2026.09.04"), "2026-09-04");
  assert.equal(packVersionDate("2026.09.04.4638ceea"), "2026-09-04");
  assert.equal(packVersionDate("nonsense"), null);
  assert.equal(floorGeneratedAt("2026.09.04.4638ceea"), "2026-09-04T00:00:00Z");
});

test("the shelf stamp is the later of the pin date and the floor plus one day", () => {
  assert.equal(
    shelfGeneratedAt({ packVersion: "2026.09.04.4638ceea", pinDate: "2026-09-02T16:25:16Z" }),
    "2026-09-05T00:00:00Z",
  );
  assert.equal(
    shelfGeneratedAt({ packVersion: "2026.09.04", pinDate: "2026-11-20T08:00:00Z" }),
    "2026-11-20T08:00:00Z",
  );
  assert.equal(shelfGeneratedAt({ packVersion: "2026.09.04" }), "2026-09-05T00:00:00Z");
});

test("the shelf stamp beats the floor both as an instant and as a string", () => {
  const floor = floorGeneratedAt("2026.09.04.4638ceea");
  const shelf = shelfGeneratedAt({ packVersion: "2026.09.04.4638ceea", pinDate: "2026-09-02T16:25:16Z" });
  assert.doesNotThrow(() => assertShelfNewerThanFloor(shelf, floor));
  assert.ok(shelf > floor);
});

test("the stale hardcoded shelf stamp is rejected", () => {
  assert.throws(
    () => assertShelfNewerThanFloor("2026-09-02T16:25:16.000Z", "2026-09-04T00:00:00Z"),
    /not in YYYY-MM-DDTHH:MM:SSZ form/,
  );
  assert.throws(
    () => assertShelfNewerThanFloor("2026-09-02T16:25:16Z", "2026-09-04T00:00:00Z"),
    /not strictly newer/,
  );
});

test("a same-instant stamp with millisecond precision is rejected", () => {
  assert.throws(
    () => assertShelfNewerThanFloor("2026-09-04T00:00:00.000Z", "2026-09-04T00:00:00Z"),
    /not in YYYY-MM-DDTHH:MM:SSZ form/,
  );
});

test("an equal stamp is rejected because the app needs a strictly newer catalog", () => {
  assert.throws(
    () => assertShelfNewerThanFloor("2026-09-04T00:00:00Z", "2026-09-04T00:00:00Z"),
    /not strictly newer/,
  );
});
