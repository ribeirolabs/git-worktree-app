import { getTaskFromPath, isTask } from "./utils.ts";

type Status = {
  type: "success" | "error" | "info" | "confirmation";
  message: string;
};

type Page = "idle" | "update" | "token" | "delete-worktree" | "delete-branch";

type Action = {
  label: string;
  shortcut: string[];
  hidden?: boolean;
  cond?: () => boolean;
  callback: () => false | any;
};

type AddAction = Omit<Action, "label" | "shortcut"> & {
  shortcut?: Action["shortcut"];
};

export const App: {
  interval: NodeJS.Timeout | null;
  page: Page;
  selected: number;
  selectNext(): void;
  selectPrevious(): void;
  getSelectedBranch(): string;
  status: Status | null;
  setStatus(
    type: Status["type"],
    message: Status["message"],
    timeout?: number,
  ): void;
  clearStatus(): void;
  token: string | null;
  readonly paths: string[];
  readonly tasks: string[];
  setPaths(paths: string[]): void;
  taskNames: Record<string, string>;
  taskStatus: Record<string, Status | null>;
  setTaskStatus(
    taskId: string,
    type: Status["type"],
    message: Status["message"],
    timeout?: number,
  ): void;
  clearTaskStatus(taskId?: string): void;
  input: string;
  actions: Action[];
  addActions(actions: Record<string, AddAction>): void;
  _lastPage: Page | null;
  toPage(page: Page): void;
  previousPage(): void;
  debug?: string;
} = {
  interval: null,
  page: "idle",
  selected: 0,
  selectNext() {
    this.selected = Math.min(this.paths.length - 1, this.selected + 1);
  },
  selectPrevious() {
    this.selected = Math.max(0, this.selected - 1);
  },
  getSelectedBranch() {
    const path = this.paths[this.selected];
    if (!path) throw new Error("Unable to get selected path");
    return getTaskFromPath(path);
  },
  status: null,
  setStatus(type, message, timeout) {
    this.status = {
      type,
      message,
    };

    if (timeout) {
      setTimeout(() => this.clearStatus(), timeout);
    }
  },
  clearStatus() {
    this.status = null;
  },
  token: null,
  paths: [],
  setPaths(paths: string[]) {
    // @ts-ignore
    this.paths = paths;
    // @ts-ignore
    this.tasks = paths
      .filter((path) => {
        const taskId = getTaskFromPath(path);
        return isTask(taskId);
      })
      .map(getTaskFromPath);
  },
  tasks: [],
  taskNames: {},
  taskStatus: {},
  setTaskStatus(taskId, type, message, timeout) {
    this.taskStatus[taskId] = {
      type,
      message,
    };
    if (timeout) {
      setTimeout(() => this.clearTaskStatus(taskId), timeout);
    }
  },
  clearTaskStatus(taskId) {
    if (taskId) {
      this.taskStatus[taskId] = null;
    } else {
      this.taskStatus = {};
    }
  },
  input: "",
  actions: [],
  addActions(actions: Record<string, AddAction>) {
    for (const label in actions) {
      const options = actions[label];

      const shortcut =
        options.shortcut && options.shortcut.length
          ? options.shortcut
          : [label[0]];

      this.actions.push({
        ...options,
        label,
        shortcut,
      });
    }
  },
  _lastPage: null,
  toPage(page) {
    this._lastPage = this.page;
    this.page = page;

    if (page === "token") {
      this.input = "";
    }
  },
  previousPage() {
    const last = this._lastPage;
    if (last) {
      this.toPage(last);
    }
  },
};
