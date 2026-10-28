import { useEffect } from "react";
import { startEditMode } from "./edit-mode";
import { startSuggestions } from "./suggestions-store";

export function SuggestionsKeeper() {
  useEffect(() => {
    const stopMode = startEditMode();
    const stopSuggestions = startSuggestions();
    return () => {
      stopSuggestions();
      stopMode();
    };
  }, []);
  return null;
}
