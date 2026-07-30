"use client";
import { useMotionComponent } from "../../MotionProvider/index.mjs";
import { rootVariants, styles, thumbVariants } from "./style.mjs";
import { createContext, use, useMemo, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { useReducedMotion } from "motion/react";
import useMergeState from "use-merge-value";
import { Switch } from "@base-ui/react/switch";
//#region src/base-ui/Switch/atoms.tsx
const SwitchContext = createContext(null);
const useSwitchContext = () => {
	const context = use(SwitchContext);
	if (!context) throw new Error("useSwitchContext must be used within a SwitchRoot");
	return context;
};
const SwitchRoot = ({ checked, className, defaultChecked, onCheckedChange, onClick, size = "default", children, disabled, readOnly, required, inputRef, id, name, ...rest }) => {
	const Motion = useMotionComponent();
	const [isPressed, setIsPressed] = useState(false);
	const lastEventRef = useRef(null);
	const [isChecked, setIsChecked] = useMergeState(defaultChecked ?? false, {
		defaultValue: defaultChecked,
		onChange: (value) => {
			if (lastEventRef.current) onCheckedChange?.(value, lastEventRef.current);
		},
		value: checked
	});
	const baseClassName = rootVariants({ size });
	const contextValue = useMemo(() => ({
		isChecked: Boolean(isChecked),
		isPressed,
		setIsChecked: (value) => setIsChecked(value),
		setIsPressed
	}), [
		isChecked,
		isPressed,
		setIsChecked
	]);
	const handleClick = (event) => {
		lastEventRef.current = event;
		onClick?.(!isChecked, event);
	};
	const handleKeyDown = (event) => {
		if (event.key === "Enter" || event.key === " ") lastEventRef.current = event;
		rest.onKeyDown?.(event);
	};
	return /* @__PURE__ */ jsx(SwitchContext, {
		value: contextValue,
		children: /* @__PURE__ */ jsx(Switch.Root, {
			nativeButton: true,
			checked: isChecked,
			defaultChecked,
			disabled,
			id,
			inputRef,
			name,
			readOnly,
			required,
			render: /* @__PURE__ */ jsx(Motion.button, {
				...rest,
				className: cx(baseClassName, className),
				initial: false,
				whileTap: "tap",
				onClick: handleClick,
				onKeyDown: handleKeyDown,
				onTap: () => setIsPressed(false),
				onTapCancel: () => setIsPressed(false),
				onTapStart: () => setIsPressed(true)
			}),
			onCheckedChange: setIsChecked,
			children
		})
	});
};
SwitchRoot.displayName = "SwitchRoot";
const SwitchThumb = ({ className, pressedAnimation, size = "default", transition = {
	damping: 24,
	stiffness: 360,
	type: "spring"
}, children, ...rest }) => {
	const Motion = useMotionComponent();
	const { isPressed } = useSwitchContext();
	const shouldReduceMotion = useReducedMotion();
	const baseClassName = thumbVariants({ size });
	const effectiveAnimate = !shouldReduceMotion && isPressed ? pressedAnimation || { width: size === "small" ? 16 : 22 } : void 0;
	const effectiveTransition = shouldReduceMotion ? { duration: 0 } : transition;
	return /* @__PURE__ */ jsx(Switch.Thumb, { render: /* @__PURE__ */ jsx(Motion.span, {
		layout: true,
		animate: effectiveAnimate,
		className: cx(baseClassName, className),
		transition: effectiveTransition,
		...rest,
		children
	}) });
};
SwitchThumb.displayName = "SwitchThumb";
const getIconPositionClass = (position, size) => {
	if (position === "thumb") return styles.iconThumb;
	if (position === "left") return size === "small" ? styles.iconLeftSmall : styles.iconLeft;
	return size === "small" ? styles.iconRightSmall : styles.iconRight;
};
const SwitchIcon = ({ children, className, position, size = "default", transition = {
	bounce: 0,
	type: "spring"
}, ...rest }) => {
	const Motion = useMotionComponent();
	const { isChecked } = useSwitchContext();
	const shouldReduceMotion = useReducedMotion();
	const isAnimated = useMemo(() => {
		if (position === "right") return !isChecked;
		if (position === "left") return isChecked;
		if (position === "thumb") return true;
		return false;
	}, [position, isChecked]);
	const positionClass = getIconPositionClass(position, size);
	const effectiveTransition = shouldReduceMotion ? { duration: 0 } : transition;
	return /* @__PURE__ */ jsx(Motion.span, {
		animate: isAnimated ? {
			opacity: 1,
			scale: 1
		} : {
			opacity: 0,
			scale: 0
		},
		className: cx(styles.icon, positionClass, className),
		transition: effectiveTransition,
		...rest,
		children
	});
};
SwitchIcon.displayName = "SwitchIcon";
//#endregion
export { SwitchIcon, SwitchRoot, SwitchThumb, styles as switchStyles, useSwitchContext };

//# sourceMappingURL=atoms.mjs.map