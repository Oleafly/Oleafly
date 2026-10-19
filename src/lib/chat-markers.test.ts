import { describe, expect, it } from "vitest";
import {
  appendMarker,
  localizeMarkers,
  OUTPUT_LIMIT_MARKER,
  STEP_LIMIT_MARKER,
  STOPPED_MARKER,
} from "./chat-markers";

const labels = { stopped: "Angehalten.", stepLimit: "Schrittlimit erreicht.", outputLimit: "Ausgabelimit." };

describe("chat markers", () => {
  it("appends a marker as its own paragraph", () => {
    expect(appendMarker("Started.", STOPPED_MARKER)).toBe("Started.\n\n_Stopped._");
    expect(appendMarker("", STOPPED_MARKER)).toBe("_Stopped._");
  });

  it("shows stored markers in the reader's language", () => {
    expect(localizeMarkers("Started.\n\n_Stopped._", labels)).toBe("Started.\n\n_Angehalten._");
    expect(localizeMarkers(`x\n\n${STEP_LIMIT_MARKER}`, labels)).toBe("x\n\n_Schrittlimit erreicht._");
    expect(localizeMarkers(OUTPUT_LIMIT_MARKER, labels)).toBe("_Ausgabelimit._");
  });

  it("leaves marker text that is part of a longer paragraph alone", () => {
    const text = "The log said _Stopped._ at line 4.";
    expect(localizeMarkers(text, labels)).toBe(text);
  });
});
