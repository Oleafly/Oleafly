"use client";
import { MotionComponent } from "../MotionProvider/index.mjs";
import { genCdnUrl } from "../utils/genCdnUrl.mjs";
import { createContext, memo, use, useEffect, useMemo, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/ConfigProvider/index.tsx
const ConfigContext = createContext(null);
const I18nContextInternal = createContext({
	locale: "en",
	t: (key) => key
});
const isThenable = (value) => typeof value?.then === "function";
const ConfigProvider = memo(({ children, config, locale, resources, motion }) => {
	const fallbackLocale = locale ?? "en";
	const [resolvedResources, setResolvedResources] = useState(() => resources && !isThenable(resources) ? resources : void 0);
	const [resolvedLocale, setResolvedLocale] = useState(fallbackLocale);
	const latestRequestId = useRef(0);
	useEffect(() => {
		const requestId = ++latestRequestId.current;
		if (!resources) {
			setResolvedResources(void 0);
			setResolvedLocale(fallbackLocale);
			return;
		}
		if (isThenable(resources)) {
			const targetLocale = fallbackLocale;
			resources.then((nextResources) => {
				if (latestRequestId.current !== requestId) return;
				setResolvedResources(nextResources);
				setResolvedLocale(targetLocale);
			}).catch(() => {
				if (latestRequestId.current !== requestId) return;
			});
			return;
		}
		setResolvedResources(resources);
		setResolvedLocale(fallbackLocale);
	}, [fallbackLocale, resources]);
	const currentResources = isThenable(resources) ? resolvedResources : resources;
	const currentLocale = isThenable(resources) ? resolvedLocale : fallbackLocale;
	const i18nValue = useMemo(() => {
		const resourceList = Array.isArray(currentResources) ? currentResources : currentResources ? Object.values(currentResources) : [];
		const mergedResources = Object.assign({}, ...resourceList);
		const t = (key) => mergedResources[key] || key;
		return {
			locale: currentLocale,
			t
		};
	}, [currentLocale, currentResources]);
	return /* @__PURE__ */ jsx(I18nContextInternal, {
		value: i18nValue,
		children: /* @__PURE__ */ jsx(ConfigContext, {
			value: config ?? null,
			children: /* @__PURE__ */ jsx(MotionComponent, {
				value: motion,
				children
			})
		})
	});
});
const cdnFallback = ({ pkg, version, path }) => genCdnUrl({
	path,
	pkg,
	proxy: "aliyun",
	version
});
const useCdnFn = () => {
	const config = use(ConfigContext);
	if (!config) return cdnFallback;
	if (config?.proxy !== "custom") return ({ pkg, version, path }) => genCdnUrl({
		path,
		pkg,
		proxy: config.proxy,
		version
	});
	return config?.customCdnFn || cdnFallback;
};
const useI18n = () => use(I18nContextInternal);
//#endregion
export { ConfigContext, I18nContextInternal as I18nContext, ConfigProvider as default, useCdnFn, useI18n };

//# sourceMappingURL=index.mjs.map