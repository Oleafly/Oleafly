import { ArrowLeft, FileText, FolderTree, MessageSquare, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { cn } from "@/lib/utils";
import { SIGN_IN_PATH, type WebApi, type WebMe } from "../api";
import type { ProjectController } from "../controller";
import { createEditorHost } from "../editor/host";
import { webEditorExtensions } from "../editor/extensions";
import { type DiscussionTab, type PaneView, type SidePane, useWeb } from "../store";
import { AppHeader } from "./AppHeader";
import { ChatPane } from "./ChatPane";
import { CommentsPane } from "./CommentsPane";
import { ConfirmDialog } from "./ConfirmDialog";
import { ActionsContext } from "./context";
import { errorKey } from "./errors";
import { FileTree } from "./FileTree";
import { navigate, projectFromLocation, projectHref, useMediaQuery } from "./navigation";
import { PdfPane } from "./PdfPane";
import { PersonAvatar } from "./people";
import { SourcePane } from "./SourcePane";

const LARGE = "(min-width: 1024px)";

function setView(view: PaneView) {
  useWeb.setState(view === "pdf" || view === "comments" ? { view, side: view } : { view });
}

function Presence() {
  const { t } = useTranslation(["web"]);
  const peers = useWeb((state) => state.peers);
  const people = useWeb((state) => state.people);
  const self = useWeb((state) => state.me?.accountId ?? null);
  const accounts = [...new Set(peers.map((peer) => peer.accountId))].filter((id) => id !== self);
  if (accounts.length === 0) return null;
  const shown = accounts.slice(0, 4);
  return (
    <ul aria-label={t(($) => $.web.presence.label)} className="hidden items-center -space-x-1 sm:flex">
      {shown.map((accountId) => {
        const name = people[accountId]?.name || peers.find((peer) => peer.accountId === accountId)?.name || "";
        return (
          <li key={accountId}>
            <Tooltip label={name || accountId}>
              <PersonAvatar accountId={accountId} name={name || "?"} className="border-2 border-sidebar" />
            </Tooltip>
          </li>
        );
      })}
      {accounts.length > shown.length ? (
        <li className="pl-2 text-[0.6875rem] text-muted-foreground">+{accounts.length - shown.length}</li>
      ) : null}
    </ul>
  );
}

function ConnectionDot() {
  const { t } = useTranslation(["web"]);
  const connection = useWeb((state) => state.connection);
  const label =
    connection === "online"
      ? t(($) => $.web.connection.online)
      : connection === "connecting"
        ? t(($) => $.web.connection.connecting)
        : connection === "offline"
          ? t(($) => $.web.connection.offline)
          : t(($) => $.web.connection.ended);
  return (
    <Tooltip label={label}>
      <span role="status" aria-label={label} className="flex size-4 shrink-0 items-center justify-center">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            connection === "online" ? "bg-emerald-500" : connection === "offline" ? "bg-amber-500" : "bg-muted-foreground/50",
          )}
        />
      </span>
    </Tooltip>
  );
}

function Banners() {
  const { t } = useTranslation(["web"]);
  const connection = useWeb((state) => state.connection);
  const roleChanged = useWeb((state) => state.roleChanged);
  const discarded = useWeb((state) => state.discarded);
  const notice = useWeb((state) => state.notice);
  return (
    <>
      {connection === "offline" ? (
        <WorkspaceBanner tone="warning" role="status">
          <WifiOff aria-hidden className="size-3.5" />
          {t(($) => $.web.connection.offlineBanner)}
        </WorkspaceBanner>
      ) : null}
      {roleChanged ? (
        <WorkspaceBanner tone="primary" role="status">
          <span className="flex-1">{t(($) => $.web.access.changed, { role: t(($) => $.web.roles[roleChanged]) })}</span>
          <WorkspaceBannerButton tone="primary" onClick={() => useWeb.setState({ roleChanged: null })}>
            {t(($) => $.web.app.dismiss)}
          </WorkspaceBannerButton>
        </WorkspaceBanner>
      ) : null}
      {discarded ? (
        <WorkspaceBanner tone="warning" role="alert">
          <span className="flex-1">{t(($) => $.web.discarded[discarded])}</span>
          <WorkspaceBannerButton tone="warning" onClick={() => useWeb.setState({ discarded: null })}>
            {t(($) => $.web.app.dismiss)}
          </WorkspaceBannerButton>
        </WorkspaceBanner>
      ) : null}
      {notice ? (
        <WorkspaceBanner tone="warning" role="alert" key={notice.at}>
          <span className="flex-1">{t(($) => $.web.errors[errorKey(notice.code)])}</span>
          <WorkspaceBannerButton tone="warning" aria-label={t(($) => $.web.app.dismiss)} onClick={() => useWeb.setState({ notice: null })}>
            <X aria-hidden className="size-3.5" />
          </WorkspaceBannerButton>
        </WorkspaceBanner>
      ) : null}
    </>
  );
}

function Ended() {
  const { t } = useTranslation(["web"]);
  const end = useWeb((state) => state.end);
  if (end === "signed_out") {
    return (
      <EmptyState
        className="flex-1 px-6 py-16"
        title={t(($) => $.web.ended.signedOutTitle)}
        description={t(($) => $.web.ended.signedOutDescription)}
      >
        <a href={SIGN_IN_PATH} className={buttonVariants({ size: "sm" })}>
          {t(($) => $.web.signIn.action)}
        </a>
      </EmptyState>
    );
  }
  if (end === "no_access" || end === "too_large") {
    return (
      <EmptyState
        className="flex-1 px-6 py-16"
        title={t(($) => $.web.ended.noAccessTitle)}
        description={
          end === "too_large" ? t(($) => $.web.errors.project_too_large) : t(($) => $.web.ended.noAccessDescription)
        }
      >
        <Button type="button" size="sm" variant="outline" onClick={() => navigate(null)}>
          {t(($) => $.web.app.projects)}
        </Button>
      </EmptyState>
    );
  }
  return (
    <EmptyState
      className="flex-1 px-6 py-16"
      title={t(($) => $.web.ended.stoppedTitle)}
      description={t(($) => $.web.ended.stoppedDescription)}
    />
  );
}

function SideSwitch() {
  const { t } = useTranslation(["web"]);
  const side = useWeb((state) => state.side);
  return (
    <div className="hidden border-b px-2 py-1 lg:flex xl:hidden">
      <Tabs value={side} onValueChange={(value) => useWeb.setState({ side: value as SidePane })}>
        <TabsList size="sm" aria-label={t(($) => $.web.views.label)}>
          <TabsTrigger value="pdf">{t(($) => $.web.views.pdf)}</TabsTrigger>
          <TabsTrigger value="comments">{t(($) => $.web.views.comments)}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

function Discussion() {
  const { t } = useTranslation(["web"]);
  const discussion = useWeb((state) => state.discussion);
  const features = useWeb((state) => state.features);
  const tab = features.chat ? discussion : "comments";
  return (
    <>
      {features.chat ? (
        <div className="flex border-b px-2 py-1">
          <Tabs value={tab} onValueChange={(value) => useWeb.setState({ discussion: value as DiscussionTab })}>
            <TabsList size="sm">
              <TabsTrigger value="comments">{t(($) => $.web.views.comments)}</TabsTrigger>
              <TabsTrigger value="chat">{t(($) => $.web.views.chat)}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      ) : null}
      {tab === "chat" ? <ChatPane /> : <CommentsPane />}
    </>
  );
}

export function ProjectView({
  controller,
  api,
  me,
  onSignOut,
  signOutFailed,
}: Readonly<{ controller: ProjectController; api: WebApi; me: WebMe; onSignOut: () => void; signOutFailed: boolean }>) {
  const { t } = useTranslation(["web"]);
  const host = useMemo(() => createEditorHost(controller), [controller]);
  const extensions = useMemo(() => webEditorExtensions(controller), [controller]);
  const large = useMediaQuery(LARGE);
  const projectId = useWeb((state) => state.projectId ?? "");
  const title = useWeb((state) => state.title);
  const role = useWeb((state) => state.role);
  const end = useWeb((state) => state.end);
  const view = useWeb((state) => state.view);
  const side = useWeb((state) => state.side);
  const files = useWeb((state) => state.files);
  const activeFileId = useWeb((state) => state.activeFileId);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!controller.unconfirmed()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [controller]);

  useEffect(() => {
    const back = () => {
      if (!projectId || projectFromLocation() === projectId || !controller.unconfirmed()) return;
      window.history.pushState(null, "", projectHref(projectId));
      setLeaving(true);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [controller, projectId]);

  const leave = (
    <ConfirmDialog
      open={leaving}
      title={t(($) => $.web.leave.title)}
      description={t(($) => $.web.leave.description)}
      confirmLabel={t(($) => $.web.leave.confirm)}
      onConfirm={() => {
        setLeaving(false);
        controller.discardUnsent();
        navigate(null);
      }}
      onCancel={() => setLeaving(false)}
    />
  );

  const header = (
    <AppHeader me={me} onSignOut={onSignOut}>
      <a
        href={projectHref(null)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          if (controller.unconfirmed()) setLeaving(true);
          else navigate(null);
        }}
        aria-label={t(($) => $.web.app.projects)}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7 shrink-0")}
      >
        <ArrowLeft aria-hidden />
      </a>
      <h1 className="min-w-0 truncate text-sm font-medium">{title || t(($) => $.web.projects.untitled)}</h1>
      <Badge variant="muted" size="sm" data-testid="role-badge">
        {t(($) => $.web.roles[role])}
      </Badge>
      <ConnectionDot />
      <div className="ml-auto flex items-center gap-2">
        <Presence />
      </div>
    </AppHeader>
  );

  if (end) {
    return (
      <>
        {header}
        {leave}
        <Ended />
      </>
    );
  }

  return (
    <ActionsContext.Provider value={controller}>
      {header}
      {leave}
      {signOutFailed ? (
        <p role="alert" className="border-b px-3 py-1.5 text-xs text-destructive">
          {t(($) => $.web.app.signOutFailed)}
        </p>
      ) : null}
      <Banners />
      <div className="border-b px-2 py-1 lg:hidden">
        <Tabs value={view} onValueChange={(value) => setView(value as PaneView)}>
          <TabsList fill size="sm" aria-label={t(($) => $.web.views.label)} className="w-full">
            <TabsTrigger value="files">
              <FolderTree aria-hidden className="hidden min-[400px]:block" />
              {t(($) => $.web.views.files)}
            </TabsTrigger>
            <TabsTrigger value="source">
              <FileText aria-hidden className="hidden min-[400px]:block" />
              {t(($) => $.web.views.source)}
            </TabsTrigger>
            <TabsTrigger value="pdf">
              <FileText aria-hidden className="hidden min-[400px]:block" />
              {t(($) => $.web.views.pdf)}
            </TabsTrigger>
            <TabsTrigger value="comments">
              <MessageSquare aria-hidden className="hidden min-[400px]:block" />
              {t(($) => $.web.views.comments)}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <aside
          aria-label={t(($) => $.web.files.title)}
          className={cn("min-h-0 flex-col border-r bg-sidebar", view === "files" ? "flex" : "hidden", "lg:flex")}
        >
          <p className="hidden border-b px-3 py-2 text-xs font-medium text-muted-foreground lg:block">
            {t(($) => $.web.files.title)}
          </p>
          <FileTree files={files} activeFileId={activeFileId} onOpen={(fileId) => controller.openFile(fileId)} />
        </aside>
        <section
          aria-label={t(($) => $.web.views.source)}
          className={cn("min-h-0 min-w-0 flex-col border-r", view === "source" ? "flex" : "hidden", "lg:flex")}
        >
          <SourcePane host={host} extensions={extensions} api={api} visible={large || view === "source"} />
        </section>
        <section
          aria-label={t(($) => $.web.views.pdf)}
          className={cn(
            "min-h-0 min-w-0 flex-col border-r",
            view === "pdf" ? "flex" : "hidden",
            side === "pdf" ? "lg:flex" : "lg:hidden",
            "xl:flex",
          )}
        >
          <SideSwitch />
          <PdfPane api={api} projectId={projectId} />
        </section>
        <section
          aria-label={t(($) => $.web.views.comments)}
          className={cn(
            "min-h-0 min-w-0 flex-col bg-sidebar",
            view === "comments" ? "flex" : "hidden",
            side === "comments" ? "lg:flex" : "lg:hidden",
            "xl:flex",
          )}
        >
          <SideSwitch />
          <Discussion />
        </section>
      </div>
    </ActionsContext.Provider>
  );
}
