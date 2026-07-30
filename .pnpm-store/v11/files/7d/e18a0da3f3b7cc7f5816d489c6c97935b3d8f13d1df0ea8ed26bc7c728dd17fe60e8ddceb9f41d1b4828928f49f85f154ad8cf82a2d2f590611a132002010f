"use client";
import { useMotionComponent } from "../../MotionProvider/index.mjs";
import { styles } from "./style.mjs";
import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/awesome/TypewriterEffect/TypewriterEffect.tsx
const TypewriterEffect = memo(({ sentences, as: Component = "div", typingSpeed = 100, initialDelay = 0, pauseDuration = 2e3, deletingSpeed = 50, deletePauseDuration = 0, loop = true, className = "", color, showCursor = true, hideCursorWhileTyping = false, cursorCharacter, cursorClassName = "", cursorColor, cursorBlinkDuration = .8, cursorFade = true, cursorStyle = "pipe", textColors = [], variableSpeed, onSentenceComplete, startOnVisible = false, reverseMode = false, segmentMode = "grapheme", ...props }) => {
	const Motion = useMotionComponent();
	const cxStyles = cx;
	const [displayedText, setDisplayedText] = useState("");
	const [currentCharIndex, setCurrentCharIndex] = useState(0);
	const [isDeleting, setIsDeleting] = useState(false);
	const [currentTextIndex, setCurrentTextIndex] = useState(0);
	const [isVisible, setIsVisible] = useState(!startOnVisible);
	const [isDeletePausing, setIsDeletePausing] = useState(false);
	const containerRef = useRef(null);
	const textArray = useMemo(() => Array.isArray(sentences) ? sentences : [sentences], [sentences]);
	const splitText = useCallback((text) => {
		if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
			const segmenter = new Intl.Segmenter(void 0, { granularity: segmentMode });
			return Array.from(segmenter.segment(text), (segment) => segment.segment);
		}
		if (segmentMode === "word") return text.split(/(\s+)/).filter(Boolean);
		return Array.from(text);
	}, [segmentMode]);
	const getRandomSpeed = useCallback(() => {
		if (!variableSpeed) return typingSpeed;
		const { min, max } = variableSpeed;
		return Math.random() * (max - min) + min;
	}, [variableSpeed, typingSpeed]);
	const getCurrentTextColor = () => {
		if (textColors.length > 0) return textColors[currentTextIndex % textColors.length];
		return color;
	};
	const getCurrentCursorColor = () => {
		return cursorColor || color;
	};
	useEffect(() => {
		if (!startOnVisible || !containerRef.current) return;
		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) setIsVisible(true);
			});
		}, { threshold: .1 });
		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [startOnVisible]);
	useEffect(() => {
		if (!isVisible) return;
		let timeout;
		const currentText = textArray[currentTextIndex];
		const textSegments = splitText(currentText);
		const processedText = reverseMode ? textSegments.reverse().join("") : currentText;
		if (isDeletePausing) {
			timeout = setTimeout(() => {
				setIsDeletePausing(false);
			}, deletePauseDuration);
			return () => clearTimeout(timeout);
		}
		const executeTypingAnimation = () => {
			if (isDeleting) if (displayedText === "") {
				setIsDeleting(false);
				if (currentTextIndex === textArray.length - 1 && !loop) return;
				if (onSentenceComplete) onSentenceComplete(textArray[currentTextIndex], currentTextIndex);
				setCurrentTextIndex((prev) => (prev + 1) % textArray.length);
				setCurrentCharIndex(0);
				if (deletePauseDuration > 0) {
					setIsDeletePausing(true);
					return;
				}
			} else timeout = setTimeout(() => {
				setDisplayedText((prev) => {
					return splitText(prev).slice(0, -1).join("");
				});
			}, deletingSpeed);
			else {
				const processedSegments = splitText(processedText);
				if (currentCharIndex < processedSegments.length) timeout = setTimeout(() => {
					setDisplayedText((prev) => prev + processedSegments[currentCharIndex]);
					setCurrentCharIndex((prev) => prev + 1);
				}, variableSpeed ? getRandomSpeed() : typingSpeed);
				else if (textArray.length >= 1) {
					if (!loop && currentTextIndex === textArray.length - 1) return;
					timeout = setTimeout(() => {
						setIsDeleting(true);
					}, pauseDuration);
				}
			}
		};
		if (currentCharIndex === 0 && !isDeleting && displayedText === "") timeout = setTimeout(executeTypingAnimation, initialDelay);
		else executeTypingAnimation();
		return () => clearTimeout(timeout);
	}, [
		currentCharIndex,
		displayedText,
		isDeleting,
		isDeletePausing,
		typingSpeed,
		deletingSpeed,
		deletePauseDuration,
		pauseDuration,
		textArray,
		currentTextIndex,
		loop,
		initialDelay,
		isVisible,
		reverseMode,
		variableSpeed,
		onSentenceComplete,
		getRandomSpeed,
		splitText
	]);
	const getCursorStyle = () => {
		if (cursorCharacter) return styles.cursorCustom;
		switch (cursorStyle) {
			case "block": return styles.cursorBlock;
			case "dot": return styles.cursorDot;
			case "underscore": return styles.cursorUnderscore;
			case "pipe": return styles.cursor;
		}
	};
	const currentTextLength = splitText(textArray[currentTextIndex]).length;
	const isTyping = currentCharIndex < currentTextLength && !isDeleting;
	const isAfterTyping = currentCharIndex === currentTextLength && !isDeleting;
	const shouldHideCursor = (() => {
		if (hideCursorWhileTyping === true) return true;
		if (hideCursorWhileTyping === "typing") return isTyping || isDeleting;
		if (hideCursorWhileTyping === "afterTyping") return isAfterTyping;
		return false;
	})();
	const textColor = getCurrentTextColor();
	const finalCursorColor = getCurrentCursorColor();
	const characters = splitText(displayedText);
	return createElement(Component, {
		className: cxStyles(styles.container, className),
		ref: containerRef,
		...props
	}, /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx("span", {
		className: styles.text,
		style: textColor ? { color: textColor } : void 0,
		children: characters.map((char, index) => /* @__PURE__ */ jsx(Motion.span, {
			animate: { opacity: 1 },
			initial: { opacity: 0 },
			style: { display: "inline-block" },
			transition: {
				duration: typingSpeed / 500,
				ease: "easeInOut"
			},
			children: char === " " ? "\xA0" : char
		}, `${currentTextIndex}-${index}`))
	}), showCursor && (cursorFade ? /* @__PURE__ */ jsx(Motion.span, {
		animate: { opacity: shouldHideCursor ? 0 : 1 },
		className: cxStyles(getCursorStyle(), cursorClassName),
		initial: { opacity: 0 },
		style: finalCursorColor ? { backgroundColor: finalCursorColor } : void 0,
		transition: {
			duration: shouldHideCursor ? .2 : cursorBlinkDuration,
			ease: "easeInOut",
			repeat: shouldHideCursor ? 0 : Number.POSITIVE_INFINITY,
			repeatType: "reverse"
		},
		children: cursorCharacter
	}) : /* @__PURE__ */ jsx("span", {
		className: cxStyles(getCursorStyle(), cursorClassName),
		style: {
			backgroundColor: finalCursorColor,
			opacity: shouldHideCursor ? 0 : 1
		},
		children: cursorCharacter
	}))] }));
});
TypewriterEffect.displayName = "TypewriterEffect";
//#endregion
export { TypewriterEffect as default };

//# sourceMappingURL=TypewriterEffect.mjs.map