import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import type { WebApi, WebMe } from "../api";
import { AppHeader } from "./AppHeader";
import { navigate, useProjectParam } from "./navigation";
import { ProjectList } from "./ProjectList";
import { SignIn } from "./SignIn";

const ProjectScreen = lazy(() => import("./ProjectScreen"));

type Account = { status: "loading" } | { status: "failed" } | { status: "signed-out" } | { status: "ready"; me: WebMe };

function Centered({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-1 items-center justify-center p-6">{children}</div>;
}

export function App({ api }: Readonly<{ api: WebApi }>) {
  const { t } = useTranslation(["web"]);
  const projectId = useProjectParam();
  const [account, setAccount] = useState<Account>({ status: "loading" });
  const [signOutFailed, setSignOutFailed] = useState(false);

  const load = useCallback(() => {
    setAccount({ status: "loading" });
    api.me().then(
      (me) => setAccount(me ? { status: "ready", me } : { status: "signed-out" }),
      () => setAccount({ status: "failed" }),
    );
  }, [api]);
  useEffect(load, [load]);

  const signOut = useCallback(() => {
    setSignOutFailed(false);
    api.signOut().then(
      () => {
        navigate(null);
        setAccount({ status: "signed-out" });
      },
      () => setSignOutFailed(true),
    );
  }, [api]);

  let content: ReactNode;
  if (account.status === "loading") {
    content = (
      <Centered>
        <LoadingState label={t(($) => $.web.app.loading)} />
      </Centered>
    );
  } else if (account.status === "failed") {
    content = (
      <Centered>
        <ErrorState message={t(($) => $.web.app.loadFailed)}>
          <Button type="button" size="sm" variant="outline" onClick={load}>
            {t(($) => $.web.app.retry)}
          </Button>
        </ErrorState>
      </Centered>
    );
  } else if (account.status === "signed-out") {
    content = <SignIn />;
  } else if (projectId) {
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <Suspense
          fallback={
            <Centered>
              <LoadingState label={t(($) => $.web.app.loading)} />
            </Centered>
          }
        >
          <ProjectScreen
            key={projectId}
            api={api}
            me={account.me}
            projectId={projectId}
            onSignOut={signOut}
            signOutFailed={signOutFailed}
          />
        </Suspense>
      </div>
    );
  } else {
    content = <ProjectList api={api} />;
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <AppHeader me={account.status === "ready" ? account.me : null} onSignOut={signOut} />
      {signOutFailed ? (
        <p role="alert" className="border-b px-3 py-1.5 text-xs text-destructive">
          {t(($) => $.web.app.signOutFailed)}
        </p>
      ) : null}
      {content}
    </div>
  );
}
