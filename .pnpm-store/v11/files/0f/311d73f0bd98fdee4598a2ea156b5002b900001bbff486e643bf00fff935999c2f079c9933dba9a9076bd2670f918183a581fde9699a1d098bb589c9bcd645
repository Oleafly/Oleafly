// src/index.ts
import { useMemo, version } from "react";

// src/mergeRefsReact16.ts
function mergeRefsReact16(refs) {
  return (value) => {
    for (const ref of refs) assignRef(ref, value);
  };
}

// src/mergeRefsReact19.ts
function mergeRefsReact19(refs) {
  return (value) => {
    const cleanups = [];
    for (const ref of refs) {
      const cleanup = assignRef(ref, value);
      const isCleanup = typeof cleanup === "function";
      cleanups.push(isCleanup ? cleanup : () => assignRef(ref, null));
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };
}

// src/index.ts
function assignRef(ref, value) {
  if (typeof ref === "function") {
    return ref(value);
  } else if (ref) {
    ref.current = value;
  }
}
var mergeRefs = parseInt(version.split(".")[0], 10) >= 19 ? mergeRefsReact19 : mergeRefsReact16;
function useMergeRefs(refs) {
  return useMemo(() => mergeRefs(refs), refs);
}
export {
  assignRef,
  mergeRefs,
  useMergeRefs
};
