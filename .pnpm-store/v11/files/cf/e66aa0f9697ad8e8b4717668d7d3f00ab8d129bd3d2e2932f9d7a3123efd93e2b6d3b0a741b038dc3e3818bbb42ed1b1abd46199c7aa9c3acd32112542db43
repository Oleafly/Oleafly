'use client';
import { CSSProperties, ElementType, MouseEventHandler, ReactElement, ReactNode, RefObject, SVGAttributes } from "react";
import { AutoUpdateOptions, FlipOptions, Middleware, MiddlewareData, ShiftOptions, Strategy } from "@floating-ui/react-dom";

//#region src/literals/index.d.ts
declare const ACTIONS: {
  readonly INIT: "init";
  readonly START: "start";
  readonly STOP: "stop";
  readonly RESET: "reset";
  readonly PREV: "prev";
  readonly NEXT: "next";
  readonly GO: "go";
  readonly CLOSE: "close";
  readonly SKIP: "skip";
  readonly REPLAY: "replay";
  readonly UPDATE: "update";
  readonly COMPLETE: "complete";
};
declare const EVENTS: {
  readonly TOUR_START: "tour:start";
  readonly STEP_BEFORE_HOOK: "step:before_hook";
  readonly STEP_BEFORE: "step:before";
  readonly SCROLL_START: "scroll:start";
  readonly SCROLL_END: "scroll:end";
  readonly BEACON: "beacon";
  readonly TOOLTIP: "tooltip";
  readonly STEP_AFTER: "step:after";
  readonly STEP_AFTER_HOOK: "step:after_hook";
  readonly TOUR_END: "tour:end";
  readonly TOUR_STATUS: "tour:status";
  readonly TARGET_NOT_FOUND: "error:target_not_found";
  readonly ERROR: "error";
};
declare const LIFECYCLE: {
  readonly INIT: "init";
  readonly READY: "ready";
  readonly BEACON_BEFORE: "beacon_before";
  readonly BEACON: "beacon";
  readonly TOOLTIP_BEFORE: "tooltip_before";
  readonly TOOLTIP: "tooltip";
  readonly COMPLETE: "complete";
};
declare const ORIGIN: {
  readonly BUTTON_BACK: "button_back";
  readonly BUTTON_CLOSE: "button_close";
  readonly BUTTON_PRIMARY: "button_primary";
  readonly BUTTON_SKIP: "button_skip";
  readonly KEYBOARD: "keyboard";
  readonly OVERLAY: "overlay";
};
declare const STATUS: {
  readonly IDLE: "idle";
  readonly READY: "ready";
  readonly WAITING: "waiting";
  readonly RUNNING: "running";
  readonly PAUSED: "paused";
  readonly SKIPPED: "skipped";
  readonly FINISHED: "finished";
};
declare const PORTAL_ELEMENT_ID = "react-joyride-portal";
//#endregion
//#region src/types/state.d.ts
/** Methods to programmatically control the tour. */
type Controls = {
  /** Close the current step and advance to the next one. */close: (origin?: Origin | null) => void; /** Jump to a specific step by index. */
  go: (nextIndex: number) => void; /** Get the current tour state. */
  info: () => State; /** Advance to the next step. */
  next: (origin?: Origin | null) => void; /** Open the tooltip for the current step. */
  open: () => void; /** Go back to the previous step. */
  prev: (origin?: Origin | null) => void; /** Replay the current step. Re-runs `before` and `after` hooks and re-emits step lifecycle events. */
  replay: (origin?: Origin | null) => void; /** Reset the tour. Optionally restart from the beginning. */
  reset: (restart?: boolean) => void; /** Skip the tour entirely. */
  skip: (origin?: Extract<Origin, 'button_close' | 'button_skip'> | null) => void; /** Start the tour at an optional step index. */
  start: (nextIndex?: number) => void; /** Stop the tour. Optionally advance to the next step before stopping. */
  stop: (advance?: boolean) => void;
};
/** The internal tour state. */
type State = {
  /** The action that triggered the state update. */action: Actions; /** Whether the tour is in controlled mode (using `stepIndex`). */
  controlled: boolean; /** The current step index. */
  index: number; /** The step's rendering phase. */
  lifecycle: Lifecycle; /** The UI element that triggered the last action. */
  origin: Origin | null; /** Whether the tour is scrolling to a target. */
  scrolling: boolean; /** The total number of steps. */
  size: number; /** The tour's current status. */
  status: Status; /** Whether the tour is blocked waiting for a `before` hook or target to appear. */
  waiting: boolean;
};
//#endregion
//#region src/types/utilities.d.ts
/** Generic record type. */
type AnyObject<T = any> = Record<string, T>;
/** Excludes arrays, functions, Map, and Set from a record type. */
type NarrowPlainObject<T extends Record<string, any>> = Exclude<T, Array<unknown> | Function | Map<unknown, unknown> | Set<unknown>>;
/** Makes all properties optional, with one level of depth for nested objects. */
type PartialDeep<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
/** Generic record type with unknown values. */
type PlainObject<T = unknown> = Record<string, T>;
/** Makes specific keys required while keeping others unchanged. */
type SetRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
/** Flattens intersection types for better IDE display. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** Extracts a union of all values from an object type. */
type ValueOf<T> = T[keyof T];
//#endregion
//#region src/types/components.d.ts
/** Props passed to a custom arrow component. */
type ArrowRenderProps = {
  /** Width of the arrow base in pixels. */base: number; /** The computed placement of the tooltip. */
  placement: Placement; /** Height of the arrow in pixels. */
  size: number;
};
/** Props passed to a custom beacon component.
 * Must render a span since it's placed inside a `<button>` wrapper.
 */
type BeaconRenderProps = {
  /** Whether the tour is in continuous mode. */continuous: boolean; /** The current step index. */
  index: number; /** Whether this is the last step. */
  isLastStep: boolean; /** The total number of steps. */
  size: number; /** The current step data. */
  step: StepMerged;
};
/** Props passed to a custom loader component. */
type LoaderRenderProps = {
  /** The current step data. */step: StepMerged;
};
/** Props passed to a custom tooltip component. */
type TooltipRenderProps = Simplify<BeaconRenderProps & {
  /** Props to spread on the back button. */backProps: {
    'aria-label': string;
    'data-action': string;
    onClick: MouseEventHandler<HTMLElement>;
    role: string;
    title: string;
  }; /** Props to spread on the close button. */
  closeProps: {
    'aria-label': string;
    'data-action': string;
    onClick: MouseEventHandler<HTMLElement>;
    role: string;
    title: string;
  }; /** Methods to programmatically control the tour. */
  controls: Controls; /** Props to spread on the next/last button. */
  primaryProps: {
    'aria-label': string;
    'data-action': string;
    onClick: MouseEventHandler<HTMLElement>;
    role: string;
    title: string;
  }; /** Props to spread on the skip button. */
  skipProps: {
    'aria-label': string;
    'data-action': string;
    onClick: MouseEventHandler<HTMLElement>;
    role: string;
    title: string;
  }; /** Props to spread on the tooltip container. */
  tooltipProps: {
    'aria-modal': boolean;
    role: string;
  };
}>;
//#endregion
//#region src/types/floating.d.ts
/** Tooltip and beacon positioning configuration using Floating UI. */
interface FloatingOptions {
  /**
   * Options passed to autoUpdate (ancestorScroll, elementResize, animationFrame, etc).
   */
  autoUpdate?: Partial<AutoUpdateOptions>;
  /**
   * Beacon positioning config.
   */
  beaconOptions?: {
    offset?: number;
  };
  /**
   * Options for the flip middleware, or `false` to disable flipping.
   * Defaults: crossAxis false, padding 20, smart fallbackPlacements for left/right.
   */
  flipOptions?: Partial<FlipOptions> | false;
  /**
   * Hide the arrow element.
   * Centered placement already hides the arrow.
   *
   * @default false
   */
  hideArrow?: boolean;
  /**
   * Additional Floating UI middleware appended to defaults (offset, flip/autoPlacement, shift, arrow).
   */
  middleware?: Array<Middleware>;
  /**
   * Called after each position calculation.
   */
  onPosition?: (data: PositionData) => void;
  /**
   * Options for the shift middleware.
   * Default: padding 10.
   */
  shiftOptions?: Partial<ShiftOptions>;
  /**
   * Positioning strategy.
   * Defaults to 'fixed' when step.isFixed is true, 'absolute' otherwise.
   */
  strategy?: Strategy;
}
/** Computed position data returned by Floating UI after each calculation. */
interface PositionData {
  middlewareData: MiddlewareData;
  placement: Placement;
  x: number;
  y: number;
}
//#endregion
//#region src/types/props.d.ts
type Props = Simplify<SharedProps & {
  /**
   * The tour is played sequentially with the Next button.
   * @default false
   */
  continuous?: boolean;
  /**
   * Log Joyride's actions to the console.
   * @default false
   */
  debug?: boolean;
  /**
   * The initial step index for uncontrolled tours.
   * Ignored when stepIndex is set (controlled mode).
   * @default 0
   */
  initialStepIndex?: number;
  /**
   * A nonce value for inline styles (Content Security Policy).
   */
  nonce?: string;
  /**
   * A function called when Joyride fires an event.
   */
  onEvent?: EventHandler;
  /**
   * Default options for all steps.
   */
  options?: Partial<Options>;
  /**
   * Render all Joyride components inside a specific element.
   */
  portalElement?: SelectorOrElement;
  /**
   * Run/stop the tour.
   * @default false
   */
  run?: boolean;
  /**
   * Scroll the page for the first step.
   * @default false
   */
  scrollToFirstStep?: boolean;
  /**
   * Setting a number here will turn Joyride into `controlled` mode.
   * You'll have to keep an internal state by yourself and update it with the events in `onEvent`.
   */
  stepIndex?: number;
  /**
   * The tour's steps.
   */
  steps: Array<Step>;
}>;
/** Shared configuration inherited by both `Props` and `Step`. */
type SharedProps = {
  /**
   * Custom Arrow component.
   */
  arrowComponent?: ElementType<ArrowRenderProps>;
  /**
   * Custom Beacon component.
   */
  beaconComponent?: ElementType<BeaconRenderProps>;
  /**
   * Options for the floating tooltip positioning.
   */
  floatingOptions?: Partial<FloatingOptions>;
  /**
   * Custom Loader component. Set to `null` to disable.
   */
  loaderComponent?: ElementType<LoaderRenderProps> | null;
  /**
   * The strings used in the tooltip.
   */
  locale?: Locale;
  /**
   * Override the styling of the Tooltip.
   */
  styles?: PartialDeep<Styles>;
  /**
   * Custom Tooltip component.
   */
  tooltipComponent?: ElementType<TooltipRenderProps>;
};
/** Return value of the `useJoyride` hook. */
type UseJoyrideReturn = {
  /** Methods to programmatically control the tour. */controls: Controls; /** Steps that failed during the current tour run (target not found, before hook errors). Clears on start/reset. */
  failures: StepFailure[]; /** Subscribe to a specific event type. Returns an unsubscribe function. */
  on: (eventType: Events, handler: EventHandler) => () => void; /** The current tour state. */
  state: State; /** The current merged step, or null if no step is active. */
  step: StepMerged | null; /** The tour React element to render. */
  Tour: ReactElement | null;
};
/** A step that failed during the tour. */
interface StepFailure {
  reason: FailureReason;
  step: StepMerged;
}
//#endregion
//#region src/types/step.d.ts
/** A CSS selector string, an HTMLElement, or null. */
type SelectorOrElement = string | null | HTMLElement;
/** A single step in the tour, provided by the user. */
type Step = Simplify<SharedProps & Partial<Options> & {
  /**
   * The placement of the beacon. It will use the `placement` if nothing is passed.
   */
  beaconPlacement?: Placement;
  /**
   * The tooltip's body.
   */
  content: ReactNode;
  /**
   * Additional data you can add to the step.
   */
  data?: any;
  /**
   * A unique identifier for the step.
   */
  id?: string;
  /**
   * Force the step to be fixed.
   * @default false
   */
  isFixed?: boolean;
  /**
   * The placement of the beacon and tooltip. It will re-position itself if there's no space available.
   * @default bottom
   */
  placement?: Placement | 'auto' | 'center';
  /**
   * An optional element to scroll to instead of the target.
   * The spotlight and tooltip will still use `target`.
   */
  scrollTarget?: StepTarget;
  /**
   * An optional element to highlight instead of the target.
   * The tooltip will still anchor to `target`.
   */
  spotlightTarget?: StepTarget;
  /**
   * The target for the step.
   * It can be a CSS selector, an HTMLElement, a React ref, or a function that returns an element.
   */
  target: StepTarget;
  /**
   * The tooltip's title.
   */
  title?: ReactNode;
}>;
/** A normalized step with all defaults applied. */
type StepMerged = Simplify<SetRequired<Step, 'arrowBase' | 'arrowColor' | 'arrowSize' | 'arrowSpacing' | 'backgroundColor' | 'beaconSize' | 'beaconTrigger' | 'beforeTimeout' | 'buttons' | 'closeButtonAction' | 'skipBeacon' | 'dismissKeyAction' | 'disableFocusTrap' | 'hideOverlay' | 'skipScroll' | 'blockTargetInteraction' | 'isFixed' | 'loaderDelay' | 'locale' | 'offset' | 'overlayClickAction' | 'overlayColor' | 'placement' | 'primaryColor' | 'scrollDuration' | 'scrollOffset' | 'showProgress' | 'spotlightRadius' | 'targetWaitTimeout' | 'textColor' | 'zIndex'> & {
  spotlightPadding: Required<SpotlightPadding>;
  styles: Styles;
}>;
type StepTarget = string | HTMLElement | RefObject<HTMLElement | null> | (() => HTMLElement | null);
//#endregion
//#region src/types/events.d.ts
/** The payload passed to the `onEvent` callback. Extends `TourData` with event-specific fields. */
type EventData = Simplify<TourData & {
  /**
   * The error that occurred (only populated for ERROR events).
   */
  error: Error | null;
  /**
   * Scroll data (only populated for SCROLL_START/SCROLL_END events).
   */
  scroll: ScrollData | null;
  /**
   * Whether the tour is currently scrolling to a target.
   */
  scrolling: boolean;
  /**
   * The type of the event.
   */
  type: Events;
  /**
   * Whether the tour is blocked waiting for a before hook or target to appear.
   */
  waiting: boolean;
}>;
/** Callback signature for the `onEvent` prop. */
type EventHandler = (data: EventData, controls: Controls) => void;
/** Scroll position details for `scroll:start` and `scroll:end` events. */
type ScrollData = {
  /**
   * The scroll duration in milliseconds.
   */
  duration: number;
  /**
   * The element being scrolled.
   */
  element: Element;
  /**
   * The scroll position before scrolling.
   */
  initial: number;
  /**
   * The computed scroll destination.
   */
  target: number;
};
/** Base event payload with tour state at the time of the event. */
interface TourData {
  /**
   * The action that triggered the state update.
   */
  action: Actions;
  /**
   * Whether the tour is in `controlled` mode (using the `stepIndex` prop).
   */
  controlled: boolean;
  /**
   * The current step's index.
   */
  index: number;
  /**
   * The step's rendering phase.
   */
  lifecycle: Lifecycle;
  /**
   * The UI element that triggered the action (if available).
   */
  origin: Origin | null;
  /**
   * The total number of steps.
   */
  size: number;
  /**
   * The tour's current status.
   */
  status: Status;
  /**
   * The current step's data.
   */
  step: StepMerged;
}
//#endregion
//#region src/types/common.d.ts
/** The action that triggered the state update. */
type Actions = ValueOf<typeof ACTIONS>;
/** A hook that runs after a step completes. Fire-and-forget. */
type AfterHook = (data: TourData) => void;
/** A hook that runs before a step is shown. The tour waits for the promise to resolve. */
type BeforeHook = (data: TourData) => Promise<void>;
/** The buttons to show in the tooltip. */
type ButtonType = 'back' | 'close' | 'primary' | 'skip';
/** The event type passed to the `onEvent` callback. */
type Events = ValueOf<typeof EVENTS>;
/** The reason a step failed during the tour. */
type FailureReason = 'before_hook' | 'target_not_found';
/** The rendering phase of the current step. */
type Lifecycle = ValueOf<typeof LIFECYCLE>;
/** The UI element that triggered the action. */
type Origin = ValueOf<typeof ORIGIN>;
/** Tooltip and beacon placement positions. */
type Placement = 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end' | 'left' | 'left-start' | 'left-end' | 'right' | 'right-start' | 'right-end';
/** The current state of the tour. */
type Status = ValueOf<typeof STATUS>;
/** Tooltip button and navigation labels. */
interface Locale {
  /**
   * Label for the back button.
   * @default 'Back'
   */
  back?: ReactNode;
  /**
   * Label for the close button.
   * @default 'Close'
   */
  close?: ReactNode;
  /**
   * Label for the last button.
   * @default 'Last'
   */
  last?: ReactNode;
  /**
   * Label for the next button.
   * @default 'Next'
   */
  next?: ReactNode;
  /**
   * Label for the next button with `showProgress`.
   * Use the `{current}` and `{total}` placeholders to display the current step and the total steps.
   * @default 'Next ({current} of {total})'
   */
  nextWithProgress?: ReactNode;
  /**
   * Label for the open button.
   * @default 'Open the dialog'
   */
  open?: ReactNode;
  /**
   * Label for the skip button.
   * @default 'Skip'
   */
  skip?: ReactNode;
}
/** Step options for behavior, theming, and layout. Shared between Props and Step. */
interface Options {
  /**
   * A hook that runs after the step completes (user clicked next, prev, close, or skip).
   * Fire-and-forget — does not block the tour.
   */
  after?: AfterHook;
  /**
   * Width of the arrow base edge in pixels.
   * @default 32
   */
  arrowBase: number;
  /**
   * Arrow fill color.
   * @default '#ffffff'
   */
  arrowColor: string;
  /**
   * Height/depth of the arrow (tip to base edge) in pixels.
   * @default 16
   */
  arrowSize: number;
  /**
   * The distance between the arrow and the edge of the tooltip.
   * @default 12
   */
  arrowSpacing: number;
  /**
   * Tooltip background color.
   * @default '#ffffff'
   */
  backgroundColor: string;
  /**
   * Beacon diameter in pixels.
   * @default 36
   */
  beaconSize: number;
  /**
   * The interaction that triggers the beacon to show the tooltip.
   * @default 'click'
   */
  beaconTrigger: 'click' | 'hover';
  /**
   * A hook that runs before the step is shown.
   * The tour waits for the returned promise to resolve and shows the loader while waiting (after `loaderDelay`).
   * Max duration capped by `beforeTimeout`.
   */
  before?: BeforeHook;
  /**
   * Max time (ms) to wait for a `before` hook to resolve. 0 = no timeout.
   * @default 5000
   */
  beforeTimeout: number;
  /**
   * Block pointer events on the highlighted element through the spotlight cutout.
   * @default false
   */
  blockTargetInteraction: boolean;
  /**
   * The buttons to show in the tooltip.
   * @default ['back', 'close', 'primary']
   */
  buttons: ButtonType[];
  /**
   * The action to take when the close button is clicked.
   * - `'close'`: Advances to the next step (default behavior).
   * - `'skip'`: Ends the tour entirely.
   * - `'replay'`: Replays the current step.
   * @default 'close'
   */
  closeButtonAction: 'close' | 'skip' | 'replay';
  /**
   * Disable the focus trap for the tooltip.
   * @default false
   */
  disableFocusTrap: boolean;
  /**
   * The action to take when the ESC key is pressed.
   * - `'close'`: Closes the step (shows beacon on next step in continuous mode).
   * - `'next'`: Advances to the next step (skips beacon in continuous mode).
   * - `'replay'`: Replays the current step.
   * - `false`: Disables ESC key.
   * @default 'close'
   */
  dismissKeyAction: 'close' | 'next' | 'replay' | false;
  /**
   * Don't show the overlay.
   * @default false
   */
  hideOverlay: boolean;
  /**
   * Delay (ms) before showing the loader while the tour is waiting.
   * @default 300
   */
  loaderDelay: number;
  /**
   * The distance in pixels between the tooltip and the spotlight.
   * @default 10
   */
  offset: number;
  /**
   * The action to take when the overlay is clicked.
   * - `'close'`: Closes the step (fires a CLOSE action).
   * - `'next'`: Advances to the next step (ends the tour on the last step).
   * - `'replay'`: Replays the current step.
   * - `false`: Disables overlay click.
   * @default 'close'
   */
  overlayClickAction: 'close' | 'next' | 'replay' | false;
  /**
   * Overlay backdrop color.
   * @default '#00000080'
   */
  overlayColor: string;
  /**
   * Primary button and beacon color.
   * @default '#000000'
   */
  primaryColor: string;
  /**
   * The scroll animation duration in milliseconds.
   * @default 300
   */
  scrollDuration: number;
  /**
   * The scroll distance from the element scrollTop value.
   * @default 20
   */
  scrollOffset: number;
  /**
   * Show the progress (1 of 5) in the tooltip.
   * @default false
   */
  showProgress: boolean;
  /**
   * Don't show the Beacon before the tooltip.
   * @default false
   */
  skipBeacon: boolean;
  /**
   * Skip scrolling to the target.
   * @default false
   */
  skipScroll: boolean;
  /**
   * The padding of the spotlight.
   * Accepts a number for equal padding on all sides, or an object with `top`, `right`, `bottom`, `left`.
   * @default 10
   */
  spotlightPadding: number | SpotlightPadding;
  /**
   * The border radius of the spotlight cutout in pixels.
   * @default 4
   */
  spotlightRadius: number;
  /**
   * Max time (ms) to wait for the target to appear. 0 = no waiting.
   * @default 1000
   */
  targetWaitTimeout: number;
  /**
   * Tooltip text color.
   * @default '#000000'
   */
  textColor: string;
  /**
   * Tooltip width in pixels or CSS string.
   * @default 380
   */
  width?: string | number;
  /**
   * z-index for the overlay and tooltip.
   * @default 100
   */
  zIndex: number;
}
/** Padding around the spotlight cutout in pixels. */
interface SpotlightPadding {
  bottom?: number;
  left?: number;
  right?: number;
  top?: number;
}
/** CSS styles for all Joyride UI elements. */
interface Styles {
  /** Arrow element styles. */
  arrow: CSSProperties;
  /** Beacon visual styles (size, border-radius). Applied to the default beacon content. */
  beacon: CSSProperties;
  /** Beacon inner pulse element styles. */
  beaconInner: CSSProperties;
  /** Beacon outer ring element styles. */
  beaconOuter: CSSProperties;
  /** Beacon wrapper button styles (interaction, layout). */
  beaconWrapper: CSSProperties;
  /** Back button styles. */
  buttonBack: CSSProperties;
  /** Close button styles. */
  buttonClose: CSSProperties;
  /** Next/Last button styles. */
  buttonPrimary: CSSProperties;
  /** Skip button styles. */
  buttonSkip: CSSProperties;
  /** Floating container styles. */
  floater: CSSProperties;
  /** Loader wrapper styles. */
  loader: CSSProperties;
  /** Overlay backdrop styles. */
  overlay: CSSProperties;
  /** Spotlight styles (SVG Path). */
  spotlight: SVGAttributes<SVGPathElement>;
  /** Tooltip wrapper styles. */
  tooltip: CSSProperties;
  /** Tooltip inner container styles. */
  tooltipContainer: CSSProperties;
  /** Tooltip body content styles. */
  tooltipContent: CSSProperties;
  /** Tooltip footer styles. */
  tooltipFooter: CSSProperties;
  /** Tooltip footer spacer styles. */
  tooltipFooterSpacer: CSSProperties;
  /** Tooltip title styles. */
  tooltipTitle: CSSProperties;
}
//#endregion
//#region src/defaults.d.ts
declare const defaultOptions: Required<Omit<Options, 'after' | 'before'>>;
declare const defaultLocale: Locale;
//#endregion
//#region src/hooks/useJoyride.d.ts
declare function useJoyride(props: Props): UseJoyrideReturn;
//#endregion
//#region src/index.d.ts
declare function Joyride(props: Props): import("react").JSX.Element | null;
//#endregion
export { ACTIONS, Actions, AfterHook, AnyObject, ArrowRenderProps, BeaconRenderProps, BeforeHook, ButtonType, Controls, EVENTS, EventData, EventHandler, Events, FailureReason, FloatingOptions, Joyride, LIFECYCLE, Lifecycle, LoaderRenderProps, Locale, NarrowPlainObject, ORIGIN, Options, Origin, PORTAL_ELEMENT_ID, PartialDeep, Placement, PlainObject, PositionData, Props, STATUS, ScrollData, SelectorOrElement, SetRequired, SharedProps, Simplify, SpotlightPadding, State, Status, Step, StepFailure, StepMerged, StepTarget, Styles, TooltipRenderProps, TourData, UseJoyrideReturn, ValueOf, defaultLocale, defaultOptions, useJoyride };
//# sourceMappingURL=index.d.mts.map