import { DEFAULT_THEMES } from "../constants.js";
import { queueRender } from "../managers/UniversalRenderingManager.js";
import { getSharedHighlighter } from "../highlighter/shared_highlighter.js";
import { getHighlighterOptions } from "../utils/getHighlighterOptions.js";
import { formatCSSVariablePrefix } from "../utils/formatCSSVariablePrefix.js";
import { getHighlighterThemeStyles } from "../utils/getHighlighterThemeStyles.js";
import { getMeasuredScrollbarGutter } from "../utils/scrollbarGutter.js";
import { wrapThemeCSS } from "../utils/cssWrappers.js";
import { getOrCreateCodeNode } from "../utils/getOrCreateCodeNode.js";
import { upsertHostThemeStyle } from "../utils/hostTheme.js";
import { setPreNodeProperties } from "../utils/setWrapperNodeProps.js";
import { CodeToTokenTransformStream } from "../shiki-stream/stream.js";
import { createSpanFromToken } from "../utils/createSpanNodeFromToken.js";
//#region src/components/FileStream.ts
let instanceId = -1;
var FileStream = class {
	options;
	__id = `file-stream:${++instanceId}`;
	highlighter;
	stream;
	abortController;
	fileContainer;
	pre;
	code;
	gutterElement;
	contentElement;
	themeCSSStyle;
	appliedThemeCSS;
	currentRowCount = 0;
	constructor(options = { theme: DEFAULT_THEMES }) {
		this.options = options;
		this.currentLineIndex = this.options.startingLineIndex ?? 1;
	}
	cleanUp() {
		this.abortController?.abort();
		this.abortController = void 0;
	}
	setThemeType(themeType) {
		if ((this.options.themeType ?? "system") === themeType) return;
		this.options = {
			...this.options,
			themeType
		};
		if (typeof this.options.theme === "string" || this.fileContainer == null || this.appliedThemeCSS == null) return;
		this.applyThemeState(this.fileContainer, this.appliedThemeCSS.themeStyles, themeType, this.appliedThemeCSS.baseThemeType);
	}
	async initializeHighlighter() {
		this.highlighter = await getSharedHighlighter(getHighlighterOptions(this.options.lang, this.options));
		return this.highlighter;
	}
	queuedSetupArgs;
	async setup(_source, _wrapper) {
		const isSettingUp = this.queuedSetupArgs != null;
		this.queuedSetupArgs = [_source, _wrapper];
		if (isSettingUp) return;
		this.highlighter ??= await this.initializeHighlighter();
		const [source, wrapper] = this.queuedSetupArgs;
		this.queuedSetupArgs = void 0;
		const stream = source;
		this.setupStream(stream, wrapper, this.highlighter);
	}
	setupStream(stream, wrapper, highlighter) {
		const { disableLineNumbers = false, overflow = "scroll", theme = DEFAULT_THEMES, themeType = "system" } = this.options;
		const fileContainer = this.getOrCreateFileContainer();
		if (fileContainer.parentElement == null) wrapper.appendChild(fileContainer);
		this.pre ??= document.createElement("pre");
		if (this.pre.parentElement == null) fileContainer.shadowRoot?.appendChild(this.pre);
		const baseThemeType = typeof theme === "string" ? highlighter.getTheme(theme).type : void 0;
		const themeStyles = getHighlighterThemeStyles({
			theme,
			highlighter
		});
		this.applyThemeState(fileContainer, themeStyles, themeType, baseThemeType);
		const pre = setPreNodeProperties(this.pre, {
			type: "file",
			diffIndicators: "none",
			disableBackground: true,
			disableLineNumbers,
			overflow,
			split: false,
			totalLines: 0
		});
		pre.textContent = "";
		this.pre = pre;
		this.code = getOrCreateCodeNode({
			code: this.code,
			pre
		});
		this.gutterElement = void 0;
		this.contentElement = void 0;
		this.currentRowCount = 0;
		this.currentLineElement = void 0;
		this.currentLineIndex = this.options.startingLineIndex ?? 1;
		this.abortController?.abort();
		this.abortController = new AbortController();
		const { onStreamStart, onStreamClose, onStreamAbort } = this.options;
		this.stream?.cancel().catch(() => {});
		this.stream = stream;
		this.stream.pipeThrough(typeof theme === "string" ? new CodeToTokenTransformStream({
			...this.options,
			theme,
			highlighter,
			allowRecalls: true,
			defaultColor: false,
			cssVariablePrefix: formatCSSVariablePrefix("token"),
			tokenizeTimeLimit: 0
		}) : new CodeToTokenTransformStream({
			...this.options,
			themes: theme,
			highlighter,
			allowRecalls: true,
			defaultColor: false,
			cssVariablePrefix: formatCSSVariablePrefix("token"),
			tokenizeTimeLimit: 0
		})).pipeTo(new WritableStream({
			start(controller) {
				onStreamStart?.(controller);
			},
			close() {
				onStreamClose?.();
			},
			abort(reason) {
				onStreamAbort?.(reason);
			},
			write: this.handleWrite
		}), { signal: this.abortController.signal }).catch((error) => {
			if (error.name !== "AbortError") console.error("FileStream pipe error:", error);
		});
	}
	queuedTokens = [];
	handleWrite = (token) => {
		if ("recall" in token && this.queuedTokens.length >= token.recall) this.queuedTokens.length = this.queuedTokens.length - token.recall;
		else this.queuedTokens.push(token);
		queueRender(this.render);
		this.options.onStreamWrite?.(token);
	};
	currentLineIndex;
	currentLineElement;
	render = () => {
		this.options.onPreRender?.(this);
		const { gutter, content } = this.getOrCreateStreamColumns();
		const gutterFragment = document.createDocumentFragment();
		const contentFragment = document.createDocumentFragment();
		for (const token of this.queuedTokens) if ("recall" in token) {
			if (this.currentLineElement == null) throw new Error("FileStream.render: no current line element, shouldnt be possible to get here");
			if (token.recall > this.currentLineElement.childNodes.length) throw new Error(`FileStream.render: Token recall exceed the current line, there's probably a bug...`);
			for (let i = 0; i < token.recall; i++) this.currentLineElement.lastChild?.remove();
		} else {
			const span = createSpanFromToken(token);
			if (this.currentLineElement == null) {
				const { gutterLine, contentLine } = this.createLine();
				gutterFragment.appendChild(gutterLine);
				contentFragment.appendChild(contentLine);
			}
			this.currentLineElement?.appendChild(span);
			if (token.content === "\n") {
				this.currentLineIndex++;
				const { gutterLine, contentLine } = this.createLine();
				gutterFragment.appendChild(gutterLine);
				contentFragment.appendChild(contentLine);
			}
		}
		if (gutterFragment.childNodes.length > 0) gutter.appendChild(gutterFragment);
		if (contentFragment.childNodes.length > 0) content.appendChild(contentFragment);
		this.queuedTokens.length = 0;
		this.options.onPostRender?.(this);
	};
	getOrCreateStreamColumns() {
		if (this.code == null) throw new Error("FileStream: expected code element to exist");
		if (this.gutterElement != null && this.contentElement != null) return {
			gutter: this.gutterElement,
			content: this.contentElement
		};
		const gutter = document.createElement("div");
		gutter.dataset.gutter = "";
		const content = document.createElement("div");
		content.dataset.content = "";
		this.code.appendChild(gutter);
		this.code.appendChild(content);
		this.gutterElement = gutter;
		this.contentElement = content;
		return {
			gutter,
			content
		};
	}
	updateRowSpan() {
		if (this.gutterElement != null) this.gutterElement.style.gridRow = `span ${this.currentRowCount}`;
		if (this.contentElement != null) this.contentElement.style.gridRow = `span ${this.currentRowCount}`;
	}
	createLine() {
		const lineNumber = this.currentLineIndex;
		const lineIndex = `${lineNumber - 1}`;
		const gutterLine = document.createElement("div");
		gutterLine.dataset.columnNumber = `${lineNumber}`;
		gutterLine.dataset.lineType = "context";
		gutterLine.dataset.lineIndex = lineIndex;
		const numberContent = document.createElement("span");
		numberContent.dataset.lineNumberContent = "";
		numberContent.textContent = `${lineNumber}`;
		gutterLine.appendChild(numberContent);
		const contentLine = document.createElement("div");
		contentLine.dataset.line = `${lineNumber}`;
		contentLine.dataset.lineType = "context";
		contentLine.dataset.lineIndex = lineIndex;
		this.currentRowCount += 1;
		this.updateRowSpan();
		this.currentLineElement = contentLine;
		return {
			gutterLine,
			contentLine
		};
	}
	getOrCreateFileContainer(fileContainer) {
		if (fileContainer != null && fileContainer === this.fileContainer || fileContainer == null && this.fileContainer != null) return this.fileContainer;
		if (this.fileContainer != null && fileContainer != null && fileContainer !== this.fileContainer) {
			this.themeCSSStyle = void 0;
			this.appliedThemeCSS = void 0;
		}
		this.fileContainer = fileContainer ?? document.createElement("diffs-container");
		return this.fileContainer;
	}
	applyThemeState(container, themeStyles, themeType, baseThemeType) {
		const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: "open" });
		const effectiveThemeType = baseThemeType ?? themeType;
		const currentTheme = this.options.theme ?? DEFAULT_THEMES;
		const theme = typeof currentTheme === "string" ? currentTheme : { ...currentTheme };
		const scrollbarGutter = getMeasuredScrollbarGutter(shadowRoot);
		if (this.themeCSSStyle?.parentNode === shadowRoot && this.appliedThemeCSS?.themeStyles === themeStyles && this.appliedThemeCSS.themeType === effectiveThemeType && this.appliedThemeCSS.scrollbarGutter === scrollbarGutter) {
			this.appliedThemeCSS.theme = theme;
			return;
		}
		this.themeCSSStyle = upsertHostThemeStyle({
			shadowRoot,
			currentNode: this.themeCSSStyle,
			themeCSS: wrapThemeCSS(themeStyles, effectiveThemeType, scrollbarGutter)
		});
		this.appliedThemeCSS = this.themeCSSStyle != null ? {
			theme,
			themeStyles,
			themeType: effectiveThemeType,
			baseThemeType,
			scrollbarGutter
		} : void 0;
	}
};
//#endregion
export { FileStream };

//# sourceMappingURL=FileStream.js.map