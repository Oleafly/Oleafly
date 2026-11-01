import { registerContextProvider } from "@oleafly/registry";

export function registerContextProviders() {
  registerContextProvider({
    id: "editor",
    isActive: (ctx) => !!ctx.projectId,
    order: 100,
  });
}
