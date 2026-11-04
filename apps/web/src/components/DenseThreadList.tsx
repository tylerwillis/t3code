// Local fork: a dense, flat list of every thread, pinned first, then by last message.
// Kept out of Sidebar.tsx on purpose so upstream sidebar churn doesn't conflict.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { InboxIcon, PinIcon, PinOffIcon, SearchIcon, XIcon } from "lucide-react";
import { memo, useState } from "react";

import { isElectron } from "../env";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { cn } from "../lib/utils";
import { useEnvironmentIdentities } from "../state/environments";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import {
  denseThreadLastActivityAt,
  matchesDenseThreadFilter,
  orderDenseThreads,
} from "./DenseThreadList.logic";
import { useDenseThreadListView } from "./denseThreadListView";
import {
  filterSidebarV2VisibleThreads,
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
} from "./Sidebar.logic";
import { SidebarHeaderIconButton } from "./sidebar/SidebarThreadHeader";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { Button } from "./ui/button";
import { SidebarContent, SidebarGroup, SidebarInput, useSidebar } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";

const PAGE_SIZE = 300;

type RowDot = "attention" | "working" | "failed" | "unread" | null;

function resolveRowDot(thread: SidebarThreadSummary): RowDot {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input" || status === "request") return "attention";
  if (status === "working") return "working";
  if (status === "failed" || status === "limited") return "failed";
  if (hasUnseenCompletion({ ...thread, lastVisitedAt: thread.lastVisitedAt ?? null })) {
    return "unread";
  }
  return null;
}

const DOT_CLASS: Record<Exclude<RowDot, null>, string> = {
  attention: "bg-warning",
  working: "bg-info",
  failed: "bg-destructive",
  unread: "bg-primary",
};

// Subscribes to the minute tick itself so only the label re-renders each minute.
function DenseTimeLabel(props: { timestamp: string }) {
  const nowMinute = useNowMinute();
  const label = formatRelativeTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00.000Z`));
  return <>{label === "just now" ? "now" : label.replace(/ ago$/, "")}</>;
}

const DenseThreadRow = memo(function DenseThreadRow(props: {
  thread: SidebarThreadSummary;
  subtitle: string;
  lastActivityAt: string;
  isActive: boolean;
  isPinned: boolean;
  onOpen: (ref: ScopedThreadRef) => void;
  onTogglePin: (ref: ScopedThreadRef, pinned: boolean) => void;
}) {
  const { thread, isActive, isPinned } = props;
  const ref: ScopedThreadRef = { environmentId: thread.environmentId, threadId: thread.id };
  const dot = resolveRowDot(thread);
  return (
    <li className="group/dense-row relative">
      <button
        type="button"
        aria-current={isActive ? "page" : undefined}
        onClick={() => props.onOpen(ref)}
        className={cn(
          "flex h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm pr-1 pl-1.5 text-left text-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <span className="flex size-1.5 shrink-0 items-center justify-center" aria-hidden>
          {dot ? <span className={cn("size-1.5 rounded-full", DOT_CLASS[dot])} /> : null}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            dot === null && !isActive && "text-sidebar-foreground/85",
          )}
        >
          {thread.title}
        </span>
        <span className="max-w-[40%] shrink-0 truncate text-2xs text-sidebar-muted-foreground">
          {props.subtitle}
        </span>
        <span className="w-9 shrink-0 text-right text-2xs tabular-nums text-sidebar-muted-foreground group-hover/dense-row:invisible group-focus-within/dense-row:invisible">
          <DenseTimeLabel timestamp={props.lastActivityAt} />
        </span>
      </button>
      <Button
        type="button"
        size="icon-micro"
        variant="ghost-muted"
        aria-label={isPinned ? "Unpin thread" : "Pin thread"}
        onClick={() => props.onTogglePin(ref, isPinned)}
        className="absolute top-1/2 right-1 hidden -translate-y-1/2 group-hover/dense-row:inline-flex group-focus-within/dense-row:inline-flex"
      >
        {isPinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
      </Button>
    </li>
  );
});

export default function DenseThreadList() {
  const [, setDenseView] = useDenseThreadListView();
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const projects = useProjects();
  const environments = useEnvironmentIdentities();
  const routeTarget = useThreadRouteTarget();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { pinThread, confirmAndUnpinThread } = useThreadActions();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const projectTitleByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title] as const),
  );
  const environmentLabelById =
    environments.length > 1
      ? new Map(environments.map((env) => [env.environmentId, env.label] as const))
      : null;
  const subtitleFor = (thread: SidebarThreadSummary) => {
    const project = projectTitleByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? "";
    const machine = environmentLabelById?.get(thread.environmentId);
    return machine ? `${project} · ${machine}` : project;
  };

  const visible = filterSidebarV2VisibleThreads(threads, null, delegatedUnderParent).filter(
    (thread) =>
      thread.deletedAt === null &&
      matchesDenseThreadFilter(query, [thread.title, subtitleFor(thread), thread.branch]),
  );
  const { pinned, rest } = orderDenseThreads(visible);
  const shownRest = rest.slice(0, limit);
  const activeKey = routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;

  const openThread = (ref: ScopedThreadRef) => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const togglePin = (ref: ScopedThreadRef, isPinned: boolean) => {
    void (async () => {
      const result = isPinned ? await confirmAndUnpinThread(ref) : await pinThread(ref);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: isPinned ? "Failed to unpin thread" : "Failed to pin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const renderRow = (thread: SidebarThreadSummary) => {
    const key = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
    return (
      <DenseThreadRow
        key={key}
        thread={thread}
        subtitle={subtitleFor(thread)}
        lastActivityAt={denseThreadLastActivityAt(thread)}
        isActive={key === activeKey}
        isPinned={thread.pinnedAt !== null}
        onOpen={openThread}
        onTogglePin={togglePin}
      />
    );
  };

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="flex items-center gap-1">
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground focus-within:bg-sidebar-row-hover focus-within:text-sidebar-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
                <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
                <SidebarInput
                  nativeInput
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("");
                  }}
                  placeholder="Filter threads"
                  aria-label="Filter threads"
                  className="min-w-0 flex-1"
                />
                {query ? (
                  <Button
                    type="button"
                    size="icon-micro"
                    variant="ghost-muted"
                    className="shrink-0"
                    aria-label="Clear filter"
                    onClick={() => setQuery("")}
                  >
                    <XIcon className="size-3" />
                  </Button>
                ) : null}
              </div>
              <SidebarHeaderIconButton
                label="Back to inbox view"
                onClick={() => setDenseView(false)}
              >
                <InboxIcon />
              </SidebarHeaderIconButton>
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          {pinned.length > 0 ? (
            <>
              <ul aria-label="Pinned threads" className="flex flex-col">
                {pinned.map(renderRow)}
              </ul>
              <div className="mx-1.5 my-1 border-t border-sidebar-border/60" role="separator" />
            </>
          ) : null}
          <ul aria-label="Threads" className="flex flex-col">
            {shownRest.map(renderRow)}
          </ul>
          {rest.length > shownRest.length ? (
            <button
              type="button"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
              className="mt-1 h-6 rounded-sm px-1.5 text-left text-2xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            >
              Show {Math.min(PAGE_SIZE, rest.length - shownRest.length)} more of{" "}
              {rest.length - shownRest.length}
            </button>
          ) : null}
          {pinned.length === 0 && rest.length === 0 ? (
            <div className="px-1.5 py-2 text-xs text-sidebar-muted-foreground">
              {query ? "No threads match" : "No threads yet"}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
