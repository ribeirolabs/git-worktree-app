import * as z from "zod";
import { getTaskFromPath, isTask } from "./utils.ts";

type Status = {
  type: "success" | "error" | "info" | "confirmation";
  message: string;
};

type Page =
  | "idle"
  | "update"
  | "token"
  | "delete-worktree"
  | "delete-branch"
  | "add";

type Action = {
  label: string;
  shortcut: string;
  hidden?: boolean;
  disabled?: () => boolean;
  callback: () => false | any;
};

type AddAction = Omit<Action, "label" | "shortcut"> & {
  shortcut?: Action["shortcut"];
};

export const TaskSchema = z.interface({
  id: z.string(),
  name: z.string(),
  status: z.string(),
});

export type Task = z.infer<typeof TaskSchema>;

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
  setPaths(paths: string[]): void;
  readonly taskIds: string[];
  tasks: Record<string, Task>;
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
  setupActions(pages: Record<Page, Record<string, AddAction>>): void;
  _lastPage: Page | null;
  toPage(page: Page): void;
  previousPage(): void;
  debug?: string;
  // Key state tracking
  _keyStates: Record<string, boolean>;
  _keyJustPressed: Record<string, boolean>;
  _keyJustReleased: Record<string, boolean>;
  keyPressed(key: string): boolean;
  consumeKey(key: string, cb: () => void): void;
  consumeAnyKey(cb: (key: string) => void): void;
  keyJustPressed(key: string): boolean;
  keyJustReleased(key: string): boolean;
  updateKeyStates(): void;
  setKeyState(key: string, pressed: boolean): void;
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
    this.paths = [...paths].sort((a, b) => {
      if (a.endsWith("/master")) {
        return -1;
      }

      if (b.endsWith("/master")) {
        return 1;
      }

      if (/\/mob-.+$/.test(a)) {
        return -1;
      }

      if (/\/solo-.+$/.test(a)) {
        return -1;
      }

      if (/\/solo-.+$/.test(b)) {
        return 1;
      }

      if (/\/mob-.+$/.test(b)) {
        return 1;
      }

      return 1;
    });
    // @ts-ignore
    this.taskIds = paths
      .filter((path) => {
        const taskId = getTaskFromPath(path);
        return isTask(taskId);
      })
      .map(getTaskFromPath);
  },
  taskIds: [],
  tasks: {},
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

      const shortcut = options.shortcut ?? label[0];

      this.actions.push({
        ...options,
        label,
        shortcut,
      });
    }
  },
  setupActions(pages) {
    this.actions = [];
    for (const page in pages) {
      const actions = pages[page as Page];
      if (App.page !== page) {
        continue;
      }
      this.addActions(actions);
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
  // Key state tracking
  _keyStates: {},
  _keyJustPressed: {},
  _keyJustReleased: {},

  keyPressed(key: string): boolean {
    return !!this._keyStates[key];
  },

  consumeKey(key, cb) {
    if (this._keyStates[key]) {
      this._keyStates[key] = false;
      cb();
    }
  },

  consumeAnyKey(cb) {
    const key = Object.keys(this._keyStates).find(
      (key) => this._keyStates[key],
    );
    if (!key) {
      return;
    }
    this._keyStates[key] = false;
    cb(key);
  },

  keyJustPressed(key: string): boolean {
    return !!this._keyJustPressed[key];
  },

  keyJustReleased(key: string): boolean {
    return !!this._keyJustReleased[key];
  },

  updateKeyStates(): void {
    // Clear the "just" states at the beginning of each frame
    this._keyJustPressed = {};
    this._keyJustReleased = {};
  },

  setKeyState(key: string, pressed: boolean): void {
    // If the key state is changing from not pressed to pressed
    if (pressed && !this._keyStates[key]) {
      this._keyJustPressed[key] = true;
    }
    // If the key state is changing from pressed to not pressed
    else if (!pressed && this._keyStates[key]) {
      this._keyJustReleased[key] = true;
    }

    // Update the current state
    this._keyStates[key] = pressed;
  },
};
