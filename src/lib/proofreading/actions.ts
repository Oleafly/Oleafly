import { setProofreadingActionHost } from "@oleafly/editor";
import {
  ignoreWordForProject,
  ignoreWordGlobally,
  isGrammarFindingSuppressed,
  suppressGrammarFinding,
} from "@/lib/dictionary";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import {
  ignoreWordHere,
  isFindingSuppressedHere,
  isWordIgnoredHere,
  suppressFindingHere,
} from "./ignored";

export function installProofreadingActionHost(): void {
  setProofreadingActionHost({
    addToProjectDictionary: (projectId, word) => {
      const outcome = ignoreWordForProject(projectId, word);
      return outcome === "stored" || outcome === "duplicate";
    },
    addToPersonalDictionary: (word) => {
      const outcome = ignoreWordGlobally(word);
      return outcome === "stored" || outcome === "duplicate";
    },
    ignoreHere: ignoreWordHere,
    isIgnoredHere: isWordIgnoredHere,
    suppressHere: suppressFindingHere,
    isSuppressedHere: isFindingSuppressedHere,
    suppressFinding: suppressGrammarFinding,
    isFindingSuppressed: isGrammarFindingSuppressed,
    disableRule: (rule) => {
      useSettingsStore.getState().disableHarperRule(rule);
    },
    notify: (message) => {
      useToastStore.getState().push("info", message);
    },
  });
}

installProofreadingActionHost();
