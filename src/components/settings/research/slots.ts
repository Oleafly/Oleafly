import { createElement, lazy, Suspense, type ComponentType } from "react";
import { LoadingState } from "@/components/ui/empty";
import { i18n } from "@/i18n";

const ComputeSection = lazy(() =>
  import("./ComputeSection").then((module) => ({ default: module.ComputeSection })),
);

function loadingCard() {
  return createElement(LoadingState, { size: "compact", label: i18n.t(($) => $.common.state.loading) });
}

function ResearchCompute() {
  return createElement(Suspense, { fallback: loadingCard() }, createElement(ComputeSection));
}

export const ResearchComputeSlot: ComponentType | null = ResearchCompute;

const BackgroundTasksCard = lazy(() =>
  import("./BackgroundTasksCard").then((module) => ({ default: module.BackgroundTasksCard })),
);

function ResearchBackground() {
  return createElement(Suspense, { fallback: loadingCard() }, createElement(BackgroundTasksCard));
}

export const ResearchBackgroundSlot: ComponentType | null = ResearchBackground;
