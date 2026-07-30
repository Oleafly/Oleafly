"use client";
import { useIsClient } from "../../hooks/useIsClient.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { registerDevSingleton } from "../../utils/devSingleton.mjs";
import Button from "../Button/Button.mjs";
import { ModalBackdrop, ModalClose, ModalContent, ModalFooter, ModalHeader, ModalPopup, ModalPortal, ModalRoot, ModalTitle } from "./atoms.mjs";
import { ModalContext, useModalContext } from "./context.mjs";
import { memo, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { createPortal } from "react-dom";
//#region src/base-ui/Modal/imperative.tsx
const ModalPortalWrapper = ({ children, root }) => {
	const appElement = useAppElement();
	return createPortal(children, root ?? appElement ?? document.body);
};
const ConfirmBody = ({ config }) => {
	const { close } = useModalContext();
	const [loading, setLoading] = useState(false);
	const { cancelText = "Cancel", content, okButtonProps, okText = "OK", onCancel, onOk } = config;
	const handleCancel = useCallback(() => {
		close();
		onCancel?.();
	}, [close, onCancel]);
	const handleOk = useCallback(async () => {
		if (onOk) try {
			const result = onOk();
			if (result && typeof result.then === "function") {
				setLoading(true);
				await result;
				setLoading(false);
			}
		} catch {
			setLoading(false);
			return;
		}
		close();
	}, [close, onOk]);
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [content && /* @__PURE__ */ jsx("div", {
		style: { padding: "12px 16px" },
		children: content
	}), /* @__PURE__ */ jsxs(ModalFooter, { children: [/* @__PURE__ */ jsx(Button, {
		onClick: handleCancel,
		children: cancelText
	}), /* @__PURE__ */ jsx(Button, {
		loading,
		type: "primary",
		...okButtonProps,
		onClick: handleOk,
		children: okText
	})] })] });
};
ConfirmBody.displayName = "ConfirmBody";
let systemSeed = 0;
function createModalSystem() {
	const systemId = systemSeed++;
	const singletonName = systemId === 0 ? "BaseModalHost" : `BaseModalHost-${systemId}`;
	let modalStack = [];
	let modalSeed = 0;
	const listeners = /* @__PURE__ */ new Set();
	const notify = () => listeners.forEach((l) => l());
	const subscribe = (l) => {
		listeners.add(l);
		return () => listeners.delete(l);
	};
	const EMPTY = [];
	const getSnapshot = () => modalStack;
	const getServerSnapshot = () => EMPTY;
	const updateModal = (id, next) => {
		let changed = false;
		modalStack = modalStack.map((item) => {
			if (item.id !== id) return item;
			changed = true;
			return {
				...item,
				props: {
					...item.props,
					...next
				}
			};
		});
		if (changed) notify();
	};
	const closeModal = (id) => {
		updateModal(id, { open: false });
	};
	const destroyModal = (id) => {
		const next = modalStack.filter((item) => item.id !== id);
		if (next.length === modalStack.length) return;
		modalStack = next;
		notify();
	};
	const StackItem = memo(({ entry }) => {
		const { id, props } = entry;
		const { children, classNames, content, footer, maskClosable, onOpenChange, onOpenChangeComplete, open, styles: semanticStyles, title, width } = props;
		const isOpen = open ?? true;
		const handleOpenChange = useCallback((nextOpen, eventDetails) => {
			if (!nextOpen && maskClosable === false && eventDetails?.reason === "outside-press") return;
			if (!nextOpen) closeModal(id);
			onOpenChange?.(nextOpen);
		}, [
			id,
			maskClosable,
			onOpenChange
		]);
		const handleExitComplete = useCallback(() => {
			onOpenChangeComplete?.(false);
			destroyModal(id);
		}, [id, onOpenChangeComplete]);
		const close = useCallback(() => closeModal(id), [id]);
		const setCanDismissByClickOutside = useCallback((value) => updateModal(id, { maskClosable: value }), [id]);
		const showTitle = title !== void 0 && title !== false && title !== null;
		return /* @__PURE__ */ jsx(ModalContext, {
			value: {
				close,
				setCanDismissByClickOutside
			},
			children: /* @__PURE__ */ jsx(ModalRoot, {
				open: isOpen,
				onExitComplete: handleExitComplete,
				onOpenChange: handleOpenChange,
				children: /* @__PURE__ */ jsxs(ModalPortal, { children: [/* @__PURE__ */ jsx(ModalBackdrop, {
					className: classNames?.backdrop,
					style: semanticStyles?.backdrop
				}), /* @__PURE__ */ jsxs(ModalPopup, {
					className: classNames?.popup,
					popupStyle: semanticStyles?.popup,
					width,
					children: [
						showTitle && /* @__PURE__ */ jsxs(ModalHeader, {
							className: classNames?.header,
							style: semanticStyles?.header,
							children: [/* @__PURE__ */ jsx(ModalTitle, {
								className: classNames?.title,
								style: semanticStyles?.title,
								children: title
							}), /* @__PURE__ */ jsx(ModalClose, {
								className: classNames?.close,
								style: semanticStyles?.close
							})]
						}),
						/* @__PURE__ */ jsx(ModalContent, {
							className: classNames?.content,
							style: semanticStyles?.content,
							children: content ?? children
						}),
						footer
					]
				})] })
			})
		});
	});
	StackItem.displayName = "ModalStackItem";
	const StackRenderer = memo(({ stack }) => {
		if (!useIsClient()) return null;
		return stack.map((entry) => /* @__PURE__ */ jsx(StackItem, { entry }, entry.id));
	});
	StackRenderer.displayName = "ModalStackRenderer";
	const Host = ({ root }) => {
		const stack = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
		const isClient = useIsClient();
		useEffect(() => {
			if (!isClient) return;
			const scope = root ?? document.body;
			return registerDevSingleton(singletonName, scope);
		}, [isClient, root]);
		if (!isClient) return null;
		if (stack.length === 0) return null;
		return /* @__PURE__ */ jsx(ModalPortalWrapper, {
			root,
			children: /* @__PURE__ */ jsx(StackRenderer, { stack })
		});
	};
	const create = (props) => {
		const id = `base-modal-${Date.now()}-${modalSeed++}`;
		modalStack = [...modalStack, {
			id,
			props: {
				...props,
				open: props.open ?? true
			}
		}];
		notify();
		return {
			close: () => closeModal(id),
			destroy: () => destroyModal(id),
			setCanDismissByClickOutside: (value) => updateModal(id, { maskClosable: value }),
			update: (nextProps) => updateModal(id, nextProps)
		};
	};
	const confirm = (config) => {
		const instance = create({
			content: /* @__PURE__ */ jsx(ConfirmBody, { config }),
			styles: { content: { padding: 0 } },
			title: config.title,
			width: 420
		});
		return {
			close: instance.close,
			destroy: instance.destroy
		};
	};
	return {
		ModalHost: Host,
		confirmModal: confirm,
		createModal: create
	};
}
const defaultSystem = createModalSystem();
const ModalHost = defaultSystem.ModalHost;
const createModal = defaultSystem.createModal;
const confirmModal = defaultSystem.confirmModal;
//#endregion
export { ModalHost, confirmModal, createModal, createModalSystem };

//# sourceMappingURL=imperative.mjs.map