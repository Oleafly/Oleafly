import type { TypstFormsPort } from "@oleafly/editor/typst-forms";
import { startTypstFormsSync, useTypstFormsStore } from "@/store/typst-forms";

export const typstFormsPort: TypstFormsPort = {
  snapshot: () => useTypstFormsStore.getState().catalog,
  subscribe: (listener) => {
    startTypstFormsSync();
    return useTypstFormsStore.subscribe((state, previous) => {
      if (state.catalog !== previous.catalog) listener();
    });
  },
  want: (packages) => useTypstFormsStore.getState().want(packages),
};
