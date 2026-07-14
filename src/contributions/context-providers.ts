import { registerContextProvider } from "@openleaf/registry";

// Editor is the default context: active whenever a project is open. Diagram
// and library providers (higher priority when their view is showing) arrive in
// later milestones.
export function registerContextProviders() {
  registerContextProvider({
    id: "editor",
    isActive: (ctx) => !!ctx.projectId,
    order: 100,
  });
}
