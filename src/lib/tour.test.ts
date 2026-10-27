// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { START_TOUR_EVENT, startTour, takeUnheardTourStart } from "./tour";

const hear = (event: Event) => event.preventDefault();

afterEach(() => {
  window.removeEventListener(START_TOUR_EVENT, hear);
  takeUnheardTourStart();
});

describe("startTour", () => {
  it("keeps a start nobody heard until the tour guide takes it", () => {
    startTour("workspace");

    const kept = takeUnheardTourStart();
    expect(kept).toBeInstanceOf(CustomEvent);
    expect((kept as CustomEvent).detail).toBe("workspace");
    expect(takeUnheardTourStart()).toBeNull();
  });

  it("keeps nothing once the tour guide heard the start", () => {
    window.addEventListener(START_TOUR_EVENT, hear);

    startTour("home");

    expect(takeUnheardTourStart()).toBeNull();
  });

  it("forgets an unheard start once a later one is heard", () => {
    startTour();
    window.addEventListener(START_TOUR_EVENT, hear);

    startTour("home");

    expect(takeUnheardTourStart()).toBeNull();
  });
});
