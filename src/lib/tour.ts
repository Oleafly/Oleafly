export const START_TOUR_EVENT = "oleafly:start-tour";

export function startTour() {
  window.dispatchEvent(new Event(START_TOUR_EVENT));
}
