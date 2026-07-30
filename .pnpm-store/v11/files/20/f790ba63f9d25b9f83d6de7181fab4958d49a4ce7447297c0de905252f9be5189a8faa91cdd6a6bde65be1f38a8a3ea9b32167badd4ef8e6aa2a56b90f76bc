'use client';
import React, { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMemoDeepCompare, useMount, usePrevious, useUpdateEffect, useWindowSize } from "@gilbarbara/hooks";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import is from "is-lite";
import innerText from "react-innertext";
import deepmergeFactory from "@fastify/deepmerge";
import deepEqual from "@gilbarbara/deep-equal";
import scroll from "scroll";
import scrollParent from "scrollparent";
import { createPortal } from "react-dom";
import { arrow, autoPlacement, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react-dom";
//#region src/defaults.ts
const defaultOptions = {
	arrowBase: 32,
	arrowColor: "#ffffff",
	arrowSize: 16,
	arrowSpacing: 12,
	backgroundColor: "#ffffff",
	beaconSize: 36,
	beaconTrigger: "click",
	beforeTimeout: 5e3,
	blockTargetInteraction: false,
	buttons: [
		"back",
		"close",
		"primary"
	],
	closeButtonAction: "close",
	disableFocusTrap: false,
	dismissKeyAction: "close",
	hideOverlay: false,
	loaderDelay: 300,
	offset: 10,
	overlayClickAction: "close",
	overlayColor: "#00000080",
	primaryColor: "#000000",
	scrollDuration: 300,
	scrollOffset: 20,
	showProgress: false,
	skipBeacon: false,
	skipScroll: false,
	spotlightPadding: 10,
	spotlightRadius: 4,
	targetWaitTimeout: 1e3,
	textColor: "#000000",
	width: 380,
	zIndex: 100
};
const defaultFloatingOptions = { beaconOptions: { offset: -18 } };
const defaultLocale = {
	back: "Back",
	close: "Close",
	last: "Last",
	next: "Next",
	nextWithProgress: "Next ({current} of {total})",
	open: "Open the dialog",
	skip: "Skip"
};
const defaultStep = {
	isFixed: false,
	locale: defaultLocale,
	placement: "bottom"
};
const defaultProps = {
	continuous: false,
	debug: false,
	run: false,
	scrollToFirstStep: false,
	steps: []
};
//#endregion
//#region src/literals/index.ts
const ACTIONS = {
	INIT: "init",
	START: "start",
	STOP: "stop",
	RESET: "reset",
	PREV: "prev",
	NEXT: "next",
	GO: "go",
	CLOSE: "close",
	SKIP: "skip",
	REPLAY: "replay",
	UPDATE: "update",
	COMPLETE: "complete"
};
const EVENTS = {
	TOUR_START: "tour:start",
	STEP_BEFORE_HOOK: "step:before_hook",
	STEP_BEFORE: "step:before",
	SCROLL_START: "scroll:start",
	SCROLL_END: "scroll:end",
	BEACON: "beacon",
	TOOLTIP: "tooltip",
	STEP_AFTER: "step:after",
	STEP_AFTER_HOOK: "step:after_hook",
	TOUR_END: "tour:end",
	TOUR_STATUS: "tour:status",
	TARGET_NOT_FOUND: "error:target_not_found",
	ERROR: "error"
};
const LIFECYCLE = {
	INIT: "init",
	READY: "ready",
	BEACON_BEFORE: "beacon_before",
	BEACON: "beacon",
	TOOLTIP_BEFORE: "tooltip_before",
	TOOLTIP: "tooltip",
	COMPLETE: "complete"
};
const ORIGIN = {
	BUTTON_BACK: "button_back",
	BUTTON_CLOSE: "button_close",
	BUTTON_PRIMARY: "button_primary",
	BUTTON_SKIP: "button_skip",
	KEYBOARD: "keyboard",
	OVERLAY: "overlay"
};
const STATUS = {
	IDLE: "idle",
	READY: "ready",
	WAITING: "waiting",
	RUNNING: "running",
	PAUSED: "paused",
	SKIPPED: "skipped",
	FINISHED: "finished"
};
const PORTAL_ELEMENT_ID = "react-joyride-portal";
//#endregion
//#region src/modules/helpers.tsx
/**
* Remove properties with undefined value from an object
*/
function cleanUpObject(input) {
	const output = {};
	for (const key in input) if (input[key] !== void 0) output[key] = input[key];
	return output;
}
function deepMerge(...objects) {
	return deepmergeFactory({
		all: true,
		isMergeableObject: (value) => !(!is.plainObject(value) || isValidElement(value))
	})(...objects);
}
/**
* Get Object type
*/
function getObjectType(value) {
	return Object.prototype.toString.call(value).slice(8, -1).toLowerCase();
}
function getReactNodeText(input, options = {}) {
	const { defaultValue, step, steps } = options;
	let text = innerText(input);
	if (!text) if (isValidElement(input) && !Object.values(input.props).length && getObjectType(input.type) === "function") try {
		text = getReactNodeText(input.type({}), options);
	} catch {
		text = innerText(defaultValue);
	}
	else text = innerText(defaultValue);
	else if ((text.includes("{current}") || text.includes("{total}")) && step && steps) text = text.replace("{current}", step.toString()).replace("{total}", steps.toString());
	return text;
}
/**
* Log method calls if debug is enabled
*/
function log(debug, scope, title, ...data) {
	if (!debug) return;
	const now = /* @__PURE__ */ new Date();
	const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
	console.log(`${scope} %c${title}%c ${time}`, "font-weight: bold", "color: gray; font-weight: normal", ...data);
}
/**
* Merges the defaultProps with literal values with the incoming props, removing undefined values from it that would override the defaultProps.
* The result is a type-safe object with the defaultProps as required properties.
*/
function mergeProps(defaultProps, props) {
	const cleanProps = cleanUpObject(props);
	return {
		...defaultProps,
		...cleanProps
	};
}
/**
* A function that does nothing.
*/
function noop() {}
/**
* Type-safe Object.keys()
*/
function objectKeys(input) {
	return Object.keys(input);
}
/**
* Remove properties from an object
*/
function omit(input, ...filter) {
	if (!is.plainObject(input)) throw new TypeError("Expected an object");
	const output = {};
	for (const key in input)
 /* istanbul ignore else */
	if ({}.hasOwnProperty.call(input, key) && !filter.includes(key)) output[key] = input[key];
	return output;
}
/**
* Select properties from an object
*/
function pick(input, ...filter) {
	if (!is.plainObject(input)) throw new TypeError("Expected an object");
	if (!filter.length) return input;
	const output = {};
	for (const key in input)
 /* istanbul ignore else */
	if ({}.hasOwnProperty.call(input, key) && filter.includes(key)) output[key] = input[key];
	return output;
}
function replaceLocaleContent(input, step, steps) {
	const replacer = (text) => text.replace("{current}", String(step)).replace("{total}", String(steps));
	if (getObjectType(input) === "string") return replacer(input);
	if (!isValidElement(input)) return input;
	const { children } = input.props;
	if (is.string(children) && children.includes("{current}")) return cloneElement(input, { children: replacer(children) });
	if (Array.isArray(children)) return cloneElement(input, { children: children.map((child) => {
		if (typeof child === "string") return replacer(child);
		return replaceLocaleContent(child, step, steps);
	}) });
	if (is.function(input.type) && !Object.values(input.props).length) try {
		return replaceLocaleContent(input.type({}), step, steps);
	} catch {
		return input;
	}
	return input;
}
/**
* Sort object keys
*/
function sortObjectKeys(input) {
	return objectKeys(input).sort().reduce((acc, key) => {
		acc[key] = input[key];
		return acc;
	}, {});
}
//#endregion
//#region src/modules/dom.ts
function canUseDOM() {
	return !!(typeof window !== "undefined" && window.document?.createElement);
}
/**
* Find the bounding client rect
*/
function getClientRect(element) {
	if (!element) return null;
	return element.getBoundingClientRect();
}
/**
* Helper function to get the browser-normalized "document height"
*/
function getDocumentHeight(median = false) {
	const { body, documentElement } = document;
	if (!body || !documentElement) return 0;
	if (median) {
		const heights = [
			body.scrollHeight,
			body.offsetHeight,
			documentElement.clientHeight,
			documentElement.scrollHeight,
			documentElement.offsetHeight
		].sort((a, b) => a - b);
		const middle = Math.floor(heights.length / 2);
		if (heights.length % 2 === 0) return (heights[middle - 1] + heights[middle]) / 2;
		return heights[middle];
	}
	return Math.max(body.scrollHeight, body.offsetHeight, documentElement.clientHeight, documentElement.scrollHeight, documentElement.offsetHeight);
}
/**
* Find and return the target DOM element based on a step's 'target'.
*/
function getElement(element) {
	if (!element) return null;
	if (typeof element === "function") try {
		return element();
	} catch (error) {
		if (process.env.NODE_ENV !== "production") console.error(error);
		return null;
	}
	if (typeof element === "object" && "current" in element) return element.current;
	if (typeof element === "string") try {
		return document.querySelector(element);
	} catch (error) {
		if (process.env.NODE_ENV !== "production") console.error(error);
		return null;
	}
	return element;
}
/**
* Return the target's top position in document space (viewport top + scroll − offset).
*/
function getElementPosition(element, offset, isFixed) {
	const elementRect = getClientRect(element);
	const parent = getScrollParent(element);
	const hasScrollParent = parent ? !parent.isSameNode(scrollDocument()) : false;
	const isFixedTarget = isFixed ?? hasPosition(element);
	let parentTop = 0;
	let top = elementRect?.top ?? 0;
	if (hasScrollParent && isFixedTarget) top = elementRect?.top ?? 0;
	else if (parent instanceof HTMLElement) {
		parentTop = parent.scrollTop;
		if (!hasScrollParent && !isFixedTarget) top += parentTop;
		if (!parent.isSameNode(scrollDocument())) top += scrollDocument().scrollTop;
	}
	return Math.floor(top - offset);
}
/**
* Get the scroll parent of an element.
* If the detected parent doesn't actually scroll, fall back to the document.
*/
function getScrollParent(element, forListener) {
	if (!element) return scrollDocument();
	const parent = scrollParent(element);
	if (parent) {
		if (parent.isSameNode(scrollDocument())) {
			if (forListener) return document;
			return scrollDocument();
		}
		if (!(parent.scrollHeight > parent.offsetHeight)) return scrollDocument();
	}
	return parent;
}
function getScrollTargetToCenter(element) {
	const rect = element.getBoundingClientRect();
	const documentElement = scrollDocument();
	const containerCenter = rect.top + rect.height / 2;
	const viewportCenter = window.innerHeight / 2;
	return Math.max(0, documentElement.scrollTop + containerCenter - viewportCenter);
}
/**
* Get the scrollTop position
*/
function getScrollTo(element, offset) {
	if (!element) return 0;
	const parentElement = scrollParent(element) ?? scrollDocument();
	const scrollMarginTop = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
	const parentRect = getClientRect(parentElement);
	const parentScrollTop = parentElement.scrollTop ?? 0;
	const { offsetTop = 0, scrollTop = 0 } = parentElement;
	let top = element.getBoundingClientRect().top + scrollTop;
	if (!!offsetTop && (hasCustomScrollParent(element) || hasCustomOffsetParent(element))) {
		const elementRect = element.getBoundingClientRect();
		const elementTopInContainer = elementRect.top - (parentRect?.top ?? 0);
		const elementBottomInContainer = elementTopInContainer + elementRect.height;
		const containerHeight = parentElement.clientHeight;
		const margin = containerHeight * .2;
		if (elementTopInContainer >= margin && elementBottomInContainer <= containerHeight - margin) top = parentScrollTop;
		else top = elementTopInContainer + parentScrollTop;
	}
	const output = Math.floor(top - offset - scrollMarginTop);
	return output < 0 ? 0 : output;
}
/**
* Check if the element has custom offset parent
*/
function hasCustomOffsetParent(element) {
	return element.offsetParent !== document.body;
}
/**
* Check if the element has custom scroll parent
*/
function hasCustomScrollParent(element) {
	if (!element) return false;
	const parent = getScrollParent(element);
	return parent ? !parent.isSameNode(scrollDocument()) : false;
}
/**
* Check if an element has fixed/sticky position
*/
function hasPosition(el, type = "fixed") {
	if (!el || !(el instanceof Element)) return false;
	const { nodeName } = el;
	if (nodeName === "BODY" || nodeName === "HTML") return false;
	if (getComputedStyle(el).position === type) return true;
	if (!el.parentNode) return false;
	return hasPosition(el.parentNode, type);
}
/**
* Check if the element is visible
*/
function isElementVisible(element) {
	if (!element) return false;
	let parentElement = element;
	while (parentElement) {
		if (parentElement === document.body) break;
		if (parentElement instanceof HTMLElement) {
			const { display, visibility } = getComputedStyle(parentElement);
			if (display === "none" || visibility === "hidden") return false;
		}
		parentElement = parentElement.parentElement ?? null;
	}
	return true;
}
function needsScrolling(options) {
	const { isFirstStep, scrollToFirstStep, step, target, targetLifecycle } = options;
	if (step.skipScroll || isFirstStep && !scrollToFirstStep && targetLifecycle !== LIFECYCLE.TOOLTIP || step.placement === "center") return false;
	const parent = target?.isConnected ? getScrollParent(target) : scrollDocument();
	const isCustomScrollParent = parent ? !parent.isSameNode(scrollDocument()) : false;
	if ((step.isFixed || hasPosition(target)) && !isCustomScrollParent) return false;
	return parent.scrollHeight > parent.clientHeight;
}
function scrollDocument() {
	return document.scrollingElement ?? document.documentElement;
}
/**
* Scroll to position
*/
function scrollTo(value, options) {
	const { duration, element } = options;
	let cancel = () => {};
	const promise = new Promise((resolve) => {
		const { scrollTop } = element;
		const limit = value > scrollTop ? value - scrollTop : scrollTop - value;
		cancel = scroll.top(element, value, { duration: limit < 100 ? 50 : duration }, () => {
			resolve();
		});
	});
	return {
		cancel,
		promise
	};
}
//#endregion
//#region src/styles.ts
/**
* Convert hex to RGB
*/
function hexToRGB(hex) {
	const properHex = hex.replace(/^#?([\da-f])([\da-f])([\da-f])$/i, (_m, r, g, b) => r + r + g + g + b + b);
	const result = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(properHex);
	return result ? [
		parseInt(result[1], 16),
		parseInt(result[2], 16),
		parseInt(result[3], 16)
	] : [];
}
const buttonReset = {
	backgroundColor: "transparent",
	border: 0,
	borderRadius: 0,
	color: "#555555",
	cursor: "pointer",
	fontSize: 16,
	lineHeight: 1,
	padding: 0,
	WebkitAppearance: "none"
};
const buttonBase = {
	...buttonReset,
	borderRadius: 4,
	padding: 8
};
function getStyles(props, step) {
	const { styles } = props;
	const mergedStyles = deepMerge(styles ?? {}, step.styles ?? {});
	let { width } = step;
	if (canUseDOM()) width = typeof width === "number" && window.innerWidth < width ? window.innerWidth - 30 : width;
	const overlay = {
		bottom: 0,
		left: 0,
		overflow: "hidden",
		position: "absolute",
		right: 0,
		top: 0,
		zIndex: step.zIndex
	};
	return deepMerge({
		arrow: {
			alignItems: "center",
			color: step.arrowColor,
			display: "inline-flex",
			justifyContent: "center",
			position: "absolute"
		},
		beaconWrapper: {
			...buttonReset,
			display: "inline-flex",
			borderRadius: "50%",
			position: "relative"
		},
		beacon: {
			height: step.beaconSize,
			width: step.beaconSize
		},
		beaconInner: {
			animation: "joyride-beacon-inner 1.2s infinite ease-in-out",
			backgroundColor: step.primaryColor,
			borderRadius: "50%",
			display: "block",
			height: "50%",
			left: "50%",
			opacity: .7,
			position: "absolute",
			top: "50%",
			transform: "translate(-50%, -50%)",
			width: "50%"
		},
		beaconOuter: {
			animation: "joyride-beacon-outer 1.2s infinite ease-in-out",
			backgroundColor: `rgba(${hexToRGB(step.primaryColor).join(",")}, 0.2)`,
			border: `2px solid ${step.primaryColor}`,
			borderRadius: "50%",
			boxSizing: "border-box",
			display: "block",
			height: "100%",
			left: 0,
			opacity: .9,
			position: "absolute",
			top: 0,
			transformOrigin: "center",
			width: "100%"
		},
		buttonBack: {
			...buttonBase,
			color: step.primaryColor,
			marginLeft: "auto",
			marginRight: 5
		},
		buttonClose: {
			...buttonBase,
			color: step.textColor,
			height: 12,
			padding: 8,
			position: "absolute",
			right: 0,
			top: 0,
			width: 12
		},
		buttonPrimary: {
			...buttonBase,
			backgroundColor: step.primaryColor,
			color: step.backgroundColor
		},
		buttonSkip: {
			...buttonBase,
			color: step.textColor,
			fontSize: 14
		},
		floater: {
			display: "inline-block",
			filter: "drop-shadow(0 0 3px rgba(0, 0, 0, 0.3))",
			maxWidth: "100%",
			transition: "opacity 0.3s"
		},
		loader: {
			alignItems: "center",
			display: "flex",
			height: 48,
			inset: 0,
			justifyContent: "center",
			pointerEvents: "none",
			position: "fixed",
			width: 48,
			zIndex: step.zIndex + 1
		},
		overlay: {
			...overlay,
			backgroundColor: step.overlayColor
		},
		spotlight: {},
		tooltip: {
			backgroundColor: step.backgroundColor,
			borderRadius: 5,
			boxSizing: "border-box",
			color: step.textColor,
			fontSize: 16,
			maxWidth: "100%",
			padding: 12,
			position: "relative",
			width
		},
		tooltipContainer: {
			lineHeight: 1.4,
			textAlign: "center"
		},
		tooltipTitle: {
			fontSize: 18,
			margin: 0
		},
		tooltipContent: {
			paddingBottom: 12,
			paddingTop: 12
		},
		tooltipFooter: {
			alignItems: "center",
			display: "flex",
			justifyContent: "flex-end"
		},
		tooltipFooterSpacer: { flex: 1 }
	}, mergedStyles);
}
//#endregion
//#region src/modules/step.ts
const optionFieldNames = [
	"after",
	"arrowBase",
	"arrowColor",
	"arrowSize",
	"arrowSpacing",
	"backgroundColor",
	"beaconSize",
	"beaconTrigger",
	"before",
	"beforeTimeout",
	"buttons",
	"closeButtonAction",
	"skipBeacon",
	"dismissKeyAction",
	"disableFocusTrap",
	"hideOverlay",
	"skipScroll",
	"blockTargetInteraction",
	"loaderDelay",
	"offset",
	"overlayClickAction",
	"overlayColor",
	"primaryColor",
	"scrollDuration",
	"scrollOffset",
	"showProgress",
	"spotlightPadding",
	"spotlightRadius",
	"targetWaitTimeout",
	"textColor",
	"width",
	"zIndex"
];
function getMergedStep(props, currentStep) {
	if (!currentStep) return null;
	const mergedStep = deepMerge(defaultStep, pick(props, "arrowComponent", "beaconComponent", "floatingOptions", "loaderComponent", "locale", "styles", "tooltipComponent"), currentStep);
	const mergedOptions = deepMerge(defaultOptions, props.options ?? {}, pick(currentStep, ...optionFieldNames));
	const mergedStyles = getStyles(props, {
		...mergedStep,
		...mergedOptions
	});
	const floatingOptions = deepMerge(defaultFloatingOptions, props.floatingOptions ?? {}, mergedStep.floatingOptions ?? {});
	return {
		...mergedStep,
		...mergedOptions,
		locale: deepMerge(defaultLocale, props.locale ?? {}, mergedStep.locale || {}),
		floatingOptions,
		spotlightPadding: normalizeSpotlightPadding(mergedOptions.spotlightPadding),
		styles: mergedStyles
	};
}
function normalizeSpotlightPadding(value) {
	if (typeof value === "number") return {
		top: value,
		right: value,
		bottom: value,
		left: value
	};
	return {
		top: value?.top ?? 0,
		right: value?.right ?? 0,
		bottom: value?.bottom ?? 0,
		left: value?.left ?? 0
	};
}
/**
* Decide if the step shouldn't skip the beacon
*/
function shouldHideBeacon(step, state, continuous) {
	const { action } = state;
	const withContinuous = continuous && [ACTIONS.PREV, ACTIONS.NEXT].includes(action);
	return step.skipBeacon || step.placement === "center" || withContinuous;
}
/**
* Validate if a step is valid
*/
function validateStep(step, debug = false) {
	if (!is.plainObject(step)) {
		log(debug, "tour", "step must be an object");
		return false;
	}
	if (!step.target) {
		log(debug, "tour", "target is missing from the step");
		return false;
	}
	return true;
}
/**
* Validate if steps are valid
*/
function validateSteps(steps, debug = false) {
	if (!is.array(steps)) {
		log(debug, "tour", "steps must be an array");
		return false;
	}
	return steps.every((d) => validateStep(d, debug));
}
//#endregion
//#region src/modules/store.ts
var Store = class {
	beaconPosition = null;
	debug;
	eventListeners = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	props;
	snapshot;
	state;
	steps;
	tooltipPosition = null;
	constructor(options) {
		const { initialStepIndex, stepIndex, steps = [] } = options ?? {};
		const isControlled = is.number(stepIndex);
		let startIndex = 0;
		this.debug = options?.debug ?? false;
		if (isControlled) {
			startIndex = stepIndex;
			if (is.number(initialStepIndex)) log(this.debug, "tour", "initialStepIndex is ignored in controlled mode");
		} else if (is.number(initialStepIndex)) {
			if (initialStepIndex >= 0 && initialStepIndex < steps.length) startIndex = initialStepIndex;
			else if (steps.length > 0) log(this.debug, "tour", "initialStepIndex is out of bounds");
		}
		this.props = options ?? { steps: [] };
		this.steps = steps;
		this.state = {
			action: ACTIONS.INIT,
			controlled: isControlled,
			index: startIndex,
			lifecycle: LIFECYCLE.INIT,
			origin: null,
			positioned: false,
			scrolling: false,
			size: steps.length,
			status: steps.length ? STATUS.READY : STATUS.IDLE,
			waiting: false
		};
		this.snapshot = Object.freeze({ ...this.state });
	}
	applyTransitions(draft) {
		if (draft.status === STATUS.WAITING && draft.size > 0) return {
			...draft,
			status: STATUS.RUNNING
		};
		return draft;
	}
	getStep(nextIndex) {
		return getMergedStep(this.props, this.steps[nextIndex ?? this.state.index]);
	}
	cleanupPositionData = () => {
		this.beaconPosition = null;
		this.tooltipPosition = null;
	};
	getPositionData = (name) => {
		if (name === "beacon") return this.beaconPosition;
		return this.tooltipPosition;
	};
	getServerSnapshot = () => this.snapshot;
	getSnapshot = () => this.snapshot;
	getEventState = () => omit(this.snapshot, "positioned");
	getState = () => omit(this.snapshot, "positioned");
	setPositionData = (name, data) => {
		if ((name === "beacon" ? this.beaconPosition : this.tooltipPosition)?.placement !== data.placement) log(this.debug, `step:${this.state.index}`, "positioned", `${name} ${data.placement}`);
		if (name === "beacon") this.beaconPosition = data;
		else this.tooltipPosition = data;
		if ((this.state.lifecycle === LIFECYCLE.BEACON_BEFORE || this.state.lifecycle === LIFECYCLE.TOOLTIP_BEFORE) && !this.state.positioned) this.updateState({ positioned: true });
		const onPosition = this.getStep()?.floatingOptions?.onPosition;
		if (onPosition) onPosition(data);
	};
	setSteps = (steps) => {
		this.steps = steps;
		this.updateState({ size: steps.length });
	};
	dispatch = (data, controls) => {
		const handlers = this.eventListeners.get(data.type);
		if (handlers) for (const handler of handlers) try {
			handler(data, controls);
		} catch {}
	};
	on = (eventType, handler) => {
		let handlers = this.eventListeners.get(eventType);
		if (!handlers) {
			handlers = /* @__PURE__ */ new Set();
			this.eventListeners.set(eventType, handlers);
		}
		handlers.add(handler);
		return () => {
			handlers.delete(handler);
		};
	};
	subscribe = (listener) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	updateState = (patch, forceIndex = false) => {
		const { controlled, index } = this.state;
		const previousSnapshot = this.snapshot;
		const resolvedIndex = controlled && !forceIndex && patch.index !== void 0 ? index : patch.index ?? index;
		const merged = {
			action: patch.action ?? this.state.action,
			controlled,
			index: resolvedIndex,
			lifecycle: patch.lifecycle ?? this.state.lifecycle,
			origin: patch.origin ?? null,
			positioned: patch.positioned ?? this.state.positioned,
			scrolling: patch.scrolling ?? this.state.scrolling,
			size: patch.size ?? this.state.size,
			status: patch.status ?? this.state.status,
			waiting: patch.waiting ?? this.state.waiting
		};
		const final = this.applyTransitions(merged);
		this.state = final;
		if (!deepEqual(previousSnapshot, final)) {
			this.snapshot = Object.freeze({ ...final });
			for (const listener of this.listeners) listener(this.snapshot);
		}
	};
};
function createStore(options) {
	return new Store(options);
}
//#endregion
//#region src/hooks/useControls.ts
function getUpdatedIndex(nextIndex, size) {
	return Math.min(Math.max(nextIndex, 0), size);
}
function useControls(store, debug, clearFailures) {
	const debugRef = useRef(debug);
	const clearFailuresRef = useRef(clearFailures);
	debugRef.current = debug;
	clearFailuresRef.current = clearFailures;
	return useMemo(() => {
		const getState = () => store.current.getSnapshot();
		const close = (origin = null) => {
			const { index, status } = getState();
			if (status !== STATUS.RUNNING) return;
			store.current.updateState({
				action: ACTIONS.CLOSE,
				index: index + 1,
				origin,
				lifecycle: LIFECYCLE.COMPLETE,
				positioned: false,
				scrolling: false,
				waiting: false
			});
		};
		const go = (nextIndex) => {
			const { controlled, size, status } = getState();
			if (controlled) {
				log(debugRef.current, "tour", "go() is not supported in controlled mode");
				return;
			}
			if (status !== STATUS.RUNNING) return;
			store.current.updateState({
				action: ACTIONS.GO,
				index: nextIndex,
				lifecycle: LIFECYCLE.COMPLETE,
				positioned: false,
				scrolling: false,
				status: nextIndex < size ? status : STATUS.FINISHED,
				waiting: false
			});
		};
		const info = () => omit(store.current.getSnapshot(), "positioned");
		const next = (origin) => {
			const { index, size, status } = getState();
			if (status !== STATUS.RUNNING) return;
			store.current.updateState({
				action: ACTIONS.NEXT,
				index: getUpdatedIndex(index + 1, size),
				lifecycle: LIFECYCLE.COMPLETE,
				origin,
				positioned: false,
				scrolling: false,
				waiting: false
			});
		};
		const open = () => {
			const { status } = getState();
			if (status !== STATUS.RUNNING) return;
			store.current.updateState({
				action: ACTIONS.UPDATE,
				lifecycle: LIFECYCLE.TOOLTIP_BEFORE,
				positioned: false,
				scrolling: false,
				waiting: false
			});
		};
		const previous = (origin) => {
			const { index, size, status } = getState();
			if (status !== STATUS.RUNNING) return;
			store.current.updateState({
				action: ACTIONS.PREV,
				index: getUpdatedIndex(index - 1, size),
				lifecycle: LIFECYCLE.COMPLETE,
				origin,
				positioned: false,
				scrolling: false,
				waiting: false
			});
		};
		const replay = (origin) => {
			const { lifecycle, status } = getState();
			if (status !== STATUS.RUNNING || lifecycle !== LIFECYCLE.TOOLTIP) return;
			store.current.updateState({
				action: ACTIONS.REPLAY,
				lifecycle: LIFECYCLE.COMPLETE,
				origin,
				positioned: false,
				scrolling: false,
				waiting: false
			});
		};
		const reset = (restart = false) => {
			const { controlled } = getState();
			if (controlled) {
				log(debugRef.current, "tour", "reset() is not supported in controlled mode");
				return;
			}
			clearFailuresRef.current();
			store.current.updateState({
				action: ACTIONS.RESET,
				index: 0,
				lifecycle: LIFECYCLE.INIT,
				positioned: false,
				scrolling: false,
				status: restart ? STATUS.RUNNING : STATUS.READY,
				waiting: false
			});
		};
		const skip = (origin) => {
			const { status } = getState();
			if (status !== STATUS.RUNNING) return;
			store.current.updateState({
				action: ACTIONS.SKIP,
				lifecycle: LIFECYCLE.COMPLETE,
				origin,
				positioned: false,
				scrolling: false,
				status: STATUS.SKIPPED,
				waiting: false
			});
		};
		const start = (nextIndex) => {
			const { index, size } = getState();
			clearFailuresRef.current();
			store.current.updateState({
				action: ACTIONS.START,
				index: is.number(nextIndex) ? nextIndex : index,
				lifecycle: LIFECYCLE.INIT,
				positioned: false,
				scrolling: false,
				status: size ? STATUS.RUNNING : STATUS.WAITING,
				waiting: false
			}, true);
		};
		const stop = (advance = false) => {
			const { index, status } = getState();
			if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) return;
			store.current.updateState({
				action: ACTIONS.STOP,
				index: index + (advance ? 1 : 0),
				lifecycle: LIFECYCLE.COMPLETE,
				positioned: false,
				scrolling: false,
				status: STATUS.PAUSED,
				waiting: false
			});
		};
		return {
			close,
			go,
			info,
			next,
			open,
			prev: previous,
			replay,
			reset,
			skip,
			start,
			stop
		};
	}, [store]);
}
//#endregion
//#region src/hooks/useDebugLogger.ts
const skipFields = /* @__PURE__ */ new Set(["origin", "positioned"]);
function useDebugLogger(store, debug) {
	const previousRef = useRef(null);
	useEffect(() => {
		if (!debug) return;
		const current = store.current.getSnapshot();
		log(true, "tour", "init", current);
		previousRef.current = current;
		return store.current.subscribe((state) => {
			const previous = previousRef.current;
			previousRef.current = state;
			if (!previous) return;
			const changes = {};
			let isTourLevel = false;
			for (const key of Object.keys(state)) if (state[key] !== previous[key] && !skipFields.has(key)) {
				changes[key] = {
					from: previous[key],
					to: state[key]
				};
				if (key === "status" || key === "size") isTourLevel = true;
			}
			if (Object.keys(changes).length) {
				if (!(!isTourLevel && state.index >= state.size)) log(true, isTourLevel ? "tour" : `step:${state.index}`, "state", changes);
			}
		});
	}, [debug, store]);
}
//#endregion
//#region src/hooks/useEventEmitter.ts
function useEventEmitter(onEvent, controls, store) {
	const onEventRef = useRef(onEvent);
	const controlsRef = useRef(controls);
	onEventRef.current = onEvent;
	controlsRef.current = controls;
	return useCallback((type, step, overrides) => {
		const data = {
			...store.current.getEventState(),
			error: null,
			scroll: null,
			step,
			type,
			...overrides
		};
		onEventRef.current?.(data, controlsRef.current);
		store.current.dispatch(data, controlsRef.current);
	}, [store]);
}
//#endregion
//#region src/modules/changes.ts
function treeChanges(state, previous) {
	return {
		hasChanged(key) {
			return state[key] !== previous[key];
		},
		hasChangedTo(key, value) {
			const current = state[key];
			const previousValue = previous[key];
			if (Array.isArray(value)) return value.includes(current) && !value.includes(previousValue);
			return current === value && previousValue !== value;
		},
		previous
	};
}
//#endregion
//#region src/hooks/useLifecycleEffect.ts
function useLifecycleEffect(options) {
	const { addFailure, controls, emitEvent, previousState, props, state, step, store } = options;
	const { action, index, lifecycle, positioned, scrolling, size, status } = state;
	const previousStep = usePrevious(step) ?? null;
	const lastAction = useRef(null);
	const propsRef = useRef(props);
	const stateRef = useRef(state);
	const previousStateRef = useRef(previousState);
	const stepRef = useRef(step);
	const previousStepRef = useRef(previousStep);
	const controlsRef = useRef(controls);
	const pollingRef = useRef(null);
	const pollingTargetRef = useRef(null);
	const beforeRef = useRef(null);
	propsRef.current = props;
	stateRef.current = state;
	previousStateRef.current = previousState;
	stepRef.current = step;
	previousStepRef.current = previousStep;
	controlsRef.current = controls;
	const cleanup = () => {
		if (pollingRef.current) {
			clearInterval(pollingRef.current);
			pollingRef.current = null;
		}
		pollingTargetRef.current = null;
		if (beforeRef.current) {
			beforeRef.current.cancel();
			beforeRef.current = null;
		}
	};
	useEffect(() => {
		if (!previousStateRef.current) return;
		const { hasChangedTo } = treeChanges(stateRef.current, previousStateRef.current);
		const isAfterAction = hasChangedTo("action", [
			ACTIONS.NEXT,
			ACTIONS.PREV,
			ACTIONS.SKIP,
			ACTIONS.CLOSE,
			ACTIONS.REPLAY
		]);
		const isStaleAfterStart = action === ACTIONS.START && (lastAction.current === ACTIONS.CLOSE || lastAction.current === ACTIONS.REPLAY);
		if (isAfterAction || isStaleAfterStart) lastAction.current = action;
	}, [action]);
	useEffect(() => {
		if (!previousStateRef.current) return () => {
			cleanup();
		};
		const { hasChanged } = treeChanges(stateRef.current, previousStateRef.current);
		const currentStep = stepRef.current;
		if (hasChanged("index")) cleanup();
		if (status !== STATUS.RUNNING || !currentStep || lifecycle !== LIFECYCLE.INIT) return () => {
			cleanup();
		};
		const { hasChangedTo: hasStatusChangedTo } = treeChanges(stateRef.current, previousStateRef.current);
		if (hasStatusChangedTo("status", STATUS.RUNNING) && [
			STATUS.IDLE,
			STATUS.READY,
			STATUS.PAUSED
		].includes(previousStateRef.current.status)) emitEvent(EVENTS.TOUR_START, currentStep);
		store.current.cleanupPositionData();
		const { debug } = propsRef.current;
		if (currentStep.before && !beforeRef.current) {
			log(debug, `step:${index}`, "before()", currentStep);
			beforeRef.current = { cancel: () => {} };
			store.current.updateState({ waiting: true });
			emitEvent(EVENTS.STEP_BEFORE_HOOK, currentStep, { action: lastAction.current ?? stateRef.current.action });
			const proceed = () => {
				beforeRef.current = null;
				store.current.updateState({
					action: lastAction.current ?? stateRef.current.action,
					waiting: false,
					lifecycle: LIFECYCLE.READY
				});
			};
			const abortController = new AbortController();
			const timeout = currentStep.beforeTimeout;
			beforeRef.current = { cancel: () => abortController.abort() };
			const timeoutId = timeout ? setTimeout(() => {
				if (!abortController.signal.aborted) {
					log(debug, `step:${index}`, "before()", "timed out", `${timeout}ms`);
					abortController.abort();
					addFailure(currentStep, "before_hook");
					emitEvent(EVENTS.ERROR, currentStep, { error: /* @__PURE__ */ new Error("Step before hook timed out") });
					proceed();
				}
			}, timeout) : null;
			currentStep.before({
				...store.current.getState(),
				action: lastAction.current ?? store.current.getState().action,
				step: currentStep
			}).then(() => {
				if (!abortController.signal.aborted) {
					if (timeoutId) clearTimeout(timeoutId);
					proceed();
				}
			}).catch((error) => {
				if (!abortController.signal.aborted) {
					if (timeoutId) clearTimeout(timeoutId);
					addFailure(currentStep, "before_hook");
					emitEvent(EVENTS.ERROR, currentStep, { error: error instanceof Error ? error : new Error(String(error)) });
					proceed();
				}
			});
		} else if (!beforeRef.current) {
			if (pollingRef.current && pollingTargetRef.current !== currentStep.target) cleanup();
			const element = getElement(currentStep.target);
			if (element && isElementVisible(element)) {
				cleanup();
				store.current.updateState({
					action: lastAction.current ?? ACTIONS.UPDATE,
					lifecycle: LIFECYCLE.READY,
					waiting: false
				});
			} else if (currentStep.targetWaitTimeout === 0) store.current.updateState({
				action: lastAction.current ?? ACTIONS.UPDATE,
				lifecycle: LIFECYCLE.READY,
				waiting: false
			});
			else if (!pollingRef.current) {
				const { targetWaitTimeout } = currentStep;
				const startTime = Date.now();
				pollingTargetRef.current = currentStep.target;
				log(debug, `step:${index}`, "polling", "started", `${targetWaitTimeout}ms`);
				store.current.updateState({ waiting: true });
				pollingRef.current = setInterval(() => {
					const el = getElement(currentStep.target);
					const elapsed = Date.now() - startTime;
					const timedOut = elapsed >= targetWaitTimeout;
					if (el && isElementVisible(el) || timedOut) {
						log(debug, `step:${index}`, "polling", el && isElementVisible(el) ? "found" : "timed out", `${elapsed}ms`);
						cleanup();
						store.current.updateState({
							action: lastAction.current ?? ACTIONS.UPDATE,
							lifecycle: LIFECYCLE.READY,
							waiting: false
						});
					}
				}, 100);
			}
		}
		return () => {
			cleanup();
		};
	}, [
		addFailure,
		emitEvent,
		index,
		lifecycle,
		status,
		store
	]);
	useEffect(() => {
		if (!previousStateRef.current) return;
		const { hasChanged, hasChangedTo, previous } = treeChanges(stateRef.current, previousStateRef.current);
		const currentStep = stepRef.current;
		if (!currentStep) return;
		const element = getElement(currentStep.target);
		const elementExists = !!element;
		if (elementExists && isElementVisible(element)) {
			if (hasChangedTo("lifecycle", LIFECYCLE.READY) && previous.lifecycle === LIFECYCLE.INIT) emitEvent(EVENTS.STEP_BEFORE, currentStep, { action: lastAction.current ?? stateRef.current.action });
			if (hasChangedTo("lifecycle", LIFECYCLE.READY)) {
				const currentState = stateRef.current;
				const finalLifecycle = shouldHideBeacon(currentStep, currentState, propsRef.current.continuous) ? LIFECYCLE.TOOLTIP : LIFECYCLE.BEACON;
				const target = getElement(currentStep.scrollTarget ?? currentStep.spotlightTarget ?? currentStep.target);
				const willScroll = needsScrolling({
					isFirstStep: currentState.index === 0,
					scrollToFirstStep: propsRef.current.scrollToFirstStep,
					step: currentStep,
					target,
					targetLifecycle: finalLifecycle
				});
				const beforeLifecycle = finalLifecycle === LIFECYCLE.TOOLTIP ? LIFECYCLE.TOOLTIP_BEFORE : LIFECYCLE.BEACON_BEFORE;
				log(propsRef.current.debug, `step:${index}`, "scroll", willScroll ? "needed" : "skipped");
				store.current.updateState({
					action: ACTIONS.UPDATE,
					lifecycle: beforeLifecycle,
					scrolling: willScroll
				});
			}
		} else if (stateRef.current.status === STATUS.RUNNING && lifecycle !== LIFECYCLE.INIT && lifecycle !== LIFECYCLE.COMPLETE && hasChanged("lifecycle")) {
			log(propsRef.current.debug, `step:${index}`, elementExists ? "Target not visible" : "Target not mounted", currentStep);
			addFailure(currentStep, "target_not_found");
			emitEvent(EVENTS.TARGET_NOT_FOUND, currentStep);
			const currentState = stateRef.current;
			if (!currentState.controlled) store.current.updateState({
				action: ACTIONS.UPDATE,
				index: currentState.index + (currentState.action === ACTIONS.PREV ? -1 : 1),
				lifecycle: LIFECYCLE.INIT
			});
		}
	}, [
		addFailure,
		emitEvent,
		index,
		lifecycle,
		store
	]);
	useEffect(() => {
		if (!previousStateRef.current) return;
		const { hasChangedTo, previous } = treeChanges(stateRef.current, previousStateRef.current);
		const currentStep = stepRef.current;
		const previousStepValue = previousStepRef.current;
		if (currentStep && hasChangedTo("lifecycle", LIFECYCLE.TOOLTIP_BEFORE) && previous.lifecycle === LIFECYCLE.BEACON) {
			const target = getElement(currentStep.scrollTarget ?? currentStep.spotlightTarget ?? currentStep.target);
			if (needsScrolling({
				isFirstStep: stateRef.current.index === 0,
				scrollToFirstStep: propsRef.current.scrollToFirstStep,
				step: currentStep,
				target,
				targetLifecycle: LIFECYCLE.TOOLTIP
			})) {
				store.current.updateState({
					scrolling: true,
					positioned: false
				});
				return;
			}
		}
		const isBeforePhase = lifecycle === LIFECYCLE.BEACON_BEFORE || lifecycle === LIFECYCLE.TOOLTIP_BEFORE;
		if (currentStep && isBeforePhase && !scrolling) {
			const finalLifecycle = lifecycle === LIFECYCLE.TOOLTIP_BEFORE ? LIFECYCLE.TOOLTIP : LIFECYCLE.BEACON;
			store.current.updateState({
				action: ACTIONS.UPDATE,
				lifecycle: finalLifecycle
			});
		}
		if (currentStep && hasChangedTo("lifecycle", LIFECYCLE.BEACON)) emitEvent(EVENTS.BEACON, currentStep);
		if (currentStep && hasChangedTo("lifecycle", LIFECYCLE.TOOLTIP)) emitEvent(EVENTS.TOOLTIP, currentStep);
		const currentState = stateRef.current;
		if ((currentState.status === STATUS.RUNNING || currentState.controlled && currentState.status === STATUS.PAUSED && !!currentStep) && previousStepValue && hasChangedTo("lifecycle", LIFECYCLE.COMPLETE) && previous.lifecycle === LIFECYCLE.TOOLTIP) {
			emitEvent(EVENTS.STEP_AFTER, previousStepValue, {
				action: lastAction.current ?? ACTIONS.UPDATE,
				index: previous.index ?? currentState.index,
				lifecycle: currentState.lifecycle
			});
			if (previousStepValue.after) {
				emitEvent(EVENTS.STEP_AFTER_HOOK, previousStepValue, {
					action: lastAction.current ?? ACTIONS.UPDATE,
					index: previous.index ?? currentState.index,
					lifecycle: currentState.lifecycle
				});
				try {
					previousStepValue.after({
						...store.current.getState(),
						action: lastAction.current ?? ACTIONS.UPDATE,
						index: previous.index ?? currentState.index,
						lifecycle: currentState.lifecycle,
						step: previousStepValue
					});
				} catch {}
			}
		}
	}, [
		emitEvent,
		lifecycle,
		positioned,
		scrolling,
		store
	]);
	useEffect(() => {
		if (!previousStateRef.current) return;
		const { hasChangedTo, previous } = treeChanges(stateRef.current, previousStateRef.current);
		const currentStep = stepRef.current;
		const previousStepValue = previousStepRef.current;
		if (hasChangedTo("action", ACTIONS.REPLAY) && hasChangedTo("lifecycle", LIFECYCLE.COMPLETE)) {
			store.current.updateState({ lifecycle: LIFECYCLE.INIT });
			return;
		}
		if (size && !currentStep && lifecycle === LIFECYCLE.INIT) store.current.updateState({
			action: ACTIONS.UPDATE,
			lifecycle: LIFECYCLE.COMPLETE,
			status: STATUS.FINISHED
		});
		if (!stateRef.current.controlled && status === STATUS.RUNNING && hasChangedTo("lifecycle", LIFECYCLE.COMPLETE) && index < size) store.current.updateState({
			action: ACTIONS.UPDATE,
			lifecycle: LIFECYCLE.INIT
		});
		if (hasChangedTo("lifecycle", LIFECYCLE.COMPLETE) && index >= size) store.current.updateState({
			action: ACTIONS.UPDATE,
			lifecycle: LIFECYCLE.COMPLETE,
			status: STATUS.FINISHED
		});
		const tourEndStep = currentStep ?? previousStepValue ?? getMergedStep(propsRef.current, propsRef.current.steps[index - 1]);
		if (tourEndStep && hasChangedTo("status", [STATUS.FINISHED, STATUS.SKIPPED])) {
			let tourEndIndex;
			if (currentStep) tourEndIndex = index;
			else if (previousStepValue) tourEndIndex = previous.index ?? index;
			else tourEndIndex = index - 1;
			emitEvent(EVENTS.TOUR_END, tourEndStep, { index: tourEndIndex });
			if (!stateRef.current.controlled) controlsRef.current.reset();
			lastAction.current = null;
		}
		if (currentStep && hasChangedTo("action", ACTIONS.STOP)) {
			lastAction.current = null;
			emitEvent(EVENTS.TOUR_STATUS, currentStep);
		}
		if (currentStep && hasChangedTo("action", ACTIONS.RESET)) {
			emitEvent(EVENTS.TOUR_STATUS, currentStep);
			lastAction.current = null;
		}
	}, [
		action,
		emitEvent,
		index,
		lifecycle,
		size,
		status,
		store
	]);
}
//#endregion
//#region src/hooks/usePropSync.ts
function usePropSync({ controls, emitEvent, props, state, store }) {
	const { debug, initialStepIndex, run, stepIndex, steps } = props;
	const previousPropsRef = useRef(void 0);
	const stateRef = useRef(state);
	const controlsRef = useRef(controls);
	stateRef.current = state;
	controlsRef.current = controls;
	useEffect(() => {
		const previousProps = previousPropsRef.current;
		previousPropsRef.current = props;
		if (!previousProps || props === previousProps) return;
		const { hasChanged } = treeChanges(props, previousProps);
		if (!deepEqual(previousProps.steps, steps)) if (validateSteps(steps, debug)) store.current.setSteps(steps);
		else {
			log(debug, "tour", "Steps are not valid", steps);
			emitEvent(EVENTS.ERROR, steps[0] ?? {
				target: "",
				content: ""
			}, { error: /* @__PURE__ */ new Error("Steps are not valid") });
		}
		if (hasChanged("run")) if (run) {
			if (store.current.getState().size) controlsRef.current.start(stepIndex ?? initialStepIndex);
		} else controlsRef.current.stop();
		else if (is.number(stepIndex) && hasChanged("stepIndex")) {
			const nextAction = is.number(previousProps.stepIndex) && previousProps.stepIndex < stepIndex ? ACTIONS.NEXT : ACTIONS.PREV;
			if (![STATUS.FINISHED, STATUS.SKIPPED].includes(stateRef.current.status)) store.current.updateState({
				action: nextAction,
				index: stepIndex,
				lifecycle: LIFECYCLE.INIT,
				positioned: false
			}, true);
		}
	}, [
		debug,
		emitEvent,
		initialStepIndex,
		props,
		run,
		stepIndex,
		steps,
		store
	]);
}
//#endregion
//#region src/hooks/useScrollEffect.ts
function adjustForPlacement(scrollY, options) {
	const { beaconPosition, lifecycle, scrollOffset, step } = options;
	if (step.scrollTarget || step.spotlightTarget) return Math.max(0, scrollY);
	let adjustedY = scrollY - step.spotlightPadding.top;
	if (lifecycle === LIFECYCLE.BEACON_BEFORE && beaconPosition?.placement) {
		const y = getMainAxisOffset(beaconPosition);
		if (!["bottom"].includes(beaconPosition.placement)) adjustedY += Math.floor(y - scrollOffset);
	} else if (lifecycle === LIFECYCLE.TOOLTIP_BEFORE) {
		const { placement } = step;
		if (placement === "top") {
			const floaterHeight = document.querySelector(".react-joyride__floater")?.getBoundingClientRect().height ?? 0;
			const arrowSize = step.floatingOptions?.hideArrow ? 0 : step.arrowSize;
			const gap = step.offset + step.spotlightPadding.top + arrowSize;
			adjustedY -= floaterHeight + gap;
		} else if (placement === "left" || placement === "right") {
			const floaterHeight = document.querySelector(".react-joyride__floater")?.getBoundingClientRect().height ?? 0;
			const targetHeight = getElement(step.target)?.getBoundingClientRect().height ?? 0;
			const floaterTopY = scrollOffset + step.spotlightPadding.top + targetHeight / 2 - floaterHeight / 2;
			if (floaterTopY < scrollOffset) adjustedY -= scrollOffset - floaterTopY;
		}
	}
	return Math.max(0, adjustedY);
}
function getMainAxisOffset(data) {
	const offsetData = data.middlewareData?.offset;
	if (!offsetData) return 0;
	return ["left", "right"].some((p) => data.placement.startsWith(p)) ? offsetData.x : offsetData.y;
}
function useScrollEffect({ emitEvent, previousState, props, state, step, store }) {
	const { index, lifecycle, positioned, scrolling, status } = state;
	const cancelScrollRef = useRef(null);
	const stateRef = useRef(state);
	const previousStateRef = useRef(previousState);
	const propsRef = useRef(props);
	const stepRef = useRef(step);
	stateRef.current = state;
	previousStateRef.current = previousState;
	propsRef.current = props;
	stepRef.current = step;
	useEffect(() => {
		return () => {
			cancelScrollRef.current?.();
		};
	}, []);
	useEffect(() => {
		if (!previousStateRef.current || !stepRef.current) return;
		const { hasChangedTo } = treeChanges(stateRef.current, previousStateRef.current);
		const currentStep = stepRef.current;
		const { debug } = propsRef.current;
		const { scrollDuration } = currentStep;
		const isBeforePhase = lifecycle === LIFECYCLE.BEACON_BEFORE || lifecycle === LIFECYCLE.TOOLTIP_BEFORE;
		if (status === STATUS.RUNNING && isBeforePhase && scrolling && hasChangedTo("positioned", true)) {
			const target = getElement(currentStep.scrollTarget ?? currentStep.spotlightTarget ?? currentStep.target);
			const beaconPosition = store.current.getPositionData("beacon");
			const scrollParent = getScrollParent(target);
			const hasCustomScroll = scrollParent ? !scrollParent.isSameNode(scrollDocument()) : false;
			cancelScrollRef.current?.();
			const handleScroll = async () => {
				if (hasCustomScroll && !hasPosition(scrollParent)) {
					const pageElement = scrollDocument();
					const pageScrollY = getScrollTargetToCenter(scrollParent);
					const pageScrollData = {
						initial: pageElement.scrollTop,
						target: pageScrollY,
						element: pageElement,
						duration: scrollDuration
					};
					emitEvent(EVENTS.SCROLL_START, currentStep, { scroll: pageScrollData });
					const { cancel: cancelPage, promise: pagePromise } = scrollTo(pageScrollY, {
						element: pageElement,
						duration: scrollDuration
					});
					cancelScrollRef.current = cancelPage;
					await pagePromise;
					emitEvent(EVENTS.SCROLL_END, currentStep, { scroll: pageScrollData });
				}
				const baseScrollY = Math.floor(getScrollTo(target, currentStep.scrollOffset)) || 0;
				const scrollY = hasCustomScroll ? baseScrollY : adjustForPlacement(baseScrollY, {
					beaconPosition,
					lifecycle,
					scrollOffset: currentStep.scrollOffset,
					step: currentStep
				});
				log(debug, `step:${index}`, "scroll", hasCustomScroll ? "custom" : "document", `${baseScrollY} → ${scrollY}`);
				const scrollElement = scrollParent;
				const scrollData = {
					initial: scrollElement.scrollTop,
					target: scrollY,
					element: scrollElement,
					duration: scrollDuration
				};
				emitEvent(EVENTS.SCROLL_START, currentStep, { scroll: scrollData });
				const { cancel, promise } = scrollTo(scrollY, {
					element: scrollElement,
					duration: scrollDuration
				});
				cancelScrollRef.current = cancel;
				await promise;
				emitEvent(EVENTS.SCROLL_END, currentStep, { scroll: scrollData });
				store.current.updateState({ scrolling: false });
			};
			handleScroll().catch(() => {
				store.current.updateState({ scrolling: false });
			});
		}
	}, [
		emitEvent,
		index,
		lifecycle,
		positioned,
		scrolling,
		status,
		store
	]);
}
//#endregion
//#region src/hooks/useTourEngine.ts
function useTourEngine(props) {
	const mergedProps = useMemoDeepCompare(() => mergeProps(defaultProps, props), [props]);
	const { debug, initialStepIndex, onEvent, run, stepIndex, steps } = mergedProps;
	const store = useRef(createStore(mergedProps));
	const state = useSyncExternalStore(store.current.subscribe, store.current.getSnapshot, store.current.getServerSnapshot);
	const [failures, setFailures] = useState([]);
	const addFailure = useCallback((failedStep, reason) => {
		setFailures((previous) => [...previous, {
			reason,
			step: failedStep
		}]);
	}, []);
	const clearFailures = useCallback(() => {
		setFailures([]);
	}, []);
	useDebugLogger(store, debug);
	const controls = useControls(store, debug, clearFailures);
	const emitEvent = useEventEmitter(onEvent, controls, store);
	const { index, size, status } = state;
	const previousState = usePrevious(state);
	const step = useMemo(() => getMergedStep(mergedProps, steps[index]), [
		index,
		mergedProps,
		steps
	]);
	useMount(() => {
		if (run && size && validateSteps(steps, debug)) controls.start(stepIndex ?? initialStepIndex);
	});
	useUpdateEffect(() => {
		if (run && size && status === STATUS.IDLE) store.current.updateState({ status: STATUS.READY });
	}, [
		run,
		size,
		status
	]);
	usePropSync({
		controls,
		emitEvent,
		props: mergedProps,
		state,
		store
	});
	useLifecycleEffect({
		addFailure,
		controls,
		emitEvent,
		previousState,
		props: mergedProps,
		state,
		step,
		store
	});
	useScrollEffect({
		emitEvent,
		previousState,
		props: mergedProps,
		state,
		step,
		store
	});
	return {
		controls,
		failures,
		mergedProps,
		state,
		step,
		store
	};
}
//#endregion
//#region src/hooks/usePortalElement.ts
function usePortalElement(portalElement) {
	const [element, setElement] = useState(null);
	useEffect(() => {
		let createdElement = null;
		let isExternal = false;
		if (portalElement) if (is.domElement(portalElement)) {
			createdElement = portalElement;
			isExternal = true;
		} else {
			const portal = document.querySelector(portalElement);
			if (portal) createdElement = portal;
		}
		else {
			const portal = document.createElement("div");
			portal.id = PORTAL_ELEMENT_ID;
			document.body.appendChild(portal);
			createdElement = portal;
		}
		setElement(createdElement);
		return () => {
			if (!createdElement || isExternal) return;
			if (createdElement.parentNode === document.body) document.body.removeChild(createdElement);
		};
	}, [portalElement]);
	return element;
}
//#endregion
//#region src/components/Loader.tsx
const spinnerStyles = {
	animation: "joyride-loader-spin 1s linear infinite",
	border: "5px solid rgba(0, 0, 0, 0.1)",
	borderRadius: "50%",
	borderTopColor: "#555"
};
function JoyrideLoader({ nonce, step }) {
	const { loaderComponent } = step;
	const hasLoaderComponent = Boolean(loaderComponent);
	useEffect(() => {
		if (hasLoaderComponent) return noop;
		if (document.getElementById("joyride-loader-animation")) return noop;
		const style = document.createElement("style");
		style.id = "joyride-loader-animation";
		if (nonce) style.setAttribute("nonce", nonce);
		style.appendChild(document.createTextNode(`
        @keyframes joyride-loader-spin {
          to { transform: rotate(360deg); }
        }
      `));
		document.head.appendChild(style);
		return () => {
			const insertedStyle = document.getElementById("joyride-loader-animation");
			if (insertedStyle?.parentNode) insertedStyle.parentNode.removeChild(insertedStyle);
		};
	}, [hasLoaderComponent, nonce]);
	if (loaderComponent === null) return null;
	const { height, width, ...loaderStyle } = step.styles.loader;
	let content;
	if (loaderComponent) {
		const CustomLoader = loaderComponent;
		content = /* @__PURE__ */ React.createElement(CustomLoader, { step });
	} else content = /* @__PURE__ */ React.createElement("div", { style: {
		...spinnerStyles,
		height,
		width,
		borderTopColor: step.primaryColor
	} });
	return /* @__PURE__ */ React.createElement("div", {
		className: "react-joyride__loader",
		"data-testid": "loader",
		style: loaderStyle
	}, content);
}
//#endregion
//#region src/hooks/useTargetPosition.ts
const defaultRect = {
	height: 0,
	isFixed: false,
	left: 0,
	top: 0,
	width: 0
};
function computeRect(target, spotlightPadding) {
	const element = getElement(target);
	if (!element) return defaultRect;
	const elementRect = getClientRect(element);
	const isFixed = hasPosition(element);
	const top = getElementPosition(element, spotlightPadding.top, isFixed);
	return {
		height: Math.round((elementRect?.height ?? 0) + spotlightPadding.top + spotlightPadding.bottom),
		isFixed,
		left: Math.round((elementRect?.left ?? 0) - spotlightPadding.left),
		top,
		width: Math.round((elementRect?.width ?? 0) + spotlightPadding.left + spotlightPadding.right)
	};
}
function useTargetPosition(target, spotlightPadding, force) {
	const [rect, setRect] = useState(() => computeRect(target, spotlightPadding));
	const timeoutRef = useRef(void 0);
	const scrollParentRef = useRef(null);
	const previousForceRef = useRef(force);
	const observerRef = useRef(null);
	const updateRect = useCallback(() => {
		clearTimeout(timeoutRef.current);
		timeoutRef.current = window.setTimeout(() => {
			setRect((previous) => {
				const next = computeRect(target, spotlightPadding);
				if (previous.top === next.top && previous.left === next.left && previous.width === next.width && previous.height === next.height && previous.isFixed === next.isFixed) return previous;
				return next;
			});
		}, 100);
	}, [target, spotlightPadding]);
	useEffect(() => {
		let mutationObserver = null;
		const setup = (element) => {
			scrollParentRef.current = getScrollParent(element, true);
			if (scrollParentRef.current) scrollParentRef.current.addEventListener("scroll", updateRect, { passive: true });
			window.addEventListener("scroll", updateRect, { passive: true });
			window.addEventListener("resize", updateRect);
			if (typeof ResizeObserver !== "undefined") {
				observerRef.current = new ResizeObserver(updateRect);
				observerRef.current.observe(element);
			}
			setRect(computeRect(target, spotlightPadding));
		};
		const element = getElement(target);
		if (element) setup(element);
		else {
			mutationObserver = new MutationObserver(() => {
				const el = getElement(target);
				if (el) {
					mutationObserver?.disconnect();
					mutationObserver = null;
					setup(el);
				}
			});
			mutationObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
		}
		return () => {
			mutationObserver?.disconnect();
			if (scrollParentRef.current) scrollParentRef.current.removeEventListener("scroll", updateRect);
			window.removeEventListener("scroll", updateRect);
			window.removeEventListener("resize", updateRect);
			observerRef.current?.disconnect();
			clearTimeout(timeoutRef.current);
		};
	}, [
		target,
		spotlightPadding,
		updateRect
	]);
	useEffect(() => {
		if (previousForceRef.current && !force) setRect(computeRect(target, spotlightPadding));
		previousForceRef.current = force;
	}, [
		force,
		target,
		spotlightPadding
	]);
	let finalRect = rect;
	if (previousForceRef.current && !force) finalRect = computeRect(target, spotlightPadding);
	return finalRect;
}
//#endregion
//#region src/modules/svg.ts
function generateOverlayPath(overlayWidth, overlayHeight, cutout) {
	let path = `M0 0H${overlayWidth}V${overlayHeight}H0Z`;
	if (cutout) path += ` ${cutout}`;
	return path;
}
function generateSpotlightPath(x, y, width, height, borderRadius) {
	if (width <= 0 || height <= 0) return "";
	const r = Math.max(0, Math.min(borderRadius, width / 2, height / 2));
	let path = `M${x + r} ${y}`;
	path += `H${x + width - r}`;
	path += `A${r} ${r} 0 0 1 ${x + width} ${y + r}`;
	path += `V${y + height - r}`;
	path += `A${r} ${r} 0 0 1 ${x + width - r} ${y + height}`;
	path += `H${x + r}`;
	path += `A${r} ${r} 0 0 1 ${x} ${y + height - r}`;
	path += `V${y + r}`;
	path += `A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
	return path;
}
//#endregion
//#region src/components/Overlay.tsx
const hiddenLifecycles = [LIFECYCLE.BEACON_BEFORE, LIFECYCLE.BEACON];
function JoyrideOverlay(props) {
	const { blockTargetInteraction, continuous, hideOverlay, lifecycle, onClickOverlay, overlayClickAction, placement, portalElement, scrolling, spotlightPadding, spotlightRadius, spotlightTarget, styles, target, waiting } = props;
	const windowSize = useWindowSize();
	const targetRect = useTargetPosition(spotlightTarget ?? target, spotlightPadding, scrolling || waiting);
	const overlayRef = useRef(null);
	const svgRef = useRef(null);
	const showSpotlight = (lifecycle === LIFECYCLE.TOOLTIP || lifecycle === LIFECYCLE.TOOLTIP_BEFORE) && placement !== "center";
	const [spotlightReady, setSpotlightReady] = useState(false);
	const container = portalElement ? overlayRef.current?.offsetParent : null;
	const overlayWidth = container?.clientWidth ?? windowSize.width;
	const overlayHeight = container?.clientHeight ?? getDocumentHeight() ?? windowSize.height;
	const overlayColor = styles.overlay?.backgroundColor ?? "rgba(0, 0, 0, 0.5)";
	const overlayStyles = useMemo(() => {
		const { backgroundColor: _bg, mixBlendMode: _mbm, ...rest } = styles.overlay;
		return {
			height: overlayHeight,
			pointerEvents: "none",
			...rest
		};
	}, [overlayHeight, styles.overlay]);
	const showCutout = showSpotlight && !scrolling && !waiting;
	useEffect(() => {
		if (showCutout) requestAnimationFrame(() => setSpotlightReady(true));
		else setSpotlightReady(false);
	}, [showCutout]);
	const isHiddenInContinuous = continuous && hiddenLifecycles.includes(lifecycle);
	const isHiddenInNonContinuous = !continuous && lifecycle !== LIFECYCLE.TOOLTIP;
	if (hideOverlay || !waiting && (isHiddenInContinuous || isHiddenInNonContinuous)) return null;
	let coverPath = "";
	if (showCutout) {
		let originTop = 0;
		let originLeft = 0;
		const svg = svgRef.current;
		if (portalElement && svg && !targetRect.isFixed) {
			const rect = svg.getBoundingClientRect();
			originTop = rect.top + scrollDocument().scrollTop;
			originLeft = rect.left;
		}
		coverPath = generateSpotlightPath(targetRect.left - originLeft, targetRect.top - originTop, targetRect.width, targetRect.height, spotlightRadius);
	}
	const path = generateOverlayPath(overlayWidth, overlayHeight, coverPath);
	return /* @__PURE__ */ React.createElement("div", {
		ref: overlayRef,
		"aria-hidden": "true",
		className: "react-joyride__overlay",
		"data-testid": "overlay",
		style: overlayStyles
	}, /* @__PURE__ */ React.createElement("svg", {
		ref: svgRef,
		className: "react-joyride__spotlight",
		"data-testid": "spotlight",
		style: {
			height: overlayHeight,
			left: 0,
			position: targetRect.isFixed ? "fixed" : "absolute",
			top: 0,
			width: overlayWidth
		}
	}, /* @__PURE__ */ React.createElement("path", {
		d: path,
		fill: overlayColor,
		fillRule: "evenodd",
		onClick: onClickOverlay,
		style: {
			cursor: overlayClickAction ? "pointer" : "default",
			pointerEvents: "auto"
		}
	}), coverPath && /* @__PURE__ */ React.createElement("path", {
		d: coverPath,
		fill: overlayColor,
		style: {
			opacity: spotlightReady ? 0 : 1,
			pointerEvents: blockTargetInteraction ? "auto" : "none",
			transition: "opacity 0.2s"
		}
	}), coverPath && Object.keys(styles.spotlight).length > 0 && /* @__PURE__ */ React.createElement("path", {
		d: coverPath,
		fill: "none",
		style: { pointerEvents: "none" },
		...styles.spotlight
	})));
}
//#endregion
//#region src/components/Portal.tsx
function JoyridePortal(props) {
	const { children, element } = props;
	if (!element) return null;
	return createPortal(children, element);
}
//#endregion
//#region src/hooks/useFocusTrap.ts
const TABBABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), area[href], [tabindex]:not([tabindex=\"-1\"]), [contenteditable]";
function useFocusTrap(element, selector) {
	const previousFocus = useRef(null);
	useEffect(() => {
		if (!element) return noop;
		previousFocus.current = document.activeElement;
		const handleKeyDown = (event) => {
			if (event.key !== "Tab") return;
			const elements = [...element.querySelectorAll(TABBABLE_SELECTOR)];
			const { shiftKey } = event;
			if (!elements.length) return;
			event.preventDefault();
			let index = document.activeElement ? elements.indexOf(document.activeElement) : 0;
			if (index === -1 || !shiftKey && index + 1 === elements.length) index = 0;
			else if (shiftKey && index === 0) index = elements.length - 1;
			else index += shiftKey ? -1 : 1;
			elements[index].focus();
		};
		element.addEventListener("keydown", handleKeyDown, false);
		let timerId;
		if (selector) {
			const target = element.querySelector(selector);
			if (target) timerId = setTimeout(() => {
				target.focus({ preventScroll: true });
			}, 100);
		}
		return () => {
			element.removeEventListener("keydown", handleKeyDown);
			if (timerId !== void 0) clearTimeout(timerId);
			previousFocus.current?.focus({ preventScroll: true });
		};
	}, [element, selector]);
}
//#endregion
//#region src/components/Arrow.tsx
function getDimensions(placement, base, size) {
	const [side] = placement.split("-");
	switch (side) {
		case "top":
		case "bottom": return {
			width: base,
			height: size
		};
		case "left":
		case "right": return {
			width: size,
			height: base
		};
		default: return null;
	}
}
function getPoints(placement, base, size) {
	const [side] = placement.split("-");
	switch (side) {
		case "top": return {
			points: `0,0 ${base / 2},${size} ${base},0`,
			...getDimensions(placement, base, size)
		};
		case "bottom": return {
			points: `${base},${size} ${base / 2},0 0,${size}`,
			...getDimensions(placement, base, size)
		};
		case "left": return {
			points: `0,0 ${size},${base / 2} 0,${base}`,
			...getDimensions(placement, base, size)
		};
		case "right": return {
			points: `${size},${base} ${size},0 0,${base / 2}`,
			...getDimensions(placement, base, size)
		};
		default: return null;
	}
}
function getPositionStyle(placement, position, size, base) {
	if (!position) return {};
	const [side] = placement.split("-");
	switch (side) {
		case "top": return {
			bottom: -size,
			left: position.x ?? 0,
			...getDimensions(placement, base, size)
		};
		case "bottom": return {
			top: -size,
			left: position.x ?? 0,
			...getDimensions(placement, base, size)
		};
		case "left": return {
			right: -size,
			top: position.y ?? 0,
			...getDimensions(placement, base, size)
		};
		case "right": return {
			left: -size,
			top: position.y ?? 0,
			...getDimensions(placement, base, size)
		};
		default: return {};
	}
}
function Arrow({ arrowComponent, arrowRef, base, placement, position, size, styles }) {
	const ArrowComponent = arrowComponent;
	let content = null;
	if (ArrowComponent) {
		if (!getDimensions(placement, base, size)) return null;
		content = /* @__PURE__ */ React.createElement("span", { style: { flexShrink: 0 } }, /* @__PURE__ */ React.createElement(ArrowComponent, {
			base,
			placement,
			size
		}));
	} else {
		const svg = getPoints(placement, base, size);
		if (!svg) return null;
		content = /* @__PURE__ */ React.createElement("svg", {
			height: svg.height,
			width: svg.width,
			xmlns: "http://www.w3.org/2000/svg"
		}, /* @__PURE__ */ React.createElement("polygon", {
			fill: "currentColor",
			points: svg.points
		}));
	}
	return /* @__PURE__ */ React.createElement("span", {
		ref: arrowRef,
		className: "react-joyride__arrow",
		"data-testid": "arrow",
		style: {
			...styles,
			...getPositionStyle(placement, position, size, base),
			...position ? {} : { visibility: "hidden" }
		}
	}, content);
}
//#endregion
//#region src/components/Beacon.tsx
function JoyrideBeacon(props) {
	const { beaconComponent, continuous, index, isLastStep, locale, nonce, onInteract, shouldFocus, size, step, styles } = props;
	const beaconRef = useRef(null);
	const hasBeaconComponent = Boolean(beaconComponent);
	useEffect(() => {
		if (hasBeaconComponent) return noop;
		if (document.getElementById("joyride-beacon-animation")) return noop;
		const style = document.createElement("style");
		style.id = "joyride-beacon-animation";
		if (nonce) style.setAttribute("nonce", nonce);
		style.appendChild(document.createTextNode(`
        @keyframes joyride-beacon-inner {
          20% {
            opacity: 0.9;
          }

          90% {
            opacity: 0.7;
          }
        }

        @keyframes joyride-beacon-outer {
          0% {
            transform: scale(1);
          }

          45% {
            opacity: 0.7;
            transform: scale(0.75);
          }

          100% {
            opacity: 0.9;
            transform: scale(1);
          }
        }
      `));
		document.head.appendChild(style);
		const focusTimer = setTimeout(() => {
			if (is.domElement(beaconRef.current) && shouldFocus) beaconRef.current.focus();
		}, 0);
		return () => {
			clearTimeout(focusTimer);
			const insertedStyle = document.getElementById("joyride-beacon-animation");
			if (insertedStyle?.parentNode) insertedStyle.parentNode.removeChild(insertedStyle);
		};
	}, [
		hasBeaconComponent,
		nonce,
		shouldFocus
	]);
	const title = getReactNodeText(locale.open);
	let content;
	if (beaconComponent) {
		const BeaconComponent = beaconComponent;
		content = /* @__PURE__ */ React.createElement(BeaconComponent, {
			continuous,
			index,
			isLastStep,
			size,
			step
		});
	} else content = /* @__PURE__ */ React.createElement("span", { style: styles.beacon }, /* @__PURE__ */ React.createElement("span", { style: styles.beaconOuter }), /* @__PURE__ */ React.createElement("span", { style: styles.beaconInner }));
	return /* @__PURE__ */ React.createElement("button", {
		ref: beaconRef,
		"aria-label": title,
		className: "react-joyride__beacon",
		"data-testid": "button-beacon",
		onClick: onInteract,
		onMouseEnter: onInteract,
		style: styles.beaconWrapper,
		title,
		type: "button"
	}, content);
}
//#endregion
//#region src/components/Tooltip/CloseButton.tsx
function JoyrideTooltipCloseButton({ styles, ...props }) {
	const { color, height, width, ...style } = styles;
	return /* @__PURE__ */ React.createElement("button", {
		style,
		type: "button",
		...props
	}, /* @__PURE__ */ React.createElement("svg", {
		height: typeof height === "number" ? `${height}px` : height,
		preserveAspectRatio: "xMidYMid",
		version: "1.1",
		viewBox: "0 0 18 18",
		width: typeof width === "number" ? `${width}px` : width,
		xmlns: "http://www.w3.org/2000/svg"
	}, /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("path", {
		d: "M8.13911129,9.00268191 L0.171521827,17.0258467 C-0.0498027049,17.248715 -0.0498027049,17.6098394 0.171521827,17.8327545 C0.28204354,17.9443526 0.427188206,17.9998706 0.572051765,17.9998706 C0.71714958,17.9998706 0.862013139,17.9443526 0.972581703,17.8327545 L9.0000937,9.74924618 L17.0276057,17.8327545 C17.1384085,17.9443526 17.2832721,17.9998706 17.4281356,17.9998706 C17.5729992,17.9998706 17.718097,17.9443526 17.8286656,17.8327545 C18.0499901,17.6098862 18.0499901,17.2487618 17.8286656,17.0258467 L9.86135722,9.00268191 L17.8340066,0.973848225 C18.0553311,0.750979934 18.0553311,0.389855532 17.8340066,0.16694039 C17.6126821,-0.0556467968 17.254037,-0.0556467968 17.0329467,0.16694039 L9.00042166,8.25611765 L0.967006424,0.167268345 C0.745681892,-0.0553188426 0.387317931,-0.0553188426 0.165993399,0.167268345 C-0.0553311331,0.390136635 -0.0553311331,0.751261038 0.165993399,0.974176179 L8.13920499,9.00268191 L8.13911129,9.00268191 Z",
		fill: color
	}))));
}
//#endregion
//#region src/components/Tooltip/DefaultTooltip.tsx
function JoyrideDefaultTooltip(props) {
	const { backProps, closeProps, index, isLastStep, primaryProps, skipProps, step, tooltipProps } = props;
	const { buttons, content, styles, title } = step;
	const buttonElements = {};
	if (buttons.includes("primary")) buttonElements.primary = /* @__PURE__ */ React.createElement("button", {
		"data-testid": "button-primary",
		style: styles.buttonPrimary,
		type: "button",
		...primaryProps
	});
	if (buttons.includes("skip") && !isLastStep) buttonElements.skip = /* @__PURE__ */ React.createElement("button", {
		"aria-live": "off",
		"data-testid": "button-skip",
		style: styles.buttonSkip,
		type: "button",
		...skipProps
	});
	if (buttons.includes("back") && index > 0) buttonElements.back = /* @__PURE__ */ React.createElement("button", {
		"data-testid": "button-back",
		style: styles.buttonBack,
		type: "button",
		...backProps
	});
	buttonElements.close = buttons.includes("close") && /* @__PURE__ */ React.createElement(JoyrideTooltipCloseButton, {
		"data-testid": "button-close",
		styles: styles.buttonClose,
		...closeProps
	});
	const ariaProps = title ? {
		"aria-labelledby": "joyride-tooltip-title",
		"aria-describedby": "joyride-tooltip-content"
	} : {
		"aria-label": getReactNodeText(content),
		"aria-describedby": "joyride-tooltip-content"
	};
	return /* @__PURE__ */ React.createElement("div", {
		key: "JoyrideTooltip",
		className: "react-joyride__tooltip",
		"data-joyride-step": index,
		...step.id && { "data-joyride-id": step.id },
		style: styles.tooltip,
		...tooltipProps,
		...ariaProps
	}, /* @__PURE__ */ React.createElement("div", { style: styles.tooltipContainer }, title && /* @__PURE__ */ React.createElement("h4", {
		id: "joyride-tooltip-title",
		style: styles.tooltipTitle
	}, title), /* @__PURE__ */ React.createElement("div", {
		id: "joyride-tooltip-content",
		style: styles.tooltipContent
	}, content)), buttons.some((b) => b === "back" || b === "primary" || b === "skip") && /* @__PURE__ */ React.createElement("div", { style: styles.tooltipFooter }, /* @__PURE__ */ React.createElement("div", { style: styles.tooltipFooterSpacer }, buttonElements.skip), buttonElements.back, buttonElements.primary), buttonElements.close);
}
//#endregion
//#region src/components/Tooltip/index.tsx
function Tooltip(props) {
	const { continuous, controls, index, isLastStep, size, step } = props;
	const handleClickBack = (event) => {
		event.preventDefault();
		controls.prev(ORIGIN.BUTTON_BACK);
	};
	const handleClickClose = (event) => {
		event.preventDefault();
		if (step.closeButtonAction === "skip") controls.skip(ORIGIN.BUTTON_CLOSE);
		else if (step.closeButtonAction === "replay") controls.replay(ORIGIN.BUTTON_CLOSE);
		else controls.close(ORIGIN.BUTTON_CLOSE);
	};
	const handleClickPrimary = (event) => {
		event.preventDefault();
		if (!continuous) {
			controls.close(ORIGIN.BUTTON_PRIMARY);
			return;
		}
		controls.next(ORIGIN.BUTTON_PRIMARY);
	};
	const handleClickSkip = (event) => {
		event.preventDefault();
		controls.skip(ORIGIN.BUTTON_SKIP);
	};
	const getElementsProps = () => {
		const { back, close, last, next, nextWithProgress, skip } = step.locale;
		const backText = getReactNodeText(back);
		const closeText = getReactNodeText(close);
		const lastText = getReactNodeText(last);
		const nextText = getReactNodeText(next);
		const skipText = getReactNodeText(skip);
		let primary = close;
		let primaryText = closeText;
		if (continuous) {
			primary = next;
			primaryText = nextText;
			if (step.showProgress && !isLastStep) {
				const labelWithProgress = getReactNodeText(nextWithProgress, {
					step: index + 1,
					steps: size
				});
				primary = replaceLocaleContent(nextWithProgress, index + 1, size);
				primaryText = labelWithProgress;
			}
			if (isLastStep) {
				primary = last;
				primaryText = lastText;
			}
		}
		return {
			backProps: {
				"aria-label": backText,
				children: back,
				"data-action": "back",
				onClick: handleClickBack,
				role: "button",
				title: backText
			},
			closeProps: {
				"aria-label": closeText,
				children: close,
				"data-action": "close",
				onClick: handleClickClose,
				role: "button",
				title: closeText
			},
			primaryProps: {
				"aria-label": primaryText,
				children: primary,
				"data-action": "primary",
				onClick: handleClickPrimary,
				role: "button",
				title: primaryText
			},
			skipProps: {
				"aria-label": skipText,
				children: skip,
				"data-action": "skip",
				onClick: handleClickSkip,
				role: "button",
				title: skipText
			},
			tooltipProps: {
				"aria-modal": true,
				role: "alertdialog"
			}
		};
	};
	const { arrowComponent, beaconComponent, tooltipComponent, ...stepProps } = step;
	let component;
	if (tooltipComponent) {
		const TooltipComponent = tooltipComponent;
		component = /* @__PURE__ */ React.createElement(TooltipComponent, {
			...getElementsProps(),
			continuous,
			controls,
			index,
			isLastStep,
			size,
			step: stepProps
		});
	} else component = /* @__PURE__ */ React.createElement(JoyrideDefaultTooltip, {
		...getElementsProps(),
		continuous,
		controls,
		index,
		isLastStep,
		size,
		step: stepProps
	});
	return component;
}
//#endregion
//#region src/components/Floater.tsx
function getFallbackPlacements(placement) {
	if (placement.startsWith("left")) return ["top", "bottom"];
	if (placement.startsWith("right")) return ["bottom", "top"];
}
function getFlipMiddleware(isAuto, step, tooltipPlacement) {
	if (isAuto) return [autoPlacement()];
	if (step.floatingOptions?.flipOptions === false) return [];
	return [flip({
		crossAxis: false,
		fallbackPlacements: getFallbackPlacements(tooltipPlacement),
		padding: 20,
		...step.floatingOptions?.flipOptions
	})];
}
function JoyrideFloater(props) {
	const { continuous, controls, index, lifecycle, nonce, open, portalElement, setPositionData, setTooltipRef, shouldScroll, size, step, target, updateState } = props;
	const arrowRef = useRef(null);
	const beaconMiddlewareRef = useRef({});
	const tooltipMiddlewareRef = useRef({});
	const isCenter = step.placement === "center";
	const isAuto = step.placement === "auto";
	const centerReference = useMemo(() => ({ getBoundingClientRect: () => ({
		x: window.innerWidth / 2,
		y: window.innerHeight / 2,
		top: window.innerHeight / 2,
		left: window.innerWidth / 2,
		bottom: window.innerHeight / 2,
		right: window.innerWidth / 2,
		width: 0,
		height: 0
	}) }), []);
	const scrollParent = useMemo(() => hasCustomScrollParent(target) ? getScrollParent(target) : void 0, [target]);
	const isFixedTarget = useMemo(() => hasPosition(target), [target]);
	const boundaryOptions = useMemo(() => scrollParent ? {
		boundary: scrollParent,
		rootBoundary: "viewport"
	} : {}, [scrollParent]);
	const tooltipPlacement = isCenter || isAuto ? "bottom" : step.placement;
	const strategy = isCenter ? "fixed" : step.floatingOptions?.strategy ?? (step.isFixed || isFixedTarget ? "fixed" : "absolute");
	const tooltipMiddleware = useMemo(() => isCenter ? [{
		name: "center",
		fn: ({ rects }) => ({
			x: (window.innerWidth - rects.floating.width) / 2,
			y: (window.innerHeight - rects.floating.height) / 2
		})
	}] : [
		offset(({ placement: currentPlacement }) => {
			let side = "right";
			if (currentPlacement.startsWith("top")) side = "top";
			else if (currentPlacement.startsWith("bottom")) side = "bottom";
			else if (currentPlacement.startsWith("left")) side = "left";
			const padding = step.spotlightTarget ? 0 : step.spotlightPadding[side];
			return step.offset + padding + (step.floatingOptions?.hideArrow ? 0 : step.arrowSize);
		}, [
			step.offset,
			step.spotlightPadding,
			step.spotlightTarget,
			step.arrowSize,
			step.floatingOptions?.hideArrow
		]),
		...getFlipMiddleware(isAuto, step, tooltipPlacement),
		shift({
			padding: 10,
			...boundaryOptions,
			...step.floatingOptions?.shiftOptions
		}),
		...step.floatingOptions?.hideArrow ? [] : [arrow({
			element: arrowRef,
			padding: step.arrowSpacing
		}, [step.arrowSpacing, step.arrowBase])],
		...step.floatingOptions?.middleware ?? []
	], [
		isCenter,
		step,
		isAuto,
		tooltipPlacement,
		boundaryOptions
	]);
	const tooltipFloating = useFloating({
		...isCenter ? { elements: { reference: centerReference } } : {},
		placement: tooltipPlacement,
		strategy,
		middleware: tooltipMiddleware
	});
	const beaconFloating = useFloating({
		strategy,
		placement: step.beaconPlacement ?? (isAuto || isCenter ? "bottom" : step.placement),
		middleware: useMemo(() => [offset(step.floatingOptions?.beaconOptions?.offset ?? -18)], [step.floatingOptions?.beaconOptions?.offset]),
		whileElementsMounted: autoUpdate
	});
	tooltipMiddlewareRef.current = tooltipFloating.middlewareData;
	beaconMiddlewareRef.current = beaconFloating.middlewareData;
	useEffect(() => {
		const { floating, reference } = tooltipFloating.elements;
		if (!reference || !floating || lifecycle !== LIFECYCLE.TOOLTIP) return;
		return autoUpdate(reference, floating, tooltipFloating.update, step.floatingOptions?.autoUpdate);
	}, [
		lifecycle,
		tooltipFloating.update,
		step.floatingOptions?.autoUpdate,
		step.target,
		tooltipFloating.elements
	]);
	useEffect(() => {
		if (!isCenter && target) tooltipFloating.refs.setReference(target);
		if (target) beaconFloating.refs.setReference(target);
	}, [
		beaconFloating.refs,
		isCenter,
		target,
		tooltipFloating.refs
	]);
	useEffect(() => {
		if (tooltipFloating.isPositioned) setPositionData("tooltip", {
			placement: tooltipFloating.placement,
			x: tooltipFloating.x ?? 0,
			y: tooltipFloating.y ?? 0,
			middlewareData: tooltipMiddlewareRef.current
		});
	}, [
		setPositionData,
		tooltipFloating.isPositioned,
		tooltipFloating.placement,
		tooltipFloating.x,
		tooltipFloating.y
	]);
	useEffect(() => {
		if (beaconFloating.isPositioned) setPositionData("beacon", {
			placement: beaconFloating.placement,
			x: beaconFloating.x ?? 0,
			y: beaconFloating.y ?? 0,
			middlewareData: beaconMiddlewareRef.current
		});
	}, [
		setPositionData,
		beaconFloating.isPositioned,
		beaconFloating.placement,
		beaconFloating.x,
		beaconFloating.y
	]);
	const zIndex = step.zIndex + 1;
	const handleBeaconInteraction = useCallback((event) => {
		if (event.type === "mouseenter" && step.beaconTrigger !== "hover") return;
		updateState({
			lifecycle: LIFECYCLE.TOOLTIP_BEFORE,
			positioned: false
		});
	}, [step.beaconTrigger, updateState]);
	const floaterRef = useCallback((node) => {
		if (node) {
			tooltipFloating.refs.setFloating(node);
			setTooltipRef(node);
		}
	}, [tooltipFloating.refs, setTooltipRef]);
	const { arrow: arrowStyles, floater: floaterStyles } = step.styles;
	let content = null;
	if (lifecycle === LIFECYCLE.TOOLTIP || lifecycle === LIFECYCLE.TOOLTIP_BEFORE) {
		const styles = sortObjectKeys({
			...floaterStyles,
			...tooltipFloating.floatingStyles,
			zIndex,
			opacity: open && tooltipFloating.isPositioned ? 1 : 0,
			...!open && { transition: "none" }
		});
		content = /* @__PURE__ */ React.createElement("div", {
			ref: floaterRef,
			className: "react-joyride__floater",
			"data-testid": "floater",
			id: `react-joyride-step-${index}`,
			style: styles
		}, /* @__PURE__ */ React.createElement(Tooltip, {
			continuous,
			controls,
			index,
			isLastStep: index + 1 === size,
			size,
			step
		}), !isCenter && !step.floatingOptions?.hideArrow && /* @__PURE__ */ React.createElement(Arrow, {
			arrowComponent: step.arrowComponent,
			arrowRef,
			base: step.arrowBase,
			placement: tooltipFloating.placement,
			position: tooltipFloating.middlewareData.arrow,
			size: step.arrowSize,
			styles: arrowStyles
		}));
	} else if (lifecycle === LIFECYCLE.BEACON || lifecycle === LIFECYCLE.BEACON_BEFORE) content = /* @__PURE__ */ React.createElement("div", {
		ref: beaconFloating.refs.setFloating,
		className: "react-joyride__floater",
		"data-testid": "floater-beacon",
		id: `react-joyride-step-${index}-beacon`,
		style: sortObjectKeys({
			...beaconFloating.floatingStyles,
			zIndex
		})
	}, /* @__PURE__ */ React.createElement(JoyrideBeacon, {
		beaconComponent: step.beaconComponent,
		continuous,
		index,
		isLastStep: index + 1 === size,
		locale: step.locale,
		nonce,
		onInteract: handleBeaconInteraction,
		shouldFocus: shouldScroll,
		size,
		step,
		styles: step.styles
	}));
	return /* @__PURE__ */ React.createElement(JoyridePortal, { element: portalElement }, content);
}
//#endregion
//#region src/components/Step.tsx
function JoyrideStep(props) {
	const { continuous, controls, index, lifecycle, nonce, portalElement, setPositionData, shouldScroll, size, step, updateState } = props;
	const [tooltipElement, setTooltipElement] = useState(null);
	useFocusTrap(step.disableFocusTrap ? null : tooltipElement, "[data-action=primary]");
	const target = getElement(step.target);
	const open = lifecycle === LIFECYCLE.TOOLTIP;
	if (!validateStep(step) || !is.domElement(target)) return null;
	return /* @__PURE__ */ React.createElement(JoyrideFloater, {
		key: `JoyrideStep-${index}`,
		continuous,
		controls,
		index,
		lifecycle,
		nonce,
		open,
		portalElement,
		setPositionData,
		setTooltipRef: setTooltipElement,
		shouldScroll,
		size,
		step,
		target,
		updateState
	});
}
//#endregion
//#region src/components/TourRenderer.tsx
function TourRenderer({ controls, mergedProps, state, step, store }) {
	const { continuous, debug, nonce, portalElement, scrollToFirstStep } = mergedProps;
	const element = usePortalElement(portalElement);
	const { index, lifecycle, status } = state;
	const isRunning = status === STATUS.RUNNING;
	const [showLoader, setShowLoader] = useState(false);
	const loaderTimerRef = useRef(null);
	const loaderDelay = step?.loaderDelay ?? 0;
	useEffect(() => {
		if (state.waiting) if (loaderDelay === 0) setShowLoader(true);
		else loaderTimerRef.current = setTimeout(() => {
			setShowLoader(true);
		}, loaderDelay);
		else setShowLoader(false);
		return () => {
			if (loaderTimerRef.current) {
				clearTimeout(loaderTimerRef.current);
				loaderTimerRef.current = null;
			}
		};
	}, [loaderDelay, state.waiting]);
	useEffect(() => {
		if (!isRunning) return;
		const handleKeyboard = (event) => {
			if (!step || lifecycle !== LIFECYCLE.TOOLTIP) return;
			if (event.key === "Escape" && step.dismissKeyAction) if (step.dismissKeyAction === "next") controls.next(ORIGIN.KEYBOARD);
			else if (step.dismissKeyAction === "replay") controls.replay(ORIGIN.KEYBOARD);
			else controls.close(ORIGIN.KEYBOARD);
		};
		document.body.addEventListener("keydown", handleKeyboard, { passive: true });
		return () => {
			document.body.removeEventListener("keydown", handleKeyboard);
		};
	}, [
		controls,
		isRunning,
		lifecycle,
		step
	]);
	const handleClickOverlay = useCallback(() => {
		switch (step?.overlayClickAction) {
			case "close":
				controls.close(ORIGIN.OVERLAY);
				break;
			case "next":
				controls.next(ORIGIN.OVERLAY);
				break;
			case "replay":
				controls.replay(ORIGIN.OVERLAY);
				break;
		}
	}, [controls, step?.overlayClickAction]);
	if (!step || !isRunning) return null;
	const hideOverlay = state.action === ACTIONS.START && !step.skipBeacon && step.placement !== "center";
	return /* @__PURE__ */ React.createElement(React.Fragment, null, lifecycle !== LIFECYCLE.INIT && /* @__PURE__ */ React.createElement(JoyrideStep, {
		...state,
		continuous,
		controls,
		debug,
		nonce,
		portalElement: element,
		setPositionData: store.current.setPositionData,
		shouldScroll: !step.skipScroll && (index !== 0 || scrollToFirstStep),
		step,
		updateState: store.current.updateState
	}), /* @__PURE__ */ React.createElement(JoyridePortal, { element }, /* @__PURE__ */ React.createElement(React.Fragment, null, showLoader && /* @__PURE__ */ React.createElement(JoyrideLoader, {
		nonce,
		step
	}), !hideOverlay && /* @__PURE__ */ React.createElement(JoyrideOverlay, {
		...step,
		continuous,
		lifecycle,
		onClickOverlay: handleClickOverlay,
		portalElement: portalElement ? element : null,
		scrolling: state.scrolling,
		waiting: state.waiting
	}))));
}
//#endregion
//#region src/hooks/useJoyride.tsx
function useJoyride(props) {
	const { controls, failures, mergedProps, state, step, store } = useTourEngine(props);
	return {
		controls,
		failures,
		on: useCallback((eventType, handler) => store.current.on(eventType, handler), [store]),
		state: useMemo(() => omit(state, "positioned"), [state]),
		step,
		Tour: canUseDOM() ? /* @__PURE__ */ React.createElement(TourRenderer, {
			controls,
			mergedProps,
			state,
			step,
			store
		}) : null
	};
}
//#endregion
//#region src/index.tsx
function JoyrideTour(props) {
	const { Tour } = useJoyride(props);
	return Tour;
}
function Joyride(props) {
	if (!canUseDOM()) return null;
	return /* @__PURE__ */ React.createElement(JoyrideTour, props);
}
//#endregion
export { ACTIONS, EVENTS, Joyride, LIFECYCLE, ORIGIN, PORTAL_ELEMENT_ID, STATUS, defaultLocale, defaultOptions, useJoyride };

//# sourceMappingURL=index.mjs.map