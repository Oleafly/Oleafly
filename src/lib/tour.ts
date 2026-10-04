import type { AvailableTourId } from "@/lib/tours/registry";

export const START_TOUR_EVENT = "oleafly:start-tour";

export function startTour(tourId?: AvailableTourId) {
  window.dispatchEvent(
    tourId === undefined
      ? new Event(START_TOUR_EVENT)
      : new CustomEvent(START_TOUR_EVENT, { detail: tourId }),
  );
}
