import { createContext, useContext } from "react";
import type { ProjectActions } from "../controller";

export const ActionsContext = createContext<ProjectActions | null>(null);

export function useActions(): ProjectActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Project actions are missing.");
  return actions;
}
