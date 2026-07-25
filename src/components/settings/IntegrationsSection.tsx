import { Github } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHubSection } from "@/components/settings/GitHubSection";
import { AlphaXivSection } from "@/components/settings/AlphaXivSection";
import { ZoteroSection } from "@/components/settings/ZoteroSection";

export function IntegrationsSection() {
  return (
    <Tabs defaultValue="github" className="space-y-4">
      <TabsList>
        <TabsTrigger value="github" data-testid="integrations-tab-github">
          <Github className="mr-1.5 size-3.5" /> GitHub
        </TabsTrigger>
        <TabsTrigger value="alphaxiv" data-testid="integrations-tab-alphaxiv">alphaXiv</TabsTrigger>
        <TabsTrigger value="zotero" data-testid="integrations-tab-zotero">Zotero</TabsTrigger>
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
    </Tabs>
  );
}
