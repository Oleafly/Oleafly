import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LockKeyhole } from "lucide-react";
import type { PdfLoadState } from "@/components/pdf/PdfViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PdfViewerOverlay({
  loadState,
  passwordDraft,
  onPasswordDraftChange,
  onSubmitPassword,
  children,
}: Readonly<{
  loadState: PdfLoadState;
  passwordDraft: string;
  onPasswordDraftChange: (value: string) => void;
  onSubmitPassword: () => void;
  children?: ReactNode;
}>) {
  const { t } = useTranslation(["common", "preview"]);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-sidebar/90 p-6 backdrop-blur-[1px]">
      {loadState.status === "password_required" ? (
        <form
          className="w-full max-w-xs space-y-3 text-center"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitPassword();
          }}
        >
          <LockKeyhole className="mx-auto size-8 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">
              {t(($) => $.preview.password.title)}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {loadState.message}
            </p>
          </div>
          <Input
            autoFocus
            type="password"
            autoComplete="off"
            value={passwordDraft}
            onChange={(event) => onPasswordDraftChange(event.target.value)}
            aria-label={t(($) => $.preview.password.label)}
            placeholder={t(($) => $.preview.password.placeholder)}
          />
          <Button type="submit" size="sm" disabled={!passwordDraft}>
            {t(($) => $.preview.password.submit)}
          </Button>
        </form>
      ) : (
        children
      )}
    </div>
  );
}
