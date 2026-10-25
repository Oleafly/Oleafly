import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppWindow, GitBranch, LibraryBig } from "lucide-react";
import { McpBrandIcon } from "@/components/ai/McpBrandIcon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHostingSection } from "@/components/settings/git-hosting/GitHostingSection";
import { AlphaXivSection } from "@/components/settings/AlphaXivSection";
import { ZoteroSection } from "@/components/settings/ZoteroSection";
import { CitationSearchIntegrationSection } from "@/components/settings/CitationSearchIntegrationSection";
import { McpSection } from "@/components/settings/McpSection";
import { OverleafSection } from "@/components/settings/OverleafSection";
import {
  AlphaXivBrandIcon,
  OverleafBrandIcon,
  ZoteroBrandIcon,
} from "@/components/settings/IntegrationBrandIcons";
import { useSettingsStore } from "@/store/settings";

// 0.4.8 I: loaded only when its tab opens.
const DesktopAppsSection = lazy(() => import("@/components/settings/desktop-apps/DesktopAppsSection"));

export function IntegrationsSection() {
  const { t } = useTranslation(["common", "settings"]);
  const [tab, setTab] = useState("git-hosting");
  const [oleaflyMcpVisited, setOleaflyMcpVisited] = useState(false);
  const scrollTarget = useSettingsStore(
    (state) => state.settingsScrollTarget,
  );
  const setScrollTarget = useSettingsStore(
    (state) => state.setSettingsScrollTarget,
  );

  useEffect(() => {
    if (scrollTarget === "git-hosting" || scrollTarget === "github") {
      setTab("git-hosting");
      setScrollTarget(null);
    } else if (scrollTarget === "overleaf") {
      setTab("overleaf");
      setScrollTarget(null);
    } else if (scrollTarget === "desktop-apps") {
      setTab("desktop-apps");
      setScrollTarget(null);
    } else if (scrollTarget === "zotero") {
      setTab("zotero");
      setScrollTarget(null);
    } else if (scrollTarget === "citation-search") {
      setTab("citation-search");
      setScrollTarget(null);
    } else if (scrollTarget === "oleafly-mcp") {
      setTab("oleafly-mcp");
      setOleaflyMcpVisited(true);
      setScrollTarget(null);
    }
  }, [scrollTarget, setScrollTarget]);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value);
        if (value === "oleafly-mcp") setOleaflyMcpVisited(true);
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
        <TabsTrigger value="desktop-apps" data-testid="integrations-tab-desktop-apps">
          <AppWindow className="mr-1.5 size-3.5" />
          {t(($) => $.settings.integrations.desktopApps.tab)}
        </TabsTrigger>
        <TabsTrigger
          value="alphaxiv"
          data-testid="integrations-tab-alphaxiv"
        >
          <AlphaXivBrandIcon className="mr-1.5 size-3.5 text-[oklch(45.36%_0.1566_16.66)] dark:text-[oklch(83.7%_0.0898_24.2)]" />
          {"alphaXiv"}
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
        <TabsTrigger
          value="oleafly-mcp"
          data-testid="integrations-tab-oleafly-mcp"
        >
          <McpBrandIcon className="mr-1.5 size-3.5" />
          {"Oleafly MCP"}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="git-hosting">
        <GitHostingSection />
      </TabsContent>
      <TabsContent value="overleaf">
        <OverleafSection />
      </TabsContent>
      <TabsContent value="desktop-apps">
        {tab === "desktop-apps" ? (
          <Suspense fallback={null}>
            <DesktopAppsSection />
          </Suspense>
        ) : null}
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
      {oleaflyMcpVisited ? (
        <TabsContent
          value="oleafly-mcp"
          forceMount
          hidden={tab !== "oleafly-mcp"}
        >
          <McpSection />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
