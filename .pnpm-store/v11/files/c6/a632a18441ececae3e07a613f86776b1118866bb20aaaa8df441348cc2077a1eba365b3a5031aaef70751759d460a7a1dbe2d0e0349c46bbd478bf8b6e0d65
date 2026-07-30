import { areSelectionsEqual } from "../utils/areSelectionsEqual.js";
import { areSelectionPointsEqual } from "../utils/areSelectionPointsEqual.js";
import { createGutterUtilityElement } from "../utils/createGutterUtilityElement.js";
import { toHtml } from "hast-util-to-html";
//#region src/managers/InteractionManager.ts
var InteractionManager = class {
	mode;
	options;
	hoveredLine;
	hoveredToken;
	pre;
	gutterUtilityLine;
	gutterUtilityContainer;
	gutterUtilityButton;
	gutterUtilitySlot;
	interactiveLinesAttr = false;
	interactiveLineNumbersAttr = false;
	hasPointerListeners = false;
	hasDocumentPointerListeners = false;
	selectedRange = null;
	proposedSelectedRange;
	renderedSelectionRange;
	selectionAnchor;
	queuedSelectionRender;
	pointerSession = { mode: "idle" };
	constructor(mode, options) {
		this.mode = mode;
		this.options = options;
	}
	setOptions(options) {
		this.options = options;
	}
	cleanUp() {
		this.pre?.removeEventListener("click", this.handlePointerClick);
		this.pre?.removeEventListener("pointerdown", this.handlePointerDown);
		this.pre?.removeEventListener("pointermove", this.handlePointerMove);
		this.pre?.removeEventListener("pointerleave", this.handlePointerLeave);
		this.pre?.removeAttribute("data-interactive-lines");
		this.pre?.removeAttribute("data-interactive-line-numbers");
		this.pre = void 0;
		this.gutterUtilityContainer?.remove();
		this.gutterUtilityLine = void 0;
		this.gutterUtilityContainer = void 0;
		this.gutterUtilityButton = void 0;
		this.gutterUtilitySlot = void 0;
		this.clearHoveredLine();
		this.clearHoveredToken();
		this.detachDocumentPointerListeners();
		this.clearPointerSession();
		if (this.queuedSelectionRender != null) {
			cancelAnimationFrame(this.queuedSelectionRender);
			this.queuedSelectionRender = void 0;
		}
		this.interactiveLinesAttr = false;
		this.interactiveLineNumbersAttr = false;
		this.hasPointerListeners = false;
	}
	setup(pre) {
		this.setSelectionDirty();
		const { usesCustomGutterUtility = false, enableGutterUtility = false } = this.options;
		if (this.pre !== pre) {
			this.cleanUp();
			this.pre = pre;
		}
		if (enableGutterUtility) this.ensureGutterUtilityNode(usesCustomGutterUtility);
		else if (this.gutterUtilityContainer != null) {
			this.gutterUtilityContainer.remove();
			this.gutterUtilityLine = void 0;
			this.gutterUtilityContainer = void 0;
			this.gutterUtilityButton = void 0;
			this.gutterUtilitySlot = void 0;
			if (this.pointerSession.mode === "gutterSelecting") {
				this.clearPointerSession();
				this.detachDocumentPointerListeners();
			}
		}
		this.syncPointerListeners(pre);
		this.updateInteractiveLineAttributes();
		this.renderSelection();
		this.placeUtility();
	}
	setSelectionDirty() {
		this.renderedSelectionRange = void 0;
	}
	isSelectionDirty() {
		return this.renderedSelectionRange === null;
	}
	setSelection(range, options) {
		const isRangeChange = !(range === this.selectedRange || areSelectionsEqual(range ?? void 0, this.selectedRange ?? void 0));
		if (!this.isSelectionDirty() && !isRangeChange) return;
		this.proposedSelectedRange = void 0;
		this.selectedRange = range;
		this.renderSelection();
		this.placeUtility();
		if (isRangeChange && options?.notify !== false) this.notifySelectionCommitted();
	}
	getSelection() {
		return this.selectedRange;
	}
	getHoveredLine = () => {
		const gutterUtilityLine = this.gutterUtilityLine ?? this.hoveredLine;
		if (gutterUtilityLine != null) {
			if (this.mode === "diff" && gutterUtilityLine.type === "diff-line") return {
				lineNumber: gutterUtilityLine.lineNumber,
				side: gutterUtilityLine.annotationSide
			};
			if (this.mode === "file" && gutterUtilityLine.type === "line") return { lineNumber: gutterUtilityLine.lineNumber };
		}
	};
	handlePointerClick = (event) => {
		const { onHunkExpand, onLineClick, onLineNumberClick, onTokenClick, onMergeConflictActionClick } = this.options;
		if (onHunkExpand == null && onLineClick == null && onLineNumberClick == null && onMergeConflictActionClick == null && onTokenClick == null) return;
		if (this.options.onGutterUtilityClick != null && isGutterUtilityPath(event.composedPath())) return;
		debugLogIfEnabled(this.options.__debugPointerEvents, "click", "FileDiff.DEBUG.handlePointerClick:", event);
		this.handlePointerEvent({
			eventType: "click",
			event
		});
	};
	handlePointerMove = (event) => {
		if (event.pointerType !== "mouse") return;
		const { lineHoverHighlight = "disabled", onLineEnter, onLineLeave, onTokenEnter, onTokenLeave, enableGutterUtility = false } = this.options;
		if (lineHoverHighlight === "disabled" && !enableGutterUtility && onLineEnter == null && onLineLeave == null && onTokenEnter == null && onTokenLeave == null) return;
		debugLogIfEnabled(this.options.__debugPointerEvents, "move", "FileDiff.DEBUG.handlePointerMove:", event);
		this.handlePointerEvent({
			eventType: "move",
			event
		});
	};
	handlePointerLeave = (event) => {
		const { __debugPointerEvents } = this.options;
		debugLogIfEnabled(__debugPointerEvents, "move", "FileDiff.DEBUG.handlePointerLeave: no event");
		if (this.hoveredLine == null && this.hoveredToken == null) {
			debugLogIfEnabled(__debugPointerEvents, "move", "FileDiff.DEBUG.handlePointerLeave: returned early, no hovered line or token");
			return;
		}
		if (this.hoveredToken != null) {
			this.options.onTokenLeave?.(this.hoveredToken, event);
			this.clearHoveredToken();
		}
		if (this.hoveredLine != null) {
			this.options.onLineLeave?.({
				...this.hoveredLine,
				event
			});
			this.clearHoveredLine();
		}
		this.placeUtility();
	};
	handlePointerEvent({ eventType, event }) {
		const { __debugPointerEvents } = this.options;
		const composedPath = event.composedPath();
		debugLogIfEnabled(__debugPointerEvents, eventType, "FileDiff.DEBUG.handlePointerEvent:", {
			eventType,
			composedPath
		});
		const target = this.resolvePointerTarget(composedPath);
		debugLogIfEnabled(__debugPointerEvents, eventType, "FileDiff.DEBUG.handlePointerEvent: resolvePointerTarget result:", target);
		const { onLineClick, onLineNumberClick, onLineEnter, onLineLeave, onTokenClick, onTokenEnter, onTokenLeave, onHunkExpand, onMergeConflictActionClick } = this.options;
		switch (eventType) {
			case "move": {
				const sameLine = isHoverableLinePointerTarget(target) && this.hoveredLine?.lineElement === target.lineElement;
				if (!(isTokenPointerTarget(target) && this.hoveredToken?.tokenElement === target.tokenElement)) {
					if (this.hoveredToken != null) {
						onTokenLeave?.(this.hoveredToken, event);
						this.clearHoveredToken();
					}
					if (isTokenPointerTarget(target)) {
						this.setHoveredToken(this.toTokenEventBaseProps(target));
						onTokenEnter?.(this.hoveredToken, event);
					}
				}
				if (!sameLine) {
					if (this.hoveredLine != null) {
						onLineLeave?.({
							...this.hoveredLine,
							event
						});
						this.clearHoveredLine();
					}
					if (isHoverableLinePointerTarget(target)) {
						this.setHoveredLine(this.toEventBaseProps(target));
						this.placeUtility();
						onLineEnter?.({
							...this.hoveredLine,
							event
						});
					} else this.placeUtility();
				}
				break;
			}
			case "click": {
				if (target == null) break;
				if (isMergeConflictActionPointerTarget(target) && onMergeConflictActionClick != null) {
					onMergeConflictActionClick(target);
					break;
				}
				if (isExpandoPointerTarget(target) && onHunkExpand != null) {
					onHunkExpand(target.hunkIndex, target.all || event.shiftKey ? "both" : target.direction, target.all || event.shiftKey ? Number.POSITIVE_INFINITY : void 0);
					break;
				}
				if (!isHoverableLinePointerTarget(target)) break;
				if (isTokenPointerTarget(target) && onTokenClick != null) onTokenClick(this.toTokenEventBaseProps(target), event);
				const eventBase = this.toEventBaseProps(target);
				if (onLineNumberClick != null && target.numberColumn) onLineNumberClick({
					...eventBase,
					event
				});
				else if (onLineClick != null) onLineClick({
					...eventBase,
					event
				});
				break;
			}
		}
	}
	syncPointerListeners(pre) {
		const { __debugPointerEvents, lineHoverHighlight = "disabled", onLineClick, onLineNumberClick, onLineEnter, onLineLeave, onTokenClick, onTokenEnter, onTokenLeave, onHunkExpand, onMergeConflictActionClick, enableGutterUtility = false, enableLineSelection = false, onGutterUtilityClick } = this.options;
		const enableGutterSelection = onGutterUtilityClick != null;
		const shouldAttachPointerListeners = lineHoverHighlight !== "disabled" || onLineClick != null || onLineNumberClick != null || onLineEnter != null || onLineLeave != null || onTokenClick != null || onTokenEnter != null || onTokenLeave != null || onHunkExpand != null || onMergeConflictActionClick != null || enableGutterUtility || enableLineSelection || enableGutterSelection;
		if (shouldAttachPointerListeners && !this.hasPointerListeners) {
			pre.addEventListener("click", this.handlePointerClick);
			pre.addEventListener("pointerdown", this.handlePointerDown);
			pre.addEventListener("pointermove", this.handlePointerMove);
			pre.addEventListener("pointerleave", this.handlePointerLeave);
			this.hasPointerListeners = true;
			debugLogIfEnabled(__debugPointerEvents, "click", "FileDiff.DEBUG.attachEventListeners: Attaching click events for:", (() => {
				const reasons = [];
				if (__debugPointerEvents === "both" || __debugPointerEvents === "click") {
					if (onLineClick != null) reasons.push("onLineClick");
					if (onLineNumberClick != null) reasons.push("onLineNumberClick");
					if (onHunkExpand != null) reasons.push("expandable hunk separators");
					if (onMergeConflictActionClick != null) reasons.push("merge conflict actions");
				}
				return reasons;
			})());
			debugLogIfEnabled(__debugPointerEvents, "move", "FileDiff.DEBUG.attachEventListeners: Attaching pointer move event");
			debugLogIfEnabled(__debugPointerEvents, "move", "FileDiff.DEBUG.attachEventListeners: Attaching pointer leave event");
		} else if (!shouldAttachPointerListeners && this.hasPointerListeners) {
			pre.removeEventListener("click", this.handlePointerClick);
			pre.removeEventListener("pointerdown", this.handlePointerDown);
			pre.removeEventListener("pointermove", this.handlePointerMove);
			pre.removeEventListener("pointerleave", this.handlePointerLeave);
			this.hasPointerListeners = false;
		}
		const hasActiveLineSelectionSession = this.pointerSession.mode === "selecting" || this.pointerSession.mode === "pendingSingleLineUnselect";
		const hasActiveGutterSelectionSession = this.pointerSession.mode === "gutterSelecting";
		if (!enableLineSelection && hasActiveLineSelectionSession || !enableGutterSelection && hasActiveGutterSelectionSession) {
			this.clearPointerSession();
			this.detachDocumentPointerListeners();
			this.selectionAnchor = void 0;
			this.clearPendingSingleLineState();
		}
	}
	updateInteractiveLineAttributes() {
		if (this.pre == null) return;
		const { onLineClick, onLineNumberClick, enableLineSelection = false } = this.options;
		const shouldHaveInteractiveLines = onLineClick != null;
		const shouldHaveInteractiveLineNumbers = onLineNumberClick != null || enableLineSelection;
		if (shouldHaveInteractiveLines && !this.interactiveLinesAttr) {
			this.pre.setAttribute("data-interactive-lines", "");
			this.interactiveLinesAttr = true;
		} else if (!shouldHaveInteractiveLines && this.interactiveLinesAttr) {
			this.pre.removeAttribute("data-interactive-lines");
			this.interactiveLinesAttr = false;
		}
		if (shouldHaveInteractiveLineNumbers && !this.interactiveLineNumbersAttr) {
			this.pre.setAttribute("data-interactive-line-numbers", "");
			this.interactiveLineNumbersAttr = true;
		} else if (!shouldHaveInteractiveLineNumbers && this.interactiveLineNumbersAttr) {
			this.pre.removeAttribute("data-interactive-line-numbers");
			this.interactiveLineNumbersAttr = false;
		}
	}
	handlePointerDown = (event) => {
		if (event.pointerType === "mouse" && event.button !== 0 || this.pre == null || this.pointerSession.mode !== "idle") return;
		const path = event.composedPath();
		if (isGutterUtilityPath(path) && this.options.onGutterUtilityClick != null) this.startGutterSelectionFromPointerDown(event);
		else {
			if (event.pointerType !== "mouse") this.revealUtilityFromGutterPath(path);
			this.startLineSelectionFromPointerDown(event);
		}
	};
	startLineSelectionFromPointerDown(event) {
		const { enableLineSelection = false } = this.options;
		if (!enableLineSelection) return;
		const pointerInfo = this.resolveSelectionInfo(event, {
			source: "event-path",
			requireNumberColumn: true
		});
		if (pointerInfo == null) return;
		const { pre } = this;
		if (pre == null) return;
		const { lineNumber, eventSide, lineIndex } = pointerInfo;
		if (event.shiftKey && this.selectedRange != null) {
			const rowRange = this.getIndexesFromSelection(this.selectedRange, pre.getAttribute("data-diff-type") === "split");
			if (rowRange == null) return;
			const useStart = rowRange.start <= rowRange.end ? lineIndex >= rowRange.start : lineIndex <= rowRange.end;
			this.selectionAnchor = {
				lineNumber: useStart ? this.selectedRange.start : this.selectedRange.end,
				side: useStart ? this.selectedRange.side : this.selectedRange.endSide ?? this.selectedRange.side
			};
			this.updateSelection(lineNumber, eventSide, false);
			this.notifySelectionStart(this.getCurrentSelectionRange());
			this.pointerSession = {
				mode: "selecting",
				pointerId: event.pointerId
			};
			this.attachDocumentPointerListeners();
			return;
		}
		if (this.selectedRange?.start === lineNumber && this.selectedRange?.end === lineNumber) {
			const point = {
				lineNumber,
				side: eventSide
			};
			this.selectionAnchor = point;
			this.pointerSession = {
				mode: "pendingSingleLineUnselect",
				pointerId: event.pointerId,
				anchor: point,
				pending: point
			};
			this.attachDocumentPointerListeners();
			return;
		}
		if (this.options.controlledSelection === true) this.proposedSelectedRange = null;
		else this.selectedRange = null;
		this.placeUtility();
		this.selectionAnchor = {
			lineNumber,
			side: eventSide
		};
		this.updateSelection(lineNumber, eventSide, false);
		this.notifySelectionStart(this.getCurrentSelectionRange());
		this.pointerSession = {
			mode: "selecting",
			pointerId: event.pointerId
		};
		this.attachDocumentPointerListeners();
	}
	startGutterSelectionFromPointerDown(event) {
		const { enableLineSelection = false, onGutterUtilityClick } = this.options;
		if (onGutterUtilityClick == null) return;
		const selectedEndpoints = this.currentSelectionEnds();
		const point = selectedEndpoints?.bottom ?? this.resolveSelectionPoint(event, {
			source: "event-path",
			excludeUtility: false
		});
		const anchor = selectedEndpoints?.top ?? point;
		if (point == null || anchor == null) return;
		event.preventDefault();
		event.stopPropagation();
		this.pointerSession = {
			mode: "gutterSelecting",
			pointerId: event.pointerId,
			anchor,
			current: point
		};
		if (enableLineSelection) {
			this.selectionAnchor = {
				lineNumber: anchor.lineNumber,
				side: anchor.side
			};
			this.updateSelection(point.lineNumber, point.side, false);
			this.notifySelectionStart(this.getCurrentSelectionRange());
		}
		this.attachDocumentPointerListeners();
	}
	handleDocumentPointerMove = (event) => {
		const { enableLineSelection = false } = this.options;
		switch (this.pointerSession.mode) {
			case "idle": return;
			case "gutterSelecting": {
				if (event.pointerId !== this.pointerSession.pointerId) return;
				event.preventDefault();
				const point = this.resolveSelectionPoint(event, { source: "coordinates-first" });
				if (point == null) return;
				this.pointerSession.current = point;
				if (enableLineSelection === true) this.updateSelection(point.lineNumber, point.side);
				return;
			}
			case "selecting": {
				if (event.pointerId !== this.pointerSession.pointerId) return;
				event.preventDefault();
				const pointerInfo = this.resolveSelectionInfo(event, {
					source: "coordinates-first",
					requireNumberColumn: false
				});
				if (pointerInfo == null || this.selectionAnchor == null) return;
				this.updateSelection(pointerInfo.lineNumber, pointerInfo.eventSide);
				return;
			}
			case "pendingSingleLineUnselect": {
				if (event.pointerId !== this.pointerSession.pointerId) return;
				event.preventDefault();
				const pointerInfo = this.resolveSelectionInfo(event, {
					source: "coordinates-first",
					requireNumberColumn: false
				});
				if (pointerInfo == null || this.selectionAnchor == null) return;
				const point = {
					lineNumber: pointerInfo.lineNumber,
					side: pointerInfo.eventSide
				};
				if (areSelectionPointsEqual(this.pointerSession.pending, point)) return;
				this.updateSelection(pointerInfo.lineNumber, pointerInfo.eventSide, false);
				this.notifySelectionStart(this.getCurrentSelectionRange());
				this.notifySelectionChangeDelta();
				this.pointerSession = {
					mode: "selecting",
					pointerId: event.pointerId
				};
				return;
			}
		}
	};
	handleDocumentPointerUp = (event) => {
		const { enableLineSelection = false, onGutterUtilityClick } = this.options;
		switch (this.pointerSession.mode) {
			case "idle": return;
			case "gutterSelecting": {
				if (event.pointerId !== this.pointerSession.pointerId) return;
				event.preventDefault();
				const point = this.resolveSelectionPoint(event, { source: "coordinates-first" });
				if (point != null) {
					this.pointerSession.current = point;
					if (enableLineSelection) this.updateSelection(point.lineNumber, point.side);
				}
				onGutterUtilityClick?.(this.buildSelectedLineRange(this.pointerSession.anchor, this.pointerSession.current));
				this.selectionAnchor = void 0;
				if (enableLineSelection) {
					this.notifySelectionEnd(this.getCurrentSelectionRange());
					this.notifySelectionCommitted();
					this.clearProposedSelection();
				}
				this.clearPointerSession();
				this.detachDocumentPointerListeners();
				return;
			}
			case "pendingSingleLineUnselect":
				if (event.pointerId !== this.pointerSession.pointerId) return;
				event.preventDefault();
				this.updateSelection(null, void 0, false);
				this.selectionAnchor = void 0;
				this.clearPendingSingleLineState();
				this.detachDocumentPointerListeners();
				this.notifySelectionEnd(this.getCurrentSelectionRange());
				this.notifySelectionCommitted();
				this.clearProposedSelection();
				return;
			case "selecting":
				if (event.pointerId !== this.pointerSession.pointerId) return;
				event.preventDefault();
				this.selectionAnchor = void 0;
				this.detachDocumentPointerListeners();
				this.clearPointerSession();
				this.notifySelectionEnd(this.getCurrentSelectionRange());
				this.notifySelectionCommitted();
				this.clearProposedSelection();
		}
	};
	handleDocumentPointerCancel = (event) => {
		switch (this.pointerSession.mode) {
			case "idle": return;
			case "gutterSelecting":
			case "selecting":
			case "pendingSingleLineUnselect":
				if ("pointerId" in this.pointerSession) {
					if (event.pointerId !== this.pointerSession.pointerId) return;
				}
				this.selectionAnchor = void 0;
				this.clearProposedSelection();
				this.clearPendingSingleLineState();
				this.clearPointerSession();
				this.detachDocumentPointerListeners();
		}
	};
	clearHoveredLine() {
		if (this.hoveredLine == null) return;
		this.hoveredLine.lineElement.removeAttribute("data-hovered");
		this.hoveredLine.numberElement.removeAttribute("data-hovered");
		this.hoveredLine = void 0;
	}
	setHoveredLine(hoveredLine) {
		const { lineHoverHighlight = "disabled" } = this.options;
		if (this.hoveredLine != null) this.clearHoveredLine();
		this.hoveredLine = hoveredLine;
		if (lineHoverHighlight !== "disabled") {
			if (lineHoverHighlight === "both" || lineHoverHighlight === "line") this.hoveredLine.lineElement.setAttribute("data-hovered", "");
			if (lineHoverHighlight === "both" || lineHoverHighlight === "number") this.hoveredLine.numberElement.setAttribute("data-hovered", "");
		}
	}
	clearHoveredToken() {
		if (this.hoveredToken == null) return;
		this.hoveredToken = void 0;
	}
	setHoveredToken(hoveredToken) {
		if (this.hoveredToken != null) this.clearHoveredToken();
		this.hoveredToken = hoveredToken;
	}
	ensureGutterUtilityNode(useCustomGutterUtility) {
		if (this.gutterUtilityContainer == null) {
			this.gutterUtilityContainer = document.createElement("div");
			this.gutterUtilityContainer.setAttribute("data-gutter-utility-slot", "");
		}
		if (useCustomGutterUtility) {
			if (this.gutterUtilityButton != null) {
				this.gutterUtilityButton.remove();
				this.gutterUtilityButton = void 0;
			}
			if (this.gutterUtilitySlot == null) {
				this.gutterUtilitySlot = document.createElement("slot");
				this.gutterUtilitySlot.name = "gutter-utility-slot";
			}
			if (this.gutterUtilitySlot.parentNode !== this.gutterUtilityContainer) this.gutterUtilityContainer.replaceChildren(this.gutterUtilitySlot);
		} else {
			this.gutterUtilitySlot?.remove();
			this.gutterUtilitySlot = void 0;
			if (this.gutterUtilityButton == null) {
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = toHtml(createGutterUtilityElement());
				const utilityButton = tempDiv.firstElementChild;
				if (!(utilityButton instanceof HTMLButtonElement)) throw new Error("InteractionManager.ensureGutterUtilityNode: Node element should be a button");
				utilityButton.remove();
				this.gutterUtilityButton = utilityButton;
			}
			if (this.gutterUtilityButton.parentNode !== this.gutterUtilityContainer) this.gutterUtilityContainer.replaceChildren(this.gutterUtilityButton);
		}
	}
	revealUtilityFromGutterPath(path) {
		if (this.placeUtilityFromSelection()) return;
		const target = this.resolvePointerTarget(path);
		if (isLinePointerTarget(target) && target.numberColumn) this.showUtilityOnLine(this.toEventBaseProps(target));
	}
	placeUtility() {
		if (this.placeUtilityFromSelection()) return;
		if (this.hoveredLine != null) {
			this.showUtilityOnLine(this.hoveredLine);
			return;
		}
		this.hideUtility();
	}
	placeUtilityFromSelection() {
		const endpoints = this.currentSelectionEnds();
		if (endpoints == null) return false;
		const target = this.targetForSelectionPoint(endpoints.bottom);
		if (target == null) this.hideUtility();
		else this.showUtilityOnLine(this.toEventBaseProps(target));
		return true;
	}
	showUtilityOnLine(line) {
		if (this.gutterUtilityContainer == null) return;
		this.gutterUtilityLine = line;
		line.numberElement.appendChild(this.gutterUtilityContainer);
	}
	hideUtility() {
		this.gutterUtilityContainer?.remove();
		this.gutterUtilityLine = void 0;
	}
	currentSelectionEnds() {
		const range = this.getCurrentSelectionRange();
		return range == null ? void 0 : this.selectionEnds(range);
	}
	selectionEnds(range) {
		const start = {
			lineNumber: range.start,
			side: range.side
		};
		const end = {
			lineNumber: range.end,
			side: range.endSide ?? range.side
		};
		const startIndex = this.selectionPointRowIndex(start);
		const endIndex = this.selectionPointRowIndex(end);
		if (startIndex == null || endIndex == null) return;
		return startIndex > endIndex ? {
			top: end,
			bottom: start
		} : {
			top: start,
			bottom: end
		};
	}
	selectionPointRowIndex(point) {
		const indexes = this.getLineIndex(point.lineNumber, point.side);
		if (indexes == null) return;
		return this.isSplitDiff() ? indexes[1] : indexes[0];
	}
	targetForSelectionPoint(point) {
		if (this.pre == null) return;
		const indexes = this.getLineIndex(point.lineNumber, point.side);
		if (indexes == null) return;
		const lineIndex = this.mode === "diff" ? `${indexes[0]},${indexes[1]}` : `${indexes[0]}`;
		const candidates = this.pre.querySelectorAll(`[data-column-number="${point.lineNumber}"][data-line-index="${lineIndex}"]`);
		for (const element of candidates) {
			if (!(element instanceof HTMLElement)) continue;
			const target = this.resolvePointerTarget(getElementPath(element));
			if (!isLinePointerTarget(target)) continue;
			if (this.mode === "diff" && point.side != null && target.side !== point.side) continue;
			return target;
		}
	}
	attachDocumentPointerListeners() {
		if (this.hasDocumentPointerListeners) return;
		document.addEventListener("pointermove", this.handleDocumentPointerMove);
		document.addEventListener("pointerup", this.handleDocumentPointerUp);
		document.addEventListener("pointercancel", this.handleDocumentPointerCancel);
		this.hasDocumentPointerListeners = true;
	}
	detachDocumentPointerListeners() {
		if (!this.hasDocumentPointerListeners) return;
		document.removeEventListener("pointermove", this.handleDocumentPointerMove);
		document.removeEventListener("pointerup", this.handleDocumentPointerUp);
		document.removeEventListener("pointercancel", this.handleDocumentPointerCancel);
		this.hasDocumentPointerListeners = false;
	}
	clearPointerSession() {
		this.pointerSession = { mode: "idle" };
	}
	clearPendingSingleLineState() {
		if (this.pointerSession.mode === "pendingSingleLineUnselect") this.pointerSession = { mode: "idle" };
	}
	selectionInfoFromPath(path, requireNumberColumn) {
		const target = this.resolvePointerTarget(path);
		if (!isLinePointerTarget(target)) return;
		if (requireNumberColumn && !target.numberColumn) return;
		if (target.splitLineIndex == null) return;
		return {
			lineIndex: target.splitLineIndex,
			lineNumber: target.lineNumber,
			eventSide: this.mode === "diff" ? target.side : void 0
		};
	}
	resolveSelectionInfo(event, options) {
		const path = this.resolveSelectionPath(event, options);
		return path != null ? this.selectionInfoFromPath(path, options.requireNumberColumn) : void 0;
	}
	selectionPointFromPath(path) {
		const target = this.resolvePointerTarget(path);
		if (!isLinePointerTarget(target)) return;
		return {
			lineNumber: target.lineNumber,
			side: this.mode === "diff" ? target.side : void 0
		};
	}
	resolveSelectionPoint(event, options) {
		const path = this.resolveSelectionPath(event, options);
		return path != null ? this.selectionPointFromPath(path) : void 0;
	}
	resolveSelectionPath(event, options) {
		const excludeUtility = options.excludeUtility !== false;
		switch (options.source) {
			case "event-path": return this.pathFromEventPath(event.composedPath(), excludeUtility);
			case "coordinates-first": {
				const coordinatePath = this.pathFromCoordinates(event, excludeUtility);
				if (coordinatePath !== void 0) return coordinatePath ?? void 0;
				return this.pathFromEventPath(event.composedPath(), excludeUtility);
			}
		}
	}
	pathFromCoordinates(event, excludeUtility) {
		const coordinateTarget = this.hitTest(event);
		if (coordinateTarget === void 0) return;
		if (coordinateTarget === null) return null;
		return this.pathFromElement(coordinateTarget, excludeUtility) ?? null;
	}
	pathFromEventPath(path, excludeUtility) {
		if (excludeUtility && isGutterUtilityPath(path)) return;
		for (const element of path) if (element instanceof Element) return this.pathFromElement(element, excludeUtility);
	}
	pathFromElement(element, excludeUtility) {
		const path = getElementPath(element);
		if (excludeUtility && isGutterUtilityPath(path)) return;
		const row = closestSelectableRow(element);
		if (row != null) return getElementPath(row);
		return this.pathFromAnnotationSlot(element);
	}
	pathFromAnnotationSlot(element) {
		const point = selectionPointFromAnnotationSlotName(getAnnotationSlotName(element));
		if (point == null) return;
		const target = this.targetForSelectionPoint(point);
		return target != null ? getElementPath(target.lineElement) : void 0;
	}
	hitTest(event) {
		if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
		const root = this.pre?.getRootNode();
		const elementFromPointRoot = hasElementFromPoint(root) ? root : hasElementFromPoint(document) ? document : void 0;
		if (elementFromPointRoot == null) return;
		return elementFromPointRoot.elementFromPoint(event.clientX, event.clientY);
	}
	getLineIndex(lineNumber, side) {
		const { getLineIndex } = this.options;
		return getLineIndex != null ? getLineIndex(lineNumber, side) : [lineNumber - 1, lineNumber - 1];
	}
	getCurrentSelectionRange() {
		return this.proposedSelectedRange !== void 0 ? this.proposedSelectedRange : this.selectedRange;
	}
	clearProposedSelection() {
		this.proposedSelectedRange = void 0;
	}
	updateSelection(currentLine, side, emitChange = true) {
		const previousRange = this.getCurrentSelectionRange();
		let nextRange;
		if (currentLine == null) nextRange = null;
		else {
			const anchorSide = this.selectionAnchor?.side ?? side;
			const anchorLine = this.selectionAnchor?.lineNumber ?? currentLine;
			nextRange = this.buildSelectionRange(anchorLine, currentLine, anchorSide, side);
		}
		if (areSelectionsEqual(previousRange ?? void 0, nextRange ?? void 0)) return;
		if (this.options.controlledSelection === true) this.proposedSelectedRange = nextRange;
		else {
			this.selectedRange = nextRange;
			this.queuedSelectionRender ??= requestAnimationFrame(this.renderSelection);
		}
		this.placeUtility();
		if (emitChange) this.notifySelectionChangeDelta();
	}
	getIndexesFromSelection(selectedRange, split) {
		if (this.pre == null) return;
		const startIndexes = this.getLineIndex(selectedRange.start, selectedRange.side);
		const finalIndexes = this.getLineIndex(selectedRange.end, selectedRange.endSide ?? selectedRange.side);
		return startIndexes != null && finalIndexes != null ? {
			start: split ? startIndexes[1] : startIndexes[0],
			end: split ? finalIndexes[1] : finalIndexes[0]
		} : void 0;
	}
	renderSelection = () => {
		if (this.queuedSelectionRender != null) {
			cancelAnimationFrame(this.queuedSelectionRender);
			this.queuedSelectionRender = void 0;
		}
		if (this.pre == null || this.renderedSelectionRange === this.selectedRange) return;
		const allSelected = this.pre.querySelectorAll("[data-selected-line]");
		for (const element of allSelected) element.removeAttribute("data-selected-line");
		this.renderedSelectionRange = this.selectedRange;
		if (this.selectedRange == null) return;
		const { children: codeElements } = this.pre;
		if (codeElements.length === 0) return;
		if (codeElements.length > 2) {
			console.error(codeElements);
			throw new Error("InteractionManager.renderSelection: Somehow there are more than 2 code elements...");
		}
		const split = this.pre.getAttribute("data-diff-type") === "split";
		const rowRange = this.getIndexesFromSelection(this.selectedRange, split);
		if (rowRange == null) {
			console.error({
				rowRange,
				selectedRange: this.selectedRange
			});
			throw new Error("InteractionManager.renderSelection: No valid rowRange");
		}
		const isSingle = rowRange.start === rowRange.end;
		const first = Math.min(rowRange.start, rowRange.end);
		const last = Math.max(rowRange.start, rowRange.end);
		for (const code of codeElements) {
			const [gutter, content] = code.children;
			const len = content.children.length;
			if (len !== gutter.children.length) throw new Error("InteractionManager.renderSelection: gutter and content children dont match, something is wrong");
			for (let i = 0; i < len; i++) {
				const contentElement = content.children[i];
				const gutterElement = gutter.children[i];
				if (!(contentElement instanceof HTMLElement) || !(gutterElement instanceof HTMLElement)) continue;
				const lineIndex = this.parseLineIndex(contentElement, split);
				if ((lineIndex ?? 0) > last) break;
				if (lineIndex == null || lineIndex < first) continue;
				let attributeValue = isSingle ? "single" : lineIndex === first ? "first" : lineIndex === last ? "last" : "";
				contentElement.setAttribute("data-selected-line", attributeValue);
				gutterElement.setAttribute("data-selected-line", attributeValue);
				if (gutterElement.nextSibling instanceof HTMLElement && contentElement.nextSibling instanceof HTMLElement && (contentElement.nextSibling.hasAttribute("data-line-annotation") || contentElement.nextSibling.hasAttribute("data-merge-conflict-actions"))) {
					if (isSingle) {
						attributeValue = "last";
						contentElement.setAttribute("data-selected-line", "first");
					} else if (lineIndex === first) attributeValue = "";
					else if (lineIndex === last) contentElement.setAttribute("data-selected-line", "");
					contentElement.nextSibling.setAttribute("data-selected-line", attributeValue);
					gutterElement.nextSibling.setAttribute("data-selected-line", attributeValue);
				}
			}
		}
	};
	notifySelectionCommitted() {
		this.options.onLineSelected?.(this.getCurrentSelectionRange() ?? null);
	}
	notifySelectionChangeDelta() {
		this.options.onLineSelectionChange?.(this.getCurrentSelectionRange() ?? null);
	}
	notifySelectionStart(range) {
		this.options.onLineSelectionStart?.(range);
	}
	notifySelectionEnd(range) {
		this.options.onLineSelectionEnd?.(range);
	}
	toEventBaseProps(target) {
		if (this.mode === "file") return {
			type: "line",
			lineElement: target.lineElement,
			lineNumber: target.lineNumber,
			numberColumn: target.numberColumn,
			numberElement: target.numberElement
		};
		return {
			type: "diff-line",
			annotationSide: target.side,
			lineType: target.lineType,
			lineElement: target.lineElement,
			numberElement: target.numberElement,
			lineNumber: target.lineNumber,
			numberColumn: target.numberColumn
		};
	}
	toTokenEventBaseProps({ lineCharEnd, lineCharStart, lineNumber, side, tokenElement, tokenText }) {
		if (this.mode === "file") return {
			type: "token",
			lineCharEnd,
			lineCharStart,
			lineNumber,
			tokenElement,
			tokenText
		};
		return {
			type: "token",
			lineCharEnd,
			lineCharStart,
			lineNumber,
			side,
			tokenElement,
			tokenText
		};
	}
	buildSelectedLineRange(anchor, current) {
		return this.buildSelectionRange(anchor.lineNumber, current.lineNumber, anchor.side, current.side);
	}
	buildSelectionRange(start, end, side, endSide) {
		return {
			start,
			end,
			...side != null ? { side } : {},
			...side !== endSide && endSide != null ? { endSide } : {}
		};
	}
	resolvePointerTarget(path) {
		let numberColumn = false;
		let lineType;
		let codeElement;
		let lineElement;
		let lineIndexValue;
		let numberElement;
		let tokenElement;
		let tokenInfo;
		let expandInfo;
		let lineNumber;
		let mergeConflictActionTarget;
		for (const element of path) {
			if (!(element instanceof HTMLElement)) continue;
			if (mergeConflictActionTarget == null && element.hasAttribute("data-merge-conflict-action")) {
				const resolutionValue = element.getAttribute("data-merge-conflict-action") ?? void 0;
				const conflictIndexValue = element.getAttribute("data-merge-conflict-conflict-index") ?? void 0;
				const conflictIndex = conflictIndexValue != null ? Number.parseInt(conflictIndexValue, 10) : NaN;
				if (isMergeConflictResolution(resolutionValue) && Number.isFinite(conflictIndex)) mergeConflictActionTarget = {
					kind: "merge-conflict-action",
					resolution: resolutionValue,
					conflictIndex
				};
			}
			if (tokenElement == null && element.hasAttribute("data-char")) {
				tokenElement = element;
				const startAttr = element.getAttribute("data-char");
				if (startAttr != null) {
					const lineCharStart = Number.parseInt(startAttr, 10);
					if (!Number.isNaN(lineCharStart)) {
						const tokenText = element.textContent ?? "";
						const lineCharEnd = lineCharStart + tokenText.length;
						if (tokenText.trim() !== "" || this.options.enableTokenInteractionsOnWhitespace === true) tokenInfo = {
							tokenElement,
							lineCharStart,
							lineCharEnd,
							tokenText
						};
						continue;
					}
				}
			}
			const columnNumber = numberElement == null ? element.getAttribute("data-column-number") ?? void 0 : void 0;
			if (columnNumber != null) {
				numberElement = element;
				lineNumber = Number.parseInt(columnNumber, 10);
				numberColumn = true;
				lineType = getLineTypeFromElement(element);
				lineIndexValue = element.getAttribute("data-line-index") ?? void 0;
				continue;
			}
			const lineAttr = lineElement == null ? element.getAttribute("data-line") ?? void 0 : void 0;
			if (lineAttr != null) {
				lineElement = element;
				lineNumber = Number.parseInt(lineAttr, 10);
				lineType = getLineTypeFromElement(element);
				lineIndexValue = element.getAttribute("data-line-index") ?? void 0;
				continue;
			}
			if (expandInfo == null && (element.hasAttribute("data-expand-button") || element.hasAttribute("data-unmodified-lines"))) {
				expandInfo = {
					hunkIndex: void 0,
					direction: (() => {
						if (element.hasAttribute("data-expand-up")) return "up";
						if (element.hasAttribute("data-expand-down")) return "down";
						return "both";
					})(),
					all: element.hasAttribute("data-expand-all-button")
				};
				continue;
			}
			const expandIndexValue = expandInfo != null ? element.getAttribute("data-expand-index") ?? void 0 : void 0;
			if (expandInfo != null && expandIndexValue != null) {
				const expandIndex = Number.parseInt(expandIndexValue, 10);
				if (!Number.isNaN(expandIndex)) expandInfo.hunkIndex = expandIndex;
				continue;
			}
			if (codeElement == null && element.hasAttribute("data-code")) {
				codeElement = element;
				break;
			}
		}
		if (mergeConflictActionTarget != null) return mergeConflictActionTarget;
		if (expandInfo?.hunkIndex != null) return {
			type: "line-info",
			hunkIndex: expandInfo.hunkIndex,
			direction: expandInfo.direction,
			all: expandInfo.all
		};
		lineElement ??= lineIndexValue != null ? queryHTMLElement(codeElement, `[data-line][data-line-index="${lineIndexValue}"]`) : void 0;
		numberElement ??= lineIndexValue != null ? queryHTMLElement(codeElement, `[data-column-number][data-line-index="${lineIndexValue}"]`) : void 0;
		if (codeElement == null || lineElement == null || numberElement == null || lineType == null || lineNumber == null || Number.isNaN(lineNumber)) return;
		const splitLineIndex = this.parseLineIndex(lineElement, this.isSplitDiff());
		if (tokenInfo != null) {
			if (this.mode === "file") return {
				kind: "token",
				lineType,
				lineElement,
				lineNumber,
				numberColumn,
				numberElement,
				side: void 0,
				splitLineIndex,
				...tokenInfo
			};
			return {
				kind: "token",
				lineType,
				lineElement,
				lineNumber,
				numberColumn,
				numberElement,
				side: getAnnotationSide(lineType, codeElement),
				splitLineIndex,
				...tokenInfo
			};
		}
		if (this.mode === "file") return {
			kind: "line",
			lineType,
			lineElement,
			lineNumber,
			numberColumn,
			numberElement,
			side: void 0,
			splitLineIndex
		};
		return {
			kind: "line",
			lineType,
			lineElement,
			lineNumber,
			numberColumn,
			numberElement,
			side: getAnnotationSide(lineType, codeElement),
			splitLineIndex
		};
	}
	isSplitDiff() {
		return this.pre?.getAttribute("data-diff-type") === "split";
	}
	parseLineIndex(element, split) {
		const lineIndexes = (element.getAttribute("data-line-index") ?? "").split(",").map((value) => Number.parseInt(value, 10)).filter((value) => !Number.isNaN(value));
		if (split && lineIndexes.length === 2) return lineIndexes[1];
		if (!split) return lineIndexes[0];
	}
};
function pluckInteractionOptions({ enableTokenInteractionsOnWhitespace, enableGutterUtility, lineHoverHighlight, onGutterUtilityClick, onLineClick, onLineEnter, onLineLeave, onLineNumberClick, onTokenClick, onTokenEnter, onTokenLeave, renderGutterUtility, __debugPointerEvents, enableLineSelection, controlledSelection, onLineSelected, onLineSelectionStart, onLineSelectionChange, onLineSelectionEnd }, onHunkExpand, getLineIndex, onMergeConflictActionClick) {
	return {
		enableTokenInteractionsOnWhitespace,
		enableGutterUtility: resolveEnableGutterUtilityOption({
			enableGutterUtility,
			renderGutterUtility,
			onGutterUtilityClick
		}),
		usesCustomGutterUtility: renderGutterUtility != null,
		lineHoverHighlight,
		onGutterUtilityClick,
		onHunkExpand,
		onMergeConflictActionClick,
		onLineClick,
		onLineEnter,
		onLineLeave,
		onLineNumberClick,
		onTokenClick,
		onTokenEnter,
		onTokenLeave,
		__debugPointerEvents,
		enableLineSelection,
		controlledSelection,
		onLineSelected,
		onLineSelectionStart,
		onLineSelectionChange,
		onLineSelectionEnd,
		getLineIndex
	};
}
function resolveEnableGutterUtilityOption({ enableGutterUtility, renderGutterUtility, onGutterUtilityClick }) {
	if (onGutterUtilityClick != null && renderGutterUtility != null) throw new Error("Cannot use both 'onGutterUtilityClick' and 'renderGutterUtility'. Use only one gutter utility API.");
	return enableGutterUtility ?? false;
}
function isLinePointerTarget(target) {
	return target != null && "kind" in target && target.kind === "line";
}
function isTokenPointerTarget(target) {
	return target != null && "kind" in target && target.kind === "token";
}
function isHoverableLinePointerTarget(target) {
	return isLinePointerTarget(target) || isTokenPointerTarget(target);
}
function isExpandoPointerTarget(target) {
	return "type" in target && target.type === "line-info";
}
function isMergeConflictActionPointerTarget(target) {
	return "kind" in target && target.kind === "merge-conflict-action";
}
function isMergeConflictResolution(value) {
	return value === "current" || value === "incoming" || value === "both";
}
function queryHTMLElement(parent, query) {
	const element = parent?.querySelector(query);
	return element instanceof HTMLElement ? element : void 0;
}
function getElementPath(element) {
	const path = [];
	let current = element;
	while (current != null) {
		path.push(current);
		current = current.parentNode;
	}
	return path;
}
function closestSelectableRow(element) {
	const row = element.closest("[data-line], [data-column-number]");
	if (row instanceof HTMLElement) return row;
	const annotationRow = element.closest("[data-line-annotation], [data-gutter-buffer=\"annotation\"]");
	if (!(annotationRow instanceof HTMLElement)) return;
	const previousRow = annotationRow.previousElementSibling;
	return previousRow instanceof HTMLElement && (previousRow.hasAttribute("data-line") || previousRow.hasAttribute("data-column-number")) ? previousRow : void 0;
}
function getAnnotationSlotName(element) {
	const slottedElement = element.closest("[slot^=\"annotation-\"]");
	if (slottedElement instanceof HTMLElement) return slottedElement.getAttribute("slot") ?? void 0;
	if (element instanceof HTMLElement) {
		const slotName = element.getAttribute("name") ?? void 0;
		return slotName != null && slotName.startsWith("annotation-") ? slotName : void 0;
	}
}
function selectionPointFromAnnotationSlotName(slotName) {
	if (slotName == null) return;
	const match = /^annotation-(?:(additions|deletions)-)?(\d+)$/.exec(slotName);
	if (match == null) return;
	const lineNumber = Number.parseInt(match[2], 10);
	if (!Number.isFinite(lineNumber) || lineNumber <= 0) return;
	return {
		lineNumber,
		side: match[1]
	};
}
function hasElementFromPoint(value) {
	return value != null && typeof value.elementFromPoint === "function";
}
function getAnnotationSide(lineType, codeElement) {
	switch (lineType) {
		case "change-deletion": return "deletions";
		case "change-addition": return "additions";
		default: return codeElement.hasAttribute("data-deletions") ? "deletions" : "additions";
	}
}
function getLineTypeFromElement(element) {
	const lineType = element.getAttribute("data-line-type");
	if (lineType == null) return;
	switch (lineType) {
		case "change-deletion":
		case "change-addition":
		case "context":
		case "context-expanded": return lineType;
		default: return;
	}
}
function isGutterUtilityPath(path) {
	for (const element of path) {
		if (!(element instanceof HTMLElement)) continue;
		if (element.hasAttribute("data-utility-button") || element.hasAttribute("data-gutter-utility-slot") || element.getAttribute("slot") === "gutter-utility-slot" || element.getAttribute("name") === "gutter-utility-slot") return true;
	}
	return false;
}
function debugLogIfEnabled(debugLogType = "none", logIfType, ...args) {
	switch (debugLogType) {
		case "none": return;
		case "both": break;
		case "click":
			if (logIfType !== "click") return;
			break;
		case "move":
			if (logIfType !== "move") return;
			break;
	}
	console.log(...args);
}
//#endregion
export { InteractionManager, pluckInteractionOptions };

//# sourceMappingURL=InteractionManager.js.map