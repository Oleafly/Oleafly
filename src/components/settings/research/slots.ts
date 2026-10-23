import { createElement, lazy, Suspense, type ComponentType } from "react";
import { LoadingState } from "@/components/ui/empty";
import { i18n } from "@/i18n";

const ComputeSection = lazy(() =>
  import("./ComputeSection").then((module) => ({ default: module.ComputeSection })),
);

/** What a card shows while its code loads, so the section does not flash empty. */
function loadingCard() {
  return createElement(LoadingState, { size: "compact", label: i18n.t(($) => $.common.state.loading) });
}

function ResearchCompute() {
  return createElement(Suspense, { fallback: loadingCard() }, createElement(ComputeSection));
}

/** Remote machines and clusters for task runs, and the local sandbox (loaded when shown). */
export const ResearchComputeSlot: ComponentType | null = ResearchCompute;

// 0.4.8 L: the background helper card, loaded when Settings › Research opens.
const BackgroundTasksCard = lazy(() =>
  import("./BackgroundTasksCard").then((module) => ({ default: module.BackgroundTasksCard })),
);

function ResearchBackground() {
  return createElement(Suspense, { fallback: loadingCard() }, createElement(BackgroundTasksCard));
}

/** Work that continues after Oleafly quits. */
export const ResearchBackgroundSlot: ComponentType | null = ResearchBackground;
