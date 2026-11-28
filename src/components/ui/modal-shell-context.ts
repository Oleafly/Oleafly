import { createContext, useContext } from "react";

export const InsideModalShell = createContext(false);

export function useInsideModalShell(): boolean {
  return useContext(InsideModalShell);
}
