import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { SIGN_IN_PATH } from "../api";
import { LeafMark } from "./AppHeader";

export function SignIn() {
  const { t } = useTranslation(["web"]);
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-6 text-center shadow-sm">
        <LeafMark className="mx-auto size-10" />
        <div className="space-y-2">
          <h1 className="text-lg font-semibold tracking-tight">{t(($) => $.web.signIn.title)}</h1>
          <p className="text-sm text-muted-foreground">{t(($) => $.web.signIn.description)}</p>
        </div>
        <a href={SIGN_IN_PATH} className={buttonVariants({ className: "w-full" })}>
          {t(($) => $.web.signIn.action)}
        </a>
      </div>
    </main>
  );
}
