import { codes, types } from "micromark-util-symbol";
import { ok } from "devlop";
import { TwoPreviousCode, classifyCharacter, classifyPrecedingCharacter, isCjk, isCjkOrIvs, isCodeHighSurrogate, isCodeLowSurrogate, isNonCjkPunctuation, isSpaceOrPunctuation, isUnicodeWhitespace, tryGetGenuineNextCode, tryGetGenuinePreviousCode } from "micromark-extension-cjk-friendly-util";
import { push, splice } from "micromark-util-chunked";
import { resolveAll } from "micromark-util-resolve-all";

//#region src/ext/attention.ts
const attention = {
	name: "attention",
	resolveAll: resolveAllAttention,
	tokenize: tokenizeAttention
};
function resolveAllAttention(events, context) {
	let index = -1;
	let open;
	let group;
	let text;
	let openingSequence;
	let closingSequence;
	let use;
	let nextEvents;
	let offset;
	while (++index < events.length) if (events[index][0] === "enter" && events[index][1].type === "attentionSequence" && events[index][1]._close) {
		open = index;
		while (open--) if (events[open][0] === "exit" && events[open][1].type === "attentionSequence" && events[open][1]._open && context.sliceSerialize(events[open][1]).charCodeAt(0) === context.sliceSerialize(events[index][1]).charCodeAt(0)) {
			if ((events[open][1]._close || events[index][1]._open) && (events[index][1].end.offset - events[index][1].start.offset) % 3 && !((events[open][1].end.offset - events[open][1].start.offset + events[index][1].end.offset - events[index][1].start.offset) % 3)) continue;
			use = events[open][1].end.offset - events[open][1].start.offset > 1 && events[index][1].end.offset - events[index][1].start.offset > 1 ? 2 : 1;
			const start = { ...events[open][1].end };
			const end = { ...events[index][1].start };
			movePoint(start, -use);
			movePoint(end, use);
			openingSequence = {
				type: use > 1 ? types.strongSequence : types.emphasisSequence,
				start,
				end: { ...events[open][1].end }
			};
			closingSequence = {
				type: use > 1 ? types.strongSequence : types.emphasisSequence,
				start: { ...events[index][1].start },
				end
			};
			text = {
				type: use > 1 ? types.strongText : types.emphasisText,
				start: { ...events[open][1].end },
				end: { ...events[index][1].start }
			};
			group = {
				type: use > 1 ? types.strong : types.emphasis,
				start: { ...openingSequence.start },
				end: { ...closingSequence.end }
			};
			events[open][1].end = { ...openingSequence.start };
			events[index][1].start = { ...closingSequence.end };
			nextEvents = [];
			if (events[open][1].end.offset - events[open][1].start.offset) nextEvents = push(nextEvents, [[
				"enter",
				events[open][1],
				context
			], [
				"exit",
				events[open][1],
				context
			]]);
			nextEvents = push(nextEvents, [
				[
					"enter",
					group,
					context
				],
				[
					"enter",
					openingSequence,
					context
				],
				[
					"exit",
					openingSequence,
					context
				],
				[
					"enter",
					text,
					context
				]
			]);
			ok(context.parser.constructs.insideSpan.null, "expected `insideSpan` to be populated");
			nextEvents = push(nextEvents, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + 1, index), context));
			nextEvents = push(nextEvents, [
				[
					"exit",
					text,
					context
				],
				[
					"enter",
					closingSequence,
					context
				],
				[
					"exit",
					closingSequence,
					context
				],
				[
					"exit",
					group,
					context
				]
			]);
			if (events[index][1].end.offset - events[index][1].start.offset) {
				offset = 2;
				nextEvents = push(nextEvents, [[
					"enter",
					events[index][1],
					context
				], [
					"exit",
					events[index][1],
					context
				]]);
			} else offset = 0;
			splice(events, open - 1, index - open + 3, nextEvents);
			index = open + nextEvents.length - offset - 2;
			break;
		}
	}
	index = -1;
	while (++index < events.length) if (events[index][1].type === "attentionSequence") events[index][1].type = "data";
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeAttention(effects, ok$1) {
	const attentionMarkers = this.parser.constructs.attentionMarkers.null;
	const { now, sliceSerialize, previous: tentativePrevious } = this;
	const previous = isCodeLowSurrogate(tentativePrevious) ? tryGetGenuinePreviousCode(tentativePrevious, now(), sliceSerialize) : tentativePrevious;
	const before = classifyCharacter(previous);
	const twoPrevious = new TwoPreviousCode(previous, now(), sliceSerialize);
	const beforePrimary = classifyPrecedingCharacter(before, twoPrevious.value.bind(twoPrevious), previous);
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Before a sequence.
	*
	* ```markdown
	* > | **
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		ok(code === codes.asterisk || code === codes.underscore, "expected asterisk or underscore");
		marker = code;
		effects.enter("attentionSequence");
		return inside(code);
	}
	/**
	* In a sequence.
	*
	* ```markdown
	* > | **
	*     ^^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === marker) {
			effects.consume(code);
			return inside;
		}
		const token = effects.exit("attentionSequence");
		const after = classifyCharacter(isCodeHighSurrogate(code) ? tryGetGenuineNextCode(code, now(), sliceSerialize) : code);
		ok(attentionMarkers, "expected `attentionMarkers` to be populated");
		const beforeNonCjkPunctuation = isNonCjkPunctuation(beforePrimary);
		const beforeSpaceOrNonCjkPunctuation = beforeNonCjkPunctuation || isUnicodeWhitespace(beforePrimary);
		const afterNonCjkPunctuation = isNonCjkPunctuation(after);
		const afterSpaceOrNonCjkPunctuation = afterNonCjkPunctuation || isUnicodeWhitespace(after);
		const beforeCjkOrIvs = isCjkOrIvs(beforePrimary);
		const open = !afterSpaceOrNonCjkPunctuation || afterNonCjkPunctuation && (beforeSpaceOrNonCjkPunctuation || beforeCjkOrIvs) || attentionMarkers.includes(code);
		const close = !beforeSpaceOrNonCjkPunctuation || beforeNonCjkPunctuation && (afterSpaceOrNonCjkPunctuation || isCjk(after)) || attentionMarkers.includes(previous);
		token._open = Boolean(marker === codes.asterisk ? open : open && (isSpaceOrPunctuation(beforePrimary) || !close));
		token._close = Boolean(marker === codes.asterisk ? close : close && (isSpaceOrPunctuation(after) || !open));
		return ok$1(code);
	}
}
/**
* Move a point a bit.
*
* Note: `move` only works inside lines! It’s not possible to move past other
* chunks (replacement characters, tabs, or line endings).
*
* @param {Point} point
*   Point.
* @param {number} offset
*   Amount to move.
* @returns {undefined}
*   Nothing.
*/
function movePoint(point, offset) {
	point.column += offset;
	point.offset += offset;
	point._bufferIndex += offset;
}

//#endregion
export { attention };