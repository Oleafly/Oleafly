import { useEffect, useRef, useState } from "react";
import { logError } from "@/lib/log";
import { listenForResearchTaskChanges, listResearchTasks, type ResearchTask } from "@/lib/research-tasks";

export type TasksByProject = ReadonlyMap<string, readonly ResearchTask[]>;

const EMPTY: TasksByProject = new Map();

function merged(projectId: string, list: readonly ResearchTask[], seen: ReadonlyMap<string, ResearchTask>): ResearchTask[] {
  const listed = new Set(list.map((task) => task.id));
  const newer = [...seen.values()].filter((task) => task.projectId === projectId && !listed.has(task.id));
  const updated = list.map((task) => {
    const event = seen.get(task.id);
    return event && event.updatedAt >= task.updatedAt ? event : task;
  });
  return [...newer, ...updated];
}

export function useResearchTasks(projectIds: readonly string[]): TasksByProject {
  const key = [...new Set(projectIds)].sort((left, right) => left.localeCompare(right)).join("\n");
  const [tasks, setTasks] = useState<TasksByProject>(EMPTY);
  const seenRef = useRef(new Map<string, ResearchTask>());

  useEffect(() => {
    const ids = key === "" ? [] : key.split("\n");
    let live = true;
    void Promise.all(
      ids.map((id) =>
        listResearchTasks(id).then(
          (list): [string, readonly ResearchTask[]] => [id, list],
          (error: unknown): [string, readonly ResearchTask[]] => {
            void logError("list research tasks for notes", error);
            return [id, []];
          },
        ),
      ),
    ).then((entries) => {
      if (live) setTasks(new Map(entries.map(([id, list]) => [id, merged(id, list, seenRef.current)])));
    });
    return () => {
      live = false;
    };
  }, [key]);

  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    listenForResearchTaskChanges((task) => {
      seenRef.current.set(task.id, task);
      setTasks((current) => {
        const list = current.get(task.projectId);
        if (!list) return current;
        const next = new Map(current);
        next.set(task.projectId, [task, ...list.filter((item) => item.id !== task.id)]);
        return next;
      });
    }).then(
      (unlisten) => {
        if (live) stop = unlisten;
        else unlisten();
      },
      (error: unknown) => void logError("watch research tasks for notes", error),
    );
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  return tasks;
}
