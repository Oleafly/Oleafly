import { afterEach, describe, expect, it } from "vitest";
import {
  clearDocumentScanCache,
  loadDocumentScanCache,
  saveDocumentScanCache,
} from "./scan-cache";

afterEach(() => {
  clearDocumentScanCache();
  localStorage.clear();
});

describe("document scan cache storage failures", () => {
  const CACHE_KEY = "oleafly.document-citation.scan-cache.v1";
  const result = { totalParagraphs: 0, paragraphs: [] };

  it("keeps one entry per key when a scan is saved again", () => {
    saveDocumentScanCache("k", result);
    saveDocumentScanCache("other", result);
    saveDocumentScanCache("k", { totalParagraphs: 2, paragraphs: [] });
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as Array<{ cacheKey: string }>;
    expect(stored.map((entry) => entry.cacheKey)).toEqual(["k", "other"]);
    expect(loadDocumentScanCache("k")).toEqual({ totalParagraphs: 2, paragraphs: [] });
  });

  it("treats a stored value that is not a list or not JSON as empty", () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ cacheKey: "k" }));
    expect(loadDocumentScanCache("k")).toBeNull();
    localStorage.setItem(CACHE_KEY, "{not json");
    expect(loadDocumentScanCache("k")).toBeNull();
    saveDocumentScanCache("k", result);
    expect(loadDocumentScanCache("k")).toEqual(result);
  });

  function withStorage(descriptor: PropertyDescriptor, run: () => void) {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, ...descriptor });
    try {
      run();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
    }
  }

  it("does nothing without storage", () => {
    withStorage({ value: undefined, writable: true }, () => {
      expect(() => saveDocumentScanCache("k", result)).not.toThrow();
      expect(loadDocumentScanCache("k")).toBeNull();
      expect(() => clearDocumentScanCache()).not.toThrow();
    });
    expect(loadDocumentScanCache("k")).toBeNull();
  });

  it("does nothing when storage access is denied", () => {
    withStorage(
      {
        get() {
          throw new Error("denied");
        },
      },
      () => {
        expect(() => saveDocumentScanCache("k", result)).not.toThrow();
        expect(loadDocumentScanCache("k")).toBeNull();
      },
    );
    expect(loadDocumentScanCache("k")).toBeNull();
  });
});
