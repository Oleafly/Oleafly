import type { TourId } from "@/lib/tours/registry";

export const START_TOUR_EVENT = "oleafly:start-tour";

export function startTour(tourId?: TourId) {
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: tourId }));
}
