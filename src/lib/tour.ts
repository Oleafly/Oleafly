export const START_TOUR_EVENT = "oleafly:start-tour";

export function startTour(tourId?: "home" | "workspace" | "settings" | "ai" | "diagram") {
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: tourId }));
}
