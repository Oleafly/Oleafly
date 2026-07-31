import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_CITATION_SETTINGS,
  loadDocumentCitationSettings,
  saveDocumentCitationSettings,
} from "./settings";

const STORAGE_KEY = "oleafly.document-citation.settings.v1";

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("document-citation settings", () => {
  it("returns defaults when storage is empty", () => {
    expect(loadDocumentCitationSettings()).toEqual(DEFAULT_DOCUMENT_CITATION_SETTINGS);
    expect(loadDocumentCitationSettings().scoreThreshold).toBe(60);
    expect(loadDocumentCitationSettings().maxResultsPerSource).toBe(8);
    expect(loadDocumentCitationSettings().maxResultsPerParagraph).toBe(5);
    expect(loadDocumentCitationSettings().maxParagraphs).toBe(20);
  });

  it("persists threshold", () => {
    saveDocumentCitationSettings({ scoreThreshold: 70 });
    expect(loadDocumentCitationSettings().scoreThreshold).toBe(70);
  });

  it("merges partial updates with existing values", () => {
    saveDocumentCitationSettings({ scoreThreshold: 70, maxParagraphs: 10 });
    saveDocumentCitationSettings({ maxResultsPerSource: 12 });
    const s = loadDocumentCitationSettings();
    expect(s.scoreThreshold).toBe(70);
    expect(s.maxResultsPerSource).toBe(12);
    expect(s.maxParagraphs).toBe(10);
    expect(s.maxResultsPerParagraph).toBe(5);
  });

  it("clamps scoreThreshold to 0–100", () => {
    saveDocumentCitationSettings({ scoreThreshold: -5 });
    expect(loadDocumentCitationSettings().scoreThreshold).toBe(0);
    saveDocumentCitationSettings({ scoreThreshold: 150 });
    expect(loadDocumentCitationSettings().scoreThreshold).toBe(100);
  });

  it("clamps maxResultsPerSource to 1–25", () => {
    saveDocumentCitationSettings({ maxResultsPerSource: 0 });
    expect(loadDocumentCitationSettings().maxResultsPerSource).toBe(1);
    saveDocumentCitationSettings({ maxResultsPerSource: 40 });
    expect(loadDocumentCitationSettings().maxResultsPerSource).toBe(25);
  });

  it("clamps maxResultsPerParagraph to 1–20", () => {
    saveDocumentCitationSettings({ maxResultsPerParagraph: 0 });
    expect(loadDocumentCitationSettings().maxResultsPerParagraph).toBe(1);
    saveDocumentCitationSettings({ maxResultsPerParagraph: 99 });
    expect(loadDocumentCitationSettings().maxResultsPerParagraph).toBe(20);
  });

  it("clamps maxParagraphs to 1–40", () => {
    saveDocumentCitationSettings({ maxParagraphs: 0 });
    expect(loadDocumentCitationSettings().maxParagraphs).toBe(1);
    saveDocumentCitationSettings({ maxParagraphs: 100 });
    expect(loadDocumentCitationSettings().maxParagraphs).toBe(40);
  });

  it("ignores corrupt JSON and returns defaults", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(loadDocumentCitationSettings()).toEqual(DEFAULT_DOCUMENT_CITATION_SETTINGS);
  });

  it("ignores non-numeric fields from storage", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ scoreThreshold: "high", maxResultsPerSource: 3 }),
    );
    const s = loadDocumentCitationSettings();
    expect(s.scoreThreshold).toBe(60);
    expect(s.maxResultsPerSource).toBe(3);
  });
});
