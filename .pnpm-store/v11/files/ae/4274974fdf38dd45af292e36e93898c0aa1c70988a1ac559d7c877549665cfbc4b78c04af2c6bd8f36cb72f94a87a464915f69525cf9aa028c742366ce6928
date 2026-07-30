import { useI18n } from "../ConfigProvider/index.mjs";
import { useMemo } from "react";
//#region src/i18n/useTranslation.ts
const useTranslation = (fallbackResources) => {
	const { t, locale } = useI18n();
	return {
		locale,
		t: useMemo(() => {
			if (!fallbackResources) return t;
			return (key) => {
				const value = t(key);
				const fallback = fallbackResources[key];
				return value === key && fallback ? fallback : value;
			};
		}, [t, fallbackResources])
	};
};
//#endregion
export { useTranslation };

//# sourceMappingURL=useTranslation.mjs.map