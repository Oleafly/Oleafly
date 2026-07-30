"use client";
import { createContext, memo, use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Form/components/FormProvider.tsx
const FormContext = createContext({});
const FormProvider = memo(({ children, config }) => {
	return /* @__PURE__ */ jsx(FormContext, {
		value: config,
		children
	});
});
const useFormContext = () => {
	return use(FormContext);
};
//#endregion
export { FormContext, FormProvider, useFormContext };

//# sourceMappingURL=FormProvider.mjs.map