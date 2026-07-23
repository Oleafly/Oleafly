import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHomeViewStore, type HomePage } from "@/store/home-view";

export function ToolPageShell({
  page,
  title,
  testId,
  children,
}: {
  page: HomePage;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  const activePage = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);
  if (activePage !== page) return null;
  return (
    <div data-testid={testId} className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => goTo("library")} data-testid={`${testId}-back`}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="font-medium">{title}</div>
      </div>
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
