"use client";
import Grid from "../../Grid/Grid.mjs";
import { CHILDREN_CLASSNAME, styles } from "./style.mjs";
import SpotlightCardItem from "./SpotlightCardItem.mjs";
import { memo, useEffect, useMemo, useRef } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/awesome/SpotlightCard/SpotlightCard.tsx
const SpotlightCard = memo(({ items, renderItem: Content, maxItemWidth, className, columns = 3, gap = "1em", style, size = 800, borderRadius = 12, spotlight = true, ...rest }) => {
	const cssVariables = useMemo(() => ({
		"--spotlight-card-border-radius": `${borderRadius}px`,
		"--spotlight-card-size": `${size}px`
	}), [borderRadius, size]);
	const ref = useRef(null);
	useEffect(() => {
		if (!ref.current) return;
		if (!spotlight) return;
		const fn = (e) => {
			for (const card of document.querySelectorAll(`.${CHILDREN_CLASSNAME}`)) {
				const rect = card.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
				card.style.setProperty("--mouse-x", `${x}px`);
				card.style.setProperty("--mouse-y", `${y}px`);
			}
		};
		ref.current.addEventListener("mousemove", fn);
		return () => {
			ref.current?.removeEventListener("mousemove", fn);
		};
	}, []);
	return /* @__PURE__ */ jsx(Grid, {
		className: cx(styles.container, styles.grid, className),
		gap,
		maxItemWidth,
		ref,
		rows: columns,
		style: {
			...cssVariables,
			...style
		},
		...rest,
		children: items.map((item, index) => {
			return /* @__PURE__ */ jsx(SpotlightCardItem, {
				borderRadius,
				className: CHILDREN_CLASSNAME,
				size,
				children: /* @__PURE__ */ jsx(Content, { ...item })
			}, index);
		})
	});
});
SpotlightCard.displayName = "SpotlightCard";
//#endregion
export { SpotlightCard as default };

//# sourceMappingURL=SpotlightCard.mjs.map