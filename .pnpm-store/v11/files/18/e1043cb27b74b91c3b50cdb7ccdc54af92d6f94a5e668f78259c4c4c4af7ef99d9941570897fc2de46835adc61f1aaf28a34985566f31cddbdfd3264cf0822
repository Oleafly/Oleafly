import { getNow } from "../../utils/getNow.mjs";
import { useStreamdownProfiler } from "../streamProfiler/StreamdownProfilerProvider.mjs";
import { findOpenFenceLanguage } from "./fenceState.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
//#region src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts
const DEFAULT_BYPASS_LANGUAGES = ["html"];
const PRESET_CONFIG = {
	balanced: {
		activeInputWindowMs: 220,
		bypassFencedLanguages: DEFAULT_BYPASS_LANGUAGES,
		defaultCps: 38,
		emaAlpha: .2,
		flushCps: 120,
		largeAppendChars: 120,
		maxActiveCps: 132,
		maxCps: 72,
		maxFlushCps: 280,
		minCommitIntervalMs: 48,
		minCps: 18,
		settleAfterMs: 360,
		settleDrainMaxMs: 520,
		settleDrainMinMs: 180,
		targetBufferMs: 120
	},
	realtime: {
		activeInputWindowMs: 140,
		bypassFencedLanguages: DEFAULT_BYPASS_LANGUAGES,
		defaultCps: 50,
		emaAlpha: .3,
		flushCps: 170,
		largeAppendChars: 180,
		maxActiveCps: 180,
		maxCps: 96,
		maxFlushCps: 360,
		minCommitIntervalMs: 32,
		minCps: 24,
		settleAfterMs: 260,
		settleDrainMaxMs: 360,
		settleDrainMinMs: 140,
		targetBufferMs: 40
	},
	silky: {
		activeInputWindowMs: 320,
		bypassFencedLanguages: DEFAULT_BYPASS_LANGUAGES,
		defaultCps: 28,
		emaAlpha: .14,
		flushCps: 96,
		largeAppendChars: 100,
		maxActiveCps: 102,
		maxCps: 56,
		maxFlushCps: 220,
		minCommitIntervalMs: 56,
		minCps: 14,
		settleAfterMs: 460,
		settleDrainMaxMs: 680,
		settleDrainMinMs: 240,
		targetBufferMs: 170
	}
};
const clamp = (value, min, max) => {
	return Math.min(max, Math.max(min, value));
};
const MAX_COMMIT_INTERVAL_MS = 96;
const COMMIT_INTERVAL_TAIL_SCALE_UNITS = 256;
const findTailUnits = (content) => {
	const boundary = content.lastIndexOf("\n\n");
	return boundary === -1 ? content.length : content.length - boundary - 2;
};
const countChars = (text) => {
	let count = 0;
	for (const _char of text) count += 1;
	return count;
};
const useSmoothStreamContent = (content, { enabled = true, preset = "balanced" } = {}) => {
	const config = PRESET_CONFIG[preset];
	const profiler = useStreamdownProfiler();
	const [displayedContent, setDisplayedContent] = useState(content);
	const displayedContentRef = useRef(content);
	const displayedCountRef = useRef(countChars(content));
	const targetContentRef = useRef(content);
	const targetCharsRef = useRef([...content]);
	const targetCountRef = useRef(targetCharsRef.current.length);
	const emaCpsRef = useRef(config.defaultCps);
	const tailUnitsRef = useRef(findTailUnits(content));
	const lastInputTsRef = useRef(0);
	const lastInputCountRef = useRef(targetCountRef.current);
	const chunkSizeEmaRef = useRef(1);
	const arrivalCpsEmaRef = useRef(config.defaultCps);
	const rafRef = useRef(null);
	const lastFrameTsRef = useRef(null);
	const wakeTimerRef = useRef(null);
	const clearWakeTimer = useCallback(() => {
		if (wakeTimerRef.current !== null) {
			clearTimeout(wakeTimerRef.current);
			wakeTimerRef.current = null;
		}
	}, []);
	const stopFrameLoop = useCallback(() => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		lastFrameTsRef.current = null;
	}, []);
	const stopScheduling = useCallback(() => {
		stopFrameLoop();
		clearWakeTimer();
	}, [clearWakeTimer, stopFrameLoop]);
	const startFrameLoopRef = useRef(() => {});
	const scheduleFrameWake = useCallback((delayMs) => {
		clearWakeTimer();
		wakeTimerRef.current = setTimeout(() => {
			wakeTimerRef.current = null;
			startFrameLoopRef.current();
		}, Math.max(1, Math.ceil(delayMs)));
	}, [clearWakeTimer]);
	const syncImmediate = useCallback((nextContent) => {
		stopScheduling();
		const chars = [...nextContent];
		const now = getNow();
		targetContentRef.current = nextContent;
		targetCharsRef.current = chars;
		targetCountRef.current = chars.length;
		displayedContentRef.current = nextContent;
		displayedCountRef.current = chars.length;
		setDisplayedContent(nextContent);
		emaCpsRef.current = config.defaultCps;
		chunkSizeEmaRef.current = 1;
		arrivalCpsEmaRef.current = config.defaultCps;
		tailUnitsRef.current = findTailUnits(nextContent);
		lastInputTsRef.current = now;
		lastInputCountRef.current = chars.length;
	}, [config.defaultCps, stopScheduling]);
	const startFrameLoop = useCallback(() => {
		clearWakeTimer();
		if (rafRef.current !== null) return;
		const tick = (ts) => {
			const targetCount = targetCountRef.current;
			const displayedCount = displayedCountRef.current;
			const backlog = targetCount - displayedCount;
			if (backlog <= 0) {
				stopFrameLoop();
				return;
			}
			if (lastFrameTsRef.current === null) {
				lastFrameTsRef.current = ts;
				rafRef.current = requestAnimationFrame(tick);
				return;
			}
			const commitIntervalMs = Math.min(MAX_COMMIT_INTERVAL_MS, config.minCommitIntervalMs * (1 + tailUnitsRef.current / COMMIT_INTERVAL_TAIL_SCALE_UNITS));
			const frameIntervalMs = Math.max(0, ts - lastFrameTsRef.current);
			if (frameIntervalMs < commitIntervalMs) {
				rafRef.current = requestAnimationFrame(tick);
				return;
			}
			const frameStart = getNow();
			const dtSeconds = Math.max(.001, Math.min(frameIntervalMs / 1e3, .12));
			lastFrameTsRef.current = ts;
			const idleMs = frameStart - lastInputTsRef.current;
			const inputActive = idleMs <= config.activeInputWindowMs;
			const settling = !inputActive && idleMs >= config.settleAfterMs;
			const baseCps = clamp(emaCpsRef.current, config.minCps, config.maxCps);
			const baseLagChars = Math.max(1, Math.round(baseCps * config.targetBufferMs / 1e3));
			const lagUpperBound = Math.max(baseLagChars + 2, baseLagChars * 3);
			const targetLagChars = inputActive ? Math.round(clamp(baseLagChars + chunkSizeEmaRef.current * .35, baseLagChars, lagUpperBound)) : 0;
			const desiredDisplayed = Math.max(0, targetCount - targetLagChars);
			let currentCps;
			if (inputActive) {
				const backlogPressure = targetLagChars > 0 ? backlog / targetLagChars : 1;
				const chunkPressure = targetLagChars > 0 ? chunkSizeEmaRef.current / targetLagChars : 1;
				const arrivalPressure = arrivalCpsEmaRef.current / Math.max(baseCps, 1);
				const combinedPressure = clamp(backlogPressure * .6 + chunkPressure * .25 + arrivalPressure * .15, 1, 4.5);
				const activeCap = clamp(config.maxActiveCps + chunkSizeEmaRef.current * 6, config.maxActiveCps, config.maxFlushCps);
				currentCps = clamp(baseCps * combinedPressure, config.minCps, activeCap);
			} else if (settling) {
				const drainTargetMs = clamp(backlog * 8, config.settleDrainMinMs, config.settleDrainMaxMs);
				const settleCps = backlog * 1e3 / drainTargetMs;
				currentCps = clamp(settleCps, config.flushCps, config.maxFlushCps);
			} else {
				const idleFlushCps = Math.max(config.flushCps, baseCps * 1.8, arrivalCpsEmaRef.current * .8);
				currentCps = clamp(idleFlushCps, config.flushCps, config.maxFlushCps);
			}
			const urgentBacklog = inputActive && targetLagChars > 0 && backlog > targetLagChars * 2.2;
			const burstyInput = inputActive && chunkSizeEmaRef.current >= targetLagChars * .9;
			let revealChars = Math.max(inputActive ? urgentBacklog || burstyInput ? 2 : 1 : 2, Math.round(currentCps * dtSeconds));
			if (inputActive) {
				const shortfall = desiredDisplayed - displayedCount;
				if (shortfall <= 0) {
					stopFrameLoop();
					scheduleFrameWake(config.activeInputWindowMs - idleMs);
					profiler?.recordAnimationFrame({
						backlog,
						durationMs: getNow() - frameStart,
						frameIntervalMs,
						inputActive,
						revealChars: 0,
						settling
					});
					return;
				}
				revealChars = Math.min(revealChars, shortfall, backlog);
			} else revealChars = Math.min(revealChars, backlog);
			const nextCount = displayedCount + revealChars;
			const segment = targetCharsRef.current.slice(displayedCount, nextCount).join("");
			if (segment) {
				const nextDisplayed = displayedContentRef.current + segment;
				displayedContentRef.current = nextDisplayed;
				displayedCountRef.current = nextCount;
				setDisplayedContent(nextDisplayed);
			} else {
				displayedContentRef.current = targetContentRef.current;
				displayedCountRef.current = targetCount;
				setDisplayedContent(targetContentRef.current);
			}
			profiler?.recordAnimationFrame({
				backlog,
				durationMs: getNow() - frameStart,
				frameIntervalMs,
				inputActive,
				revealChars: segment ? revealChars : backlog,
				settling
			});
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
	}, [
		clearWakeTimer,
		config.activeInputWindowMs,
		config.flushCps,
		config.maxActiveCps,
		config.maxCps,
		config.maxFlushCps,
		config.minCommitIntervalMs,
		config.minCps,
		config.settleAfterMs,
		config.settleDrainMaxMs,
		config.settleDrainMinMs,
		config.targetBufferMs,
		scheduleFrameWake,
		stopFrameLoop
	]);
	startFrameLoopRef.current = startFrameLoop;
	useEffect(() => {
		if (!enabled) {
			syncImmediate(content);
			return;
		}
		const prevTargetContent = targetContentRef.current;
		if (content === prevTargetContent) return;
		const now = getNow();
		if (!content.startsWith(prevTargetContent)) {
			syncImmediate(content);
			return;
		}
		if (config.bypassFencedLanguages.length > 0) {
			const openLang = findOpenFenceLanguage(content);
			if (openLang !== null && config.bypassFencedLanguages.includes(openLang)) {
				syncImmediate(content);
				return;
			}
		}
		const appendedChars = [...content.slice(prevTargetContent.length)];
		const appendedCount = appendedChars.length;
		profiler?.recordInputAppend({
			appendedChars: appendedCount,
			contentLength: countChars(content)
		});
		if (appendedCount > config.largeAppendChars) {
			syncImmediate(content);
			return;
		}
		targetContentRef.current = content;
		targetCharsRef.current.push(...appendedChars);
		targetCountRef.current += appendedCount;
		tailUnitsRef.current = findTailUnits(content);
		const deltaChars = targetCountRef.current - lastInputCountRef.current;
		const deltaMs = Math.max(1, now - lastInputTsRef.current);
		if (deltaChars > 0) {
			const instantCps = deltaChars * 1e3 / deltaMs;
			const normalizedInstantCps = clamp(instantCps, config.minCps, config.maxFlushCps * 2);
			const chunkEmaAlpha = .35;
			chunkSizeEmaRef.current = chunkSizeEmaRef.current * (1 - chunkEmaAlpha) + appendedCount * chunkEmaAlpha;
			arrivalCpsEmaRef.current = arrivalCpsEmaRef.current * (1 - chunkEmaAlpha) + normalizedInstantCps * chunkEmaAlpha;
			const clampedCps = clamp(instantCps, config.minCps, config.maxActiveCps);
			emaCpsRef.current = emaCpsRef.current * (1 - config.emaAlpha) + clampedCps * config.emaAlpha;
		}
		lastInputTsRef.current = now;
		lastInputCountRef.current = targetCountRef.current;
		startFrameLoop();
	}, [
		config.bypassFencedLanguages,
		config.emaAlpha,
		config.largeAppendChars,
		config.maxActiveCps,
		config.maxCps,
		config.maxFlushCps,
		config.minCps,
		content,
		enabled,
		startFrameLoop,
		syncImmediate,
		profiler
	]);
	useEffect(() => {
		return () => {
			stopScheduling();
		};
	}, [stopScheduling]);
	return displayedContent;
};
//#endregion
export { countChars, useSmoothStreamContent };

//# sourceMappingURL=useSmoothStreamContent.mjs.map