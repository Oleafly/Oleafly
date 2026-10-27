import type { AvailableTourId } from "@/lib/tours/registry";

export const START_TOUR_EVENT = "oleafly:start-tour";

// The tour guide mounts only once it has work, so a start can come before it
// listens. The guide cancels every start it hears; one nobody heard waits here
// until the guide mounts and takes it.
let unheardStart: Event | null = null;

export function startTour(tourId?: AvailableTourId) {
  const event =
    tourId === undefined
      ? new Event(START_TOUR_EVENT, { cancelable: true })
      : new CustomEvent(START_TOUR_EVENT, { detail: tourId, cancelable: true });
  unheardStart = window.dispatchEvent(event) ? event : null;
}

export function takeUnheardTourStart(): Event | null {
  const event = unheardStart;
  unheardStart = null;
  return event;
}
