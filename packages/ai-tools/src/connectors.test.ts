import { describe, it, expect, beforeEach } from "vitest";
import { registerConnector, listConnectors, getConnector, type ConnectorManifest, _clearRegistry } from "./connectors";

const sample: ConnectorManifest = {
  id: "alphaxiv",
  name: "alphaXiv",
  capability: "read",
  auth: "api-key",
  docsUrl: "https://www.alphaxiv.org/assistant",
  toolNames: ["alphaxiv_search", "alphaxiv_paper_content"],
};

describe("connector registry", () => {
  beforeEach(() => {
    // Registry state is module-level and persists within a test file, so reset it for each test.
    _clearRegistry();
  });

  it("registers a connector and lists it back", () => {
    registerConnector(sample);
    expect(listConnectors()).toContainEqual(sample);
  });

  it("looks up a connector by id", () => {
    registerConnector(sample);
    expect(getConnector("alphaxiv")).toEqual(sample);
    expect(getConnector("does-not-exist")).toBeUndefined();
  });

  it("rejects registering the same id twice", () => {
    registerConnector(sample);
    expect(() => registerConnector(sample)).toThrow(/already registered/);
  });
});
