import { classifyCharacter, classifyPrecedingCharacter, isCjk, isCjkOrIvs, isNonCjkPunctuation, isNonEmojiGeneralUseVS, isSpaceOrPunctuation, isUnicodeWhitespace } from "micromark-extension-cjk-friendly-util";
import { codes } from "micromark-util-symbol";

//#region src/index.ts
const encodedOutsideBoundary = ";".codePointAt(0) ?? codes.eof;
const encodedInsideBoundary = "&".codePointAt(0) ?? codes.eof;
/**
* Add CJK-friendly `toMarkdown` handlers for emphasis and strong.
*/
function cjkFriendlyToMarkdown() {
	return { handlers: {
		emphasis,
		strong,
		text
	} };
}
emphasis.peek = emphasisPeek;
strong.peek = strongPeek;
function emphasis(node, parent, state, info) {
	return serializeAttention(node, parent, state, info, emphasisPeek(node, parent, state), 1);
}
function strong(node, parent, state, info) {
	return serializeAttention(node, parent, state, info, strongPeek(node, parent, state), 2);
}
function emphasisPeek(_, _parent, state) {
	return state.options.emphasis || "*";
}
function strongPeek(_, _parent, state) {
	return state.options.strong || "*";
}
function serializeAttention(node, parent, state, info, marker, size) {
	const sequence = marker.repeat(size);
	const exit = state.enter(size === 1 ? "emphasis" : "strong");
	const tracker = state.createTracker(info);
	const before = tracker.move(sequence);
	let between = tracker.move(state.containerPhrasing(node, {
		after: marker,
		before,
		...tracker.current()
	}));
	const beforeBoundary = resolveBeforeBoundary(node, parent, state, info.before);
	const afterBoundary = resolveAfterBoundary(node, parent, state, info.after);
	const open = encodeInfoCjk(beforeBoundary, firstCodePoint(between), marker, "open");
	if (open.inside && between) between = encodeFirstCodePoint(between);
	const close = encodeInfoCjk({
		current: lastCodePoint(between),
		previous: codePointBeforeLast(between)
	}, afterBoundary, marker, "close");
	if (close.inside && between) between = encodeLastCodePoint(between);
	const after = tracker.move(sequence);
	exit();
	const encodeAfterSupplementary = close.outside && shouldEncodeAfterSupplementaryText(parent, state);
	state.attentionEncodeSurroundingInfo = {
		after: close.outside && !encodeAfterSupplementary,
		before: open.outside
	};
	getCjkFriendlyState(state).cjkFriendlyEncodeAfterSupplementaryText = encodeAfterSupplementary;
	return before + between + after;
}
function text(node, _parent, state, info) {
	const cjkFriendlyState = getCjkFriendlyState(state);
	if (!cjkFriendlyState.cjkFriendlyEncodeAfterSupplementaryText) return state.safe(node.value, info);
	cjkFriendlyState.cjkFriendlyEncodeAfterSupplementaryText = false;
	const [first = ""] = [...node.value];
	const rest = node.value.slice(first.length);
	return `${encodeCharacterReference(first.codePointAt(0) ?? codes.eof)}${state.safe(rest, {
		...info,
		before: ";"
	})}`;
}
function encodeInfoCjk(before, after, marker, target) {
	const beforeKind = classifyBoundaryBefore(before);
	const afterKind = classifyCharacter(after);
	if (!isCjkOrIvs(beforeKind) && !isCjkOrIvs(afterKind)) return target === "open" ? encodeInfoFallback(beforeKind, afterKind, marker) : encodeInfoFallback(afterKind, beforeKind, marker);
	const raw = {
		inside: false,
		outside: false
	};
	const preserveOutside = {
		inside: true,
		outside: false
	};
	const preserveInside = {
		inside: false,
		outside: true
	};
	const encodeBoth = {
		inside: true,
		outside: true
	};
	for (const candidate of [
		raw,
		preserveOutside,
		preserveInside,
		encodeBoth
	]) {
		const candidateBefore = target === "open" ? candidate.outside ? encodedBoundaryBeforeContext : before : candidate.inside ? encodedBoundaryBeforeContext : before;
		const candidateAfter = target === "open" ? candidate.inside ? encodedBoundaryAfter : after : candidate.outside ? encodedBoundaryAfter : after;
		if (target === "open" ? canOpen(marker, candidateBefore, candidateAfter) : canClose(marker, candidateBefore, candidateAfter)) return candidate;
	}
	return encodeBoth;
}
function encodeInfoFallback(outsideKind, insideKind, marker) {
	if (isLetterLike(outsideKind)) return isLetterLike(insideKind) ? marker === "_" ? {
		inside: true,
		outside: true
	} : {
		inside: false,
		outside: false
	} : isUnicodeWhitespace(insideKind) ? {
		inside: true,
		outside: true
	} : {
		inside: false,
		outside: true
	};
	if (isUnicodeWhitespace(outsideKind)) return isLetterLike(insideKind) ? {
		inside: false,
		outside: false
	} : isUnicodeWhitespace(insideKind) ? {
		inside: true,
		outside: true
	} : {
		inside: false,
		outside: false
	};
	return isUnicodeWhitespace(insideKind) ? {
		inside: true,
		outside: false
	} : {
		inside: false,
		outside: false
	};
}
function canOpen(marker, before, afterCode) {
	const beforeKind = classifyBoundaryBefore(before);
	const { close, open } = getAttentionSides(beforeKind, classifyCharacter(afterCode));
	return marker === "_" ? open && (isSpaceOrPunctuation(beforeKind) || !close) : open;
}
function canClose(marker, before, afterCode) {
	const afterKind = classifyCharacter(afterCode);
	const { close, open } = getAttentionSides(classifyBoundaryBefore(before), afterKind);
	return marker === "_" ? close && (isSpaceOrPunctuation(afterKind) || !open) : close;
}
function getAttentionSides(beforeKind, afterKind) {
	const beforeNonCjkPunctuation = isNonCjkPunctuation(beforeKind);
	const beforeSpaceOrNonCjkPunctuation = beforeNonCjkPunctuation || isUnicodeWhitespace(beforeKind);
	const afterNonCjkPunctuation = isNonCjkPunctuation(afterKind);
	const afterSpaceOrNonCjkPunctuation = afterNonCjkPunctuation || isUnicodeWhitespace(afterKind);
	return {
		open: !afterSpaceOrNonCjkPunctuation || afterNonCjkPunctuation && (beforeSpaceOrNonCjkPunctuation || isCjkOrIvs(beforeKind)),
		close: !beforeSpaceOrNonCjkPunctuation || beforeNonCjkPunctuation && (afterSpaceOrNonCjkPunctuation || isCjk(afterKind))
	};
}
function isLetterLike(kind) {
	return !isUnicodeWhitespace(kind) && !isNonCjkPunctuation(kind);
}
function classifyBoundaryBefore(before) {
	const kind = classifyCharacter(before.current);
	return before.current === null || !isNonEmojiGeneralUseVS(kind) ? kind : classifyPrecedingCharacter(kind, () => before.previous, before.current);
}
function resolveBeforeBoundary(node, parent, state, fallback) {
	let current = lastCodePoint(fallback);
	let previous = codePointBeforeLast(fallback);
	if (needsPreviousBoundaryRecovery(current) || needsPreviousContext(current, previous)) {
		const siblingText = getAdjacentSiblingText(node, parent, state, -1);
		if (siblingText) {
			current = lastCodePoint(siblingText);
			previous = codePointBeforeLast(siblingText);
		}
	}
	return {
		current,
		previous
	};
}
function resolveAfterBoundary(node, parent, state, fallback) {
	const current = firstCodePoint(fallback);
	if (!needsNextBoundaryRecovery(current)) return current;
	const siblingText = getAdjacentSiblingText(node, parent, state, 1);
	return siblingText ? firstCodePoint(siblingText) : current;
}
function needsPreviousBoundaryRecovery(codePoint) {
	return codePoint !== null && 56320 <= codePoint && codePoint <= 57343;
}
function needsNextBoundaryRecovery(codePoint) {
	return codePoint !== null && 55296 <= codePoint && codePoint <= 56319;
}
function needsPreviousContext(current, previous) {
	return isNonEmojiGeneralUseVS(classifyCharacter(current)) && (previous === null || previous === codes.eof);
}
function getAdjacentSiblingText(node, parent, state, offset) {
	if (!parent) return;
	const stackIndex = state.indexStack.at(-1);
	const siblings = parent.children;
	const index = typeof stackIndex === "number" ? stackIndex : siblings.indexOf(node);
	if (index < 0) return;
	const sibling = siblings[index + offset];
	return getNodeTextContent(sibling) || void 0;
}
function shouldEncodeAfterSupplementaryText(parent, state) {
	if (!parent) return false;
	const stackIndex = state.indexStack.at(-1);
	if (typeof stackIndex !== "number") return false;
	const sibling = parent.children[stackIndex + 1];
	return sibling?.type === "text" && (firstCodePoint(sibling.value) ?? 0) > 65535;
}
function getCjkFriendlyState(state) {
	return state;
}
function getNodeTextContent(node) {
	if (!node || typeof node !== "object") return "";
	if ("value" in node && typeof node.value === "string") return node.value;
	if ("alt" in node && typeof node.alt === "string") return node.alt;
	if ("children" in node && Array.isArray(node.children)) return node.children.map(getNodeTextContent).join("");
	return "";
}
function encodeCharacterReference(codePoint) {
	return `&#x${(codePoint ?? 0).toString(16).toUpperCase()};`;
}
function encodeFirstCodePoint(value) {
	const [first = ""] = [...value];
	return encodeCharacterReference(first.codePointAt(0) ?? codes.eof) + value.slice(first.length);
}
function encodeLastCodePoint(value) {
	const characters = [...value];
	const last = characters.pop();
	return `${characters.join("")}${encodeCharacterReference(last?.codePointAt(0) ?? codes.eof)}`;
}
function codePointBeforeLast(value) {
	const characters = [...value];
	characters.pop();
	return characters.at(-1)?.codePointAt(0) ?? codes.eof;
}
function firstCodePoint(value) {
	return value.codePointAt(0) ?? codes.eof;
}
function lastCodePoint(value) {
	return [...value].at(-1)?.codePointAt(0) ?? codes.eof;
}
const encodedBoundaryBeforeContext = {
	current: encodedOutsideBoundary,
	previous: codes.eof
};
const encodedBoundaryAfter = encodedInsideBoundary;

//#endregion
export { cjkFriendlyToMarkdown };