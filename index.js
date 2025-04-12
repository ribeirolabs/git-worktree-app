const OS = require("node:os");
const { stdin: input, stdout: output } = require("node:process");
const Child = require("node:child_process");
const Path = require("node:path");
const File = require("node:fs");
const { default: chalk } = require("chalk");
const { Clickup } = require("./service/clickup");

const ENTER = "\r";
const ESC = "\u001b";
const BACKSPACE = "\u007f";
const ARROW_UP = "\u001b[A";
const ARROW_DOWN = "\u001b[B";
const ARROW_RIGHT = "\u001b[C";
const ARROW_LEFT = "\u001b[D";

const DIRECTION_KEYS = {
  UP: [ARROW_UP, "k"],
  DOWN: [ARROW_DOWN, "j"],
  LEFT: [ARROW_LEFT, "h"],
  RIGHT: [ARROW_RIGHT, "l"],
};

const KEY_TEXT = {
  [ENTER]: "enter",
  [ESC]: "esc",
  [ARROW_UP]: "↑",
  [ARROW_DOWN]: "↓",
  [ARROW_LEFT]: "←",
  [ARROW_RIGHT]: "→",
};

const STORE_DIR = ".local/share/gw-app";

const TASKS_FILE = Path.join(OS.homedir(), STORE_DIR, "tasks");
const TASKS_FILE_SEPARATOR = ":";

const TOKEN_FILE = Path.join(OS.homedir(), STORE_DIR, "token");

input.setRawMode(true);
input.resume();

/**
 * @typedef {{
 *   type: "success" | "error" | "info" | "confirmation"
 *   message: string
 * }} Status
 *
 * @typedef { "idle" | "update" | "token" | "delete-worktree" | "delete-branch"} Page
 *
 * @typedef {{
 *  label: string,
 *  shortcut: string[],
 *  cond?: () => boolean,
 *  callback: () => false | void,
 *  hidden?: boolean,
 * }} Action
 *
 * @typedef {Omit<Action, 'label' | 'shortcut'> & { shortcut?: Action['shortcut']} AddAction
 */

/**
 * @type {{
 *  interval: number | null,
 *  page: Page,
 *  selected: number,
 *  status: Status | null,
 *  token: string | null,
 *  paths: string[],
 *  tasks: string[],
 *  taskNames: Record<string, string>,
 *  taskStatus: Record<string, Status | null>,
 *  input: string,
 *  _lastPage: Page | null,
 *  toPage: (page: Page) => void,
 *  previousPage: () => void,
 *  actions: Action[]
 * }}
 */
const State = {
  interval: null,
  page: "idle",
  selected: 0,
  status: null,
  token: null,
  paths: [],
  tasks: [],
  taskNames: {},
  taskStatus: {},
  input: "",
  _lastPage: null,
  toPage(page) {
    this._lastPage = this.page;
    this.page = page;

    if (page === "token") {
      State.input = "";
    }
  },
  previousPage() {
    const last = this._lastPage;
    if (last) {
      this.toPage(last);
    }
  },
};

const clickup = new Clickup();

/**
 * @param {keyof typeof DIRECTION_KEYS} direction
 * @param {string} key
 * @returns {boolean}
 */
function isDirection(direction, key) {
  return DIRECTION_KEYS[direction].includes(key);
}

/**
 * @param type {Status['type']}
 * @param message {Status['message']}
 * @param timeout {undefined | number}
 */
function setStatus(type, message, timeout) {
  if (type && message) {
    State.status = {
      type,
      message,
    };

    if (timeout) setTimeout(clearStatus, timeout);
  }
}

function clearStatus() {
  State.status = null;
}

/**
 * @param taskId {string}
 * @param type {Status['type']}
 * @param message {Status['message']}
 * @param timeout {undefined | number}
 */
function setTaskStatus(taskId, type, message, timeout) {
  State.taskStatus[taskId] = {
    type,
    message,
  };
  if (timeout) {
    setTimeout(() => clearTaskStatus(taskId), timeout);
  }
}

/**
 * @param taskId {string | null}
 */
function clearTaskStatus(taskId) {
  if (taskId) {
    State.taskStatus[taskId] = null;
  } else {
    State.taskStatus = {};
  }
}

/**
 * @param {string} label
 * @param {AddAction} opts
 */
function addAction(label, { shortcut, ...opts }) {
  State.actions.push({
    ...opts,
    label,
    shortcut: shortcut && shortcut.length ? shortcut : [label[0]],
  });
}

/**
 * @param {Record<string, AddAction>} actions
 */
function addActions(actions) {
  for (const label in actions) {
    addAction(label, actions[label]);
  }
}

function renderHeader() {
  const name =
    State.page === "update"
      ? "Update"
      : State.page === "token"
        ? "Token"
        : "Worktree";

  output.write("\n");
  output.write(`  ${chalk.bold(name.padEnd(10, " "))}`);
  output.write("\t");
  renderActions();
  renderHorizontalLine();
  output.write("\n");
}

function renderHorizontalLine() {
  output.write(chalk.dim("─".repeat(output.columns)));
}

function setupActions() {
  State.actions = [];

  if (State.page === "idle") {
    addActions({
      open: {
        shortcut: [ENTER],
        callback: enterProject,
      },
      update: {
        cond: () => !!State.token,
        callback: () => State.toPage("update"),
      },
      view: {
        cond: () => isTask(getSelectedBranch()),
        callback: () => {
          Child.exec(`xdg-open ${clickup.getUrl(getSelectedBranch())}`);
        },
      },
      copy: {
        callback: () => {
          const branch = getSelectedBranch();
          try {
            Child.spawn("xclip", ["-sel", "c"]).stdin.end(branch, () => {
              setTaskStatus(branch, "success", "copied.", 2000);
            });
          } catch (e) {
            setTaskStatus(branch, "error", `unable to copy ${e}`);
          }
        },
      },
      token: {
        cond: () => !State.token,
        callback: () => State.toPage("token"),
      },
      delete: {
        callback: deleteConfirmation,
      },
    });
  } else if (State.page === "update") {
    addActions({
      all: {
        cond: () => !!State.token,
        callback: refetchAll,
      },
      selected: {
        cond: () => !!State.token,
        callback: refetchSelected,
      },
      back: {
        shortcut: [ESC],
        callback: () => State.previousPage(),
      },
    });
  } else if (State.page === "token") {
    addActions({
      "set token": {
        shortcut: [ENTER],
        cond: () => !!State.input,
        callback: updateToken,
      },
      back: {
        shortcut: [ESC],
        callback: () => {
          State.input = "";
          State.previousPage();
        },
      },
      erase: {
        shortcut: [BACKSPACE],
        hidden: true,
        callback: () => {
          State.input = State.input.slice(0, -1);
        },
      },
    });
  } else if (State.page === "delete-worktree") {
    addActions({
      yes: {
        hidden: true,
        callback: deleteSelectedWorktree,
      },
      no: {
        hidden: true,
        callback: () => {
          clearTaskStatus();
          State.toPage("idle");
        },
      },
    });
  } else if (State.page === "delete-branch") {
    addActions({
      yes: {
        hidden: true,
        callback: () => {
          deleteSelectedBranch().then(() => {
            removeSelectedBranchFromList();
            State.toPage("idle");
          });
        },
      },
      no: {
        hidden: true,
        callback: () => {
          clearTaskStatus();
          removeSelectedBranchFromList();
          State.toPage("idle");
        },
      },
    });
  }

  addAction("quit", {
    hidden: true,
    callback: quit,
  });
}

function renderActions() {
  const actions = State.actions
    .filter((action) => {
      if (action.hidden) {
        return false;
      }

      return action.cond ? action.cond() : true;
    })
    .map((action) => {
      const shortcut = action.shortcut.length
        ? action.shortcut.map((key) => KEY_TEXT[key] || key).join("|")
        : action.label[0];
      return [chalk.white.bold(`[${shortcut}]`), chalk.dim(action.label)].join(
        "",
      );
    });

  output.write(`${actions.join(chalk.dim("  "))}`);
  output.write("\n");
}

function renderStatus() {
  if (!State.status || "message" in State.status === false) {
    return;
  }

  const format = getFormatFromType(State.status.type);

  output.write("\n");
  output.write(" " + format(State.status.message));
  output.write("\n");
  output.write("\n");
}

/**
 * @param type {Status['type']
 */
function getFormatFromType(type) {
  return type === "error"
    ? chalk.red
    : type === "success"
      ? chalk.green
      : type === "confirmation"
        ? chalk.blue
        : chalk.dim;
}

function renderBranches() {
  for (let i = 0; i < State.paths.length; i++) {
    const path = State.paths[i];
    const branch = getTaskFromPath(path);
    const status = State.taskStatus[branch];

    if (State.selected === i) {
      output.write(chalk.yellow.bold(` [${branch}]`));
    } else if (State.page.startsWith("delete")) {
      output.write(chalk.dim(`  ${branch} \n`));
      continue;
    } else {
      output.write(`  ${branch} `);
    }

    if (State.tasks.includes(branch) && !status) {
      const description = State.taskNames[branch];

      if (description) {
        output.write(chalk.dim(`\t${description}`));
      } else {
        output.write(chalk.dim(`\tmissing task name`));
      }
    }

    if (status) {
      const format = getFormatFromType(status.type);
      output.write(format(`\t${status.message}`));
    }

    output.write("\n");
  }
}

function loop() {
  console.clear();

  if (State.token) {
    clickup.setToken(State.token);
  }

  setupActions();

  if (!State.token) {
    setStatus("error", "Missing CLICKUP_TOKEN");
  } else if (State.status && State.status.message.includes("CLICKUP_TOKEN")) {
    clearStatus();
  }

  render();
}

function render() {
  renderHeader();

  if (State.page == "token") {
    renderToken();
  } else {
    renderBranches();
    renderHorizontalLine();
    renderStatus();
  }
}

function renderToken() {
  if (State.input) {
    output.write(" " + State.input.replace(/./g, "*"));
  } else {
    output.write(chalk.dim(" Paste or type token..."));
  }
}

/**
 * @param path {string}
 * @returns {string}
 */
function getTaskFromPath(path) {
  return Path.basename(path);
}

/**
 * @returns {string | null}
 */
function getSelectedPath() {
  const path = State.paths[State.selected];
  if (!path) {
    setStatus("error", "Unable to selected path");
    return null;
  }

  return path;
}

function refetchSelected() {
  if (!State.token) {
    State.toPage("token");
    return;
  }

  setStatus("info", "Fetching task information");

  const path = getSelectedPath();
  if (!path) {
    return;
  }

  const taskId = getTaskFromPath(path);
  if (!taskId) {
    setStatus("error", `Unable to get task from path: ${path}`);
    return;
  }

  fetchTaskName(taskId).then(() => {
    setStatus("success", "Successfully updated task", 3000);
  });
}

function refetchAll() {
  refetchTasks(State.tasks);
}

function refetchMissing() {
  const missing = State.tasks.filter((taskId) => !State.taskNames[taskId]);
  refetchTasks(missing);
}

/**
 * @param tasks {string[]}
 */
function refetchTasks(tasks) {
  if (!State.token) {
    State.toPage("token");
    return;
  }

  if (!tasks.length) {
    return;
  }

  setStatus("info", `Fetching information from: ${tasks.join(", ")}`);

  /** @type {Promise[]} */
  const promises = [];

  for (const taskId of tasks) {
    promises.push(fetchTaskName(taskId));
  }

  if (promises.length) {
    Promise.all(promises)
      .then(() => {
        saveTasksFile();
        setStatus("success", "Information updated", 3000);
      })
      .catch(() => setStatus("info", "unable to update tasks", 2000));
  }
}

/**
 * @param taskId {string}
 * @returns {Promise<void>}
 */
async function fetchTaskName(taskId) {
  setTaskStatus(taskId, "info", "fetching task name...");
  try {
    const name = await clickup.getTaskName(taskId);
    State.taskNames[taskId] = name;
    clearTaskStatus(taskId);
  } catch (e) {
    setTaskStatus(taskId, "error", `clickup error: ${e}`);
    throw new Error(e);
  }
}

function saveTokenFile() {
  if (State.token) {
    File.writeFileSync(TOKEN_FILE, State.token);
  }
}

function saveTasksFile() {
  const content = Object.keys(State.taskNames)
    .map((id) => [id, State.taskNames[id]].join(TASKS_FILE_SEPARATOR))
    .join("\n");
  File.writeFileSync(TASKS_FILE, content);
}

/**
 * @param branch {string}
 * @returns {boolean}
 */
function isTask(branch) {
  return (
    /^[\w\d]+$/.test(branch) &&
    ["master", "solo-", "mob-", "fix-", "feat"].find((match) =>
      branch.includes(match),
    ) == null
  );
}

function enterProject() {
  const project = State.paths[State.selected];
  // This hack allow us to cd into the branch folder
  File.writeFileSync("/tmp/gw-last-dir", project);
  console.clear();
  process.exit(0);
}

function setSelectedBasedOnBranch() {
  const branch = Child.execSync(
    "git branch 2>/dev/null | grep '^*' | colrm 1 2",
  )
    .toString("utf8")
    .replace("\n", "");

  if (!branch) {
    State.selected = 0;
    return;
  }

  const index = State.paths.findIndex((path) => path.endsWith(branch));
  State.selected = Math.max(0, index);
}

function selectNext() {
  State.selected = Math.min(State.paths.length - 1, State.selected + 1);
}

function selectPrevious() {
  State.selected = Math.max(0, State.selected - 1);
}

function readToken() {
  State.token = Cache.token.read() || process.env.CLICKUP_TOKEN;
}

class FileStore {
  /**
   * @param {string} filename
   */
  constructor(filename) {
    this._file = Path.join(OS.homedir(), STORE_DIR, filename);

    if (!File.existsSync(this._file)) {
      Child.execSync(`touch ${this._file}`);
    }
  }

  /**
   * @returns {string}
   */
  read() {
    return File.readFileSync(this._file, { encoding: "utf8" }).replace(
      /\n$/,
      "",
    );
  }

  /**
   * @param {string} content
   */
  write(content) {
    File.writeFileSync(this._file, content);
  }
}

const Cache = {
  tasks: new FileStore("tasks"),
  token: new FileStore("token"),
};

function readTasks() {
  const content = Cache.tasks.read();

  for (const line of content.split("\n")) {
    const [id, ...name] = line.split(TASKS_FILE_SEPARATOR);
    if (id) {
      State.taskNames[id] = name.join(TASKS_FILE_SEPARATOR);
    }
  }
}

/**
 * @returns {string | null}
 */
function getSelectedBranch() {
  const path = getSelectedPath();
  return path ? Path.basename(path) : null;
}

function deleteConfirmation() {
  const branch = getSelectedBranch();
  if (!branch) return;
  State.toPage("delete-worktree");
  setTaskStatus(branch, "confirmation", "are you sure? [y] yes | [n] no");
}

function deleteSelectedWorktree() {
  const branch = getSelectedBranch();
  if (!branch) return;

  try {
    setTaskStatus(branch, "info", "removing worktree...");
    Child.execSync(`git worktree remove ${branch}`);
  } catch (e) {
    setTaskStatus(branch, "error", `unable to remove worktree: ${e}`);
    return;
  }

  State.toPage("delete-branch");
  setTaskStatus(
    branch,
    "confirmation",
    "done. delete branch? [y] yes | [n] no",
  );
}

function deleteSelectedBranch() {
  const branch = getSelectedBranch();
  if (!branch) return;

  /** @type {Promise[]} */
  const promises = [
    new Promise(
      (resolve) => {
        Child.exec(`git branch -D ${branch}`, (error) => {
          if (error) {
            setStatus("error", `unable to remove local branch: ${error}`);
            return;
          }

          return resolve();
        });
      },
      new Promise((resolve) => {
        Child.exec(`git push origin :${branch}`, (error) => {
          if (error) {
            setStatus("error", `unable to remove remote branch: ${error}`);
            return;
          }

          return resolve();
        });
      }),
    ),
  ];

  return Promise.all(promises)
    .then(() => {
      setStatus("success", `${branch} successfuly deleted`);
    })
    .catch(() => {
      setStatus("error", `unable to delete branch ${branch}`);
    });
}

function updateToken() {
  State.token = State.input;
  State.input = "";
  State.toPage("idle");
  saveTokenFile();
  refetchMissing();
}

function removeSelectedBranchFromList() {
  const branch = getSelectedBranch();
  if (!branch) return;
  State.paths = State.paths.filter((path) => !path.endsWith(branch));
  updateTaskList();
  selectPrevious();
}

function quit() {
  console.clear();
  if (State.interval) {
    clearInterval(State.interval);
  }

  process.exit(0);
}

input.on("data", (data) => {
  const key = data.toString("utf8");

  if (["update", "idle"].includes(State.page)) {
    if (isDirection("DOWN", key)) {
      selectNext();
    } else if (isDirection("UP", key)) {
      selectPrevious();
    } else if (State.status && key === "c") {
      clearStatus();
    }
  }

  for (const action of State.actions) {
    if (action.cond && !action.cond()) {
      continue;
    }

    if (action.shortcut.includes(key)) {
      action.callback();
      return;
    }
  }

  if (State.page === "token") {
    State.input += key;
  }
});

function main() {
  readToken();
  readTasks();

  Child.exec(
    "git worktree list | rg -v 'bare' | cut -d' ' -f1",
    (error, stdout, stderr) => {
      if (error || stderr) {
        console.clear();
        output.write(stderr);
        process.exit(1);
      }

      const result = stdout.toString("utf8");
      State.paths = result.split("\n").filter(Boolean);
      updateTaskList();
      setSelectedBasedOnBranch();
      loop();

      if (State.token) {
        refetchMissing();
      }

      State.interval = setInterval(() => {
        loop();
      }, 1000 / 60);
    },
  );
}

function updateTaskList() {
  for (const path of State.paths) {
    const taskId = getTaskFromPath(path);

    if (isTask(taskId)) {
      State.tasks.push(taskId);
    }
  }
}

main();
