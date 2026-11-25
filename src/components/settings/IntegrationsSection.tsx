import { useEffect } from "react";
import { useSettingsStore } from "@/store/settings";
import { useTranslation } from "react-i18next";
import { GitBranch, LibraryBig } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHostingSection } from "@/components/settings/git-hosting/GitHostingSection";
import { ZoteroSection } from "@/components/settings/ZoteroSection";
import { CitationSearchIntegrationSection } from "@/components/settings/CitationSearchIntegrationSection";
import { OverleafSection } from "@/components/settings/OverleafSection";
import {
  OverleafBrandIcon,
  ZoteroBrandIcon,
} from "@/components/settings/IntegrationBrandIcons";
import { useSettingsTab } from "@/components/settings/use-settings-tab";

const INTEGRATIONS_TABS = [
  "git-hosting",
  "overleaf",
  "zotero",
  "citation-search",
] as const;

export function IntegrationsSection() {
  const { t } = useTranslation(["common", "settings"]);
  const [tab, setTab] = useSettingsTab("integrations", "git-hosting", INTEGRATIONS_TABS);


  const scrollTarget = useSettingsStore((state) => state.settingsScrollTarget);
  const setScrollTarget = useSettingsStore((state) => state.setSettingsScrollTarget);
  const settingsOpen = useSettingsStore((state) => state.settingsOpen);
  useEffect(() => {
    if (!settingsOpen) return;
    const target = scrollTarget === "github" ? "git-hosting" : scrollTarget;
    if (INTEGRATIONS_TABS.some((tab) => tab === target)) {
      setTab(target as (typeof INTEGRATIONS_TABS)[number]);
      setScrollTarget(null);
    }
  }, [settingsOpen, scrollTarget, setScrollTarget, setTab]);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value);
      }}
      className="space-y-4"
    >
      <TabsList scrollable>
        <TabsTrigger value="git-hosting" data-testid="integrations-tab-git-hosting">
          <GitBranch className="mr-1.5 size-3.5" />
          {t(($) => $.settings.gitHosting.title)}
        </TabsTrigger>
        <TabsTrigger value="overleaf" data-testid="integrations-tab-overleaf">
          <OverleafBrandIcon className="mr-1.5 size-3.5 text-[#47A141]" />
          {"Overleaf"}
        </TabsTrigger>

        <TabsTrigger value="zotero" data-testid="integrations-tab-zotero">
          <ZoteroBrandIcon className="mr-1.5 size-3.5 text-[#CC2936]" />
          {"Zotero"}
        </TabsTrigger>
        <TabsTrigger
          value="citation-search"
          data-testid="integrations-tab-citation-search"
        >
          <LibraryBig className="mr-1.5 size-3.5 text-blue-600 dark:text-blue-300" />
          {t(($) => $.settings.citations.title)}
        </TabsTrigger>

      </TabsList>
      <TabsContent value="git-hosting">
        <GitHostingSection />
      </TabsContent>
      <TabsContent value="overleaf">
        <OverleafSection />
      </TabsContent>

      <TabsContent value="zotero">
        <ZoteroSection />
      </TabsContent>
      <TabsContent value="citation-search">
        <CitationSearchIntegrationSection />
      </TabsContent>

    </Tabs>
  );
}
