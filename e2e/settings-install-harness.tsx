import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { SettingsModal } from "/src/components/layout/SettingsModal";
import { useSettingsStore } from "/src/store/settings";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

await prepareHarnessI18n();
useSettingsStore.setState({ settingsOpen: true });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <SettingsModal />
  </QueryClientProvider>,
);
