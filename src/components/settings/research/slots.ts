import { createElement, lazy, Suspense, type ComponentType } from "react";

const ComputeSection = lazy(() =>
  import("./ComputeSection").then((module) => ({ default: module.ComputeSection })),
);

function ResearchCompute() {
  return createElement(Suspense, { fallback: null }, createElement(ComputeSection));
}

/** Remote machines and clusters for task runs, and the local sandbox (loaded when shown). */
export const ResearchComputeSlot: ComponentType | null = ResearchCompute;

// 0.4.8 L: the background helper card, loaded when Settings › Research opens.
const BackgroundTasksCard = lazy(() =>
  import("./BackgroundTasksCard").then((module) => ({ default: module.BackgroundTasksCard })),
);

function ResearchBackground() {
  return createElement(Suspense, { fallback: null }, createElement(BackgroundTasksCard));
}

/** Work that continues after Oleafly quits. */
export const ResearchBackgroundSlot: ComponentType | null = ResearchBackground;
