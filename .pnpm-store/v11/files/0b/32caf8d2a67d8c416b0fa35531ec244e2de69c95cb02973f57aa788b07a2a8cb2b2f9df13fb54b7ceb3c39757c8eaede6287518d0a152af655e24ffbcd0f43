"use client";
import { createContext, memo, use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Markdown/streamProfiler/StreamdownProfilerProvider.tsx
const StreamdownProfilerContext = createContext(null);
const StreamdownProfilerProvider = memo(({ children, profiler = null }) => {
	return /* @__PURE__ */ jsx(StreamdownProfilerContext, {
		value: profiler,
		children
	});
});
StreamdownProfilerProvider.displayName = "StreamdownProfilerProvider";
const useStreamdownProfiler = () => {
	return use(StreamdownProfilerContext);
};
//#endregion
export { StreamdownProfilerProvider, useStreamdownProfiler };

//# sourceMappingURL=StreamdownProfilerProvider.mjs.map