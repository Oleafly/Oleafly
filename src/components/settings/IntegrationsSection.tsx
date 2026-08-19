import { useEffect, useState } from "react";
import { Github, LibraryBig } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHubSection } from "@/components/settings/GitHubSection";
import { AlphaXivSection } from "@/components/settings/AlphaXivSection";
import { ZoteroSection } from "@/components/settings/ZoteroSection";
import { CitationSearchIntegrationSection } from "@/components/settings/CitationSearchIntegrationSection";
import {
  AlphaXivBrandIcon,
  ZoteroBrandIcon,
} from "@/components/settings/IntegrationBrandIcons";
import { useSettingsStore } from "@/store/settings";

export function IntegrationsSection() {
  const [tab, setTab] = useState("github");
  const scrollTarget = useSettingsStore(
    (state) => state.settingsScrollTarget,
  );
  const setScrollTarget = useSettingsStore(
    (state) => state.setSettingsScrollTarget,
  );

  useEffect(() => {
    if (scrollTarget === "github") {
      setTab("github");
      setScrollTarget(null);
    } else if (scrollTarget === "citation-search") {
      setTab("citation-search");
      setScrollTarget(null);
    }
  }, [scrollTarget, setScrollTarget]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="github" data-testid="integrations-tab-github">
          <Github className="mr-1.5 size-3.5" /> GitHub
        </TabsTrigger>
        <TabsTrigger
          value="alphaxiv"
          data-testid="integrations-tab-alphaxiv"
        >
          <AlphaXivBrandIcon className="mr-1.5 size-3.5 rounded-sm" />
          alphaXiv
        </TabsTrigger>
        <TabsTrigger value="zotero" data-testid="integrations-tab-zotero">
          <ZoteroBrandIcon className="mr-1.5 size-3.5 text-[#cc2936]" />
          Zotero
        </TabsTrigger>
        <TabsTrigger
          value="citation-search"
          data-testid="integrations-tab-citation-search"
        >
          <LibraryBig className="mr-1.5 size-3.5 text-blue-600 dark:text-blue-300" />
          Citation Search
        </TabsTrigger>
      </TabsList>
      <TabsContent value="github">
        <GitHubSection />
      </TabsContent>
      <TabsContent value="alphaxiv">
        <AlphaXivSection />
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
