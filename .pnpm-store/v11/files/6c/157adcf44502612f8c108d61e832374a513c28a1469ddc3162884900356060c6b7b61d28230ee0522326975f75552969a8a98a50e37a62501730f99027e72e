"use client";
import { Suspense, useLayoutEffect, useRef } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/Freeze/Freeze.tsx
const infinitePromise = new Promise(() => {});
const Suspend = () => {
	throw infinitePromise;
};
const snapshotDisplays = (root) => {
	const snapshot = /* @__PURE__ */ new Map([[root, root.style.display]]);
	for (const element of root.querySelectorAll("*")) snapshot.set(element, element.style.display);
	return snapshot;
};
const restoreDisplayIfSuspenseHidden = (element, originalDisplay) => {
	if (element.style.display !== "none") return;
	if (originalDisplay === "none") return;
	element.style.display = originalDisplay;
};
const restoreSuspenseHiddenDisplay = (snapshot) => {
	for (const [element, originalDisplay] of snapshot) restoreDisplayIfSuspenseHidden(element, originalDisplay);
};
const Freeze = ({ frozen, children }) => {
	const contentRef = useRef(null);
	const hasSnapshotRef = useRef(false);
	const displaySnapshotRef = useRef(/* @__PURE__ */ new Map());
	const shouldSuspend = frozen && hasSnapshotRef.current;
	useLayoutEffect(() => {
		const content = contentRef.current;
		if (!content) return;
		if (!frozen) {
			displaySnapshotRef.current = snapshotDisplays(content);
			hasSnapshotRef.current = true;
			return;
		}
		if (!hasSnapshotRef.current) {
			displaySnapshotRef.current = snapshotDisplays(content);
			hasSnapshotRef.current = true;
			return;
		}
		restoreSuspenseHiddenDisplay(displaySnapshotRef.current);
	});
	useLayoutEffect(() => {
		if (!shouldSuspend) return;
		const snapshot = displaySnapshotRef.current;
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				const element = mutation.target;
				const originalDisplay = snapshot.get(element);
				if (originalDisplay === void 0) continue;
				restoreDisplayIfSuspenseHidden(element, originalDisplay);
			}
		});
		for (const element of snapshot.keys()) observer.observe(element, {
			attributeFilter: ["style"],
			attributes: true
		});
		restoreSuspenseHiddenDisplay(snapshot);
		return () => observer.disconnect();
	}, [shouldSuspend]);
	return /* @__PURE__ */ jsxs(Suspense, {
		fallback: null,
		children: [shouldSuspend && /* @__PURE__ */ jsx(Suspend, {}), /* @__PURE__ */ jsx("div", {
			ref: contentRef,
			style: { display: "contents" },
			children
		})]
	});
};
Freeze.displayName = "Freeze";
//#endregion
export { Freeze as default };

//# sourceMappingURL=Freeze.mjs.map