const OS = require("node:os");
const { stdin: input, stdout: output } = require("node:process");
const Child = require("node:child_process");
const Path = require("node:path");
const File = require("node:fs");
const { default: chalk } = require("chalk");

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

const STORE_DIR = ".local/share/gw-app";

const TASKS_FILE = Path.join(OS.homedir(), STORE_DIR, "tasks");
const TASKS_FILE_SEPARATOR = ":";

const TOKEN_FILE = Path.join(OS.homedir(), STORE_DIR, "token");

input.setRawMode(true);
input.resume();

/**
 * @typedef {{
 *   type: "success" | "error" | "info"
 *   message: string
 * }} Status
 *
 * @typedef {"idle" | "update" | "token"} Mode
 */

const State = {
  /** @type {number | null} */
  interval: null,
  /** @type {Mode} */
  mode: "idle",
  selected: 0,
  /**
   * @type {Status | null}
   */
  status: null,
  /**
   * @type {string | null}
   */
  token: null,
  /** @type {string[]} */
  paths: [],
  /** @type {string[]} */
  tasks: [],
  /** @type {Record<string, string} */
  taskNames: {},
  /** @type {Record<string, Status | null} */
  taskStatus: {},
  input: "",
  /** @type {Mode | null} */
  _lastMode: null,
  /** @param mode {Mode} */
  toMode(mode) {
    this._lastMode = this.mode;
    this.mode = mode;

    if (mode === "token") {
      State.input = "";
    }
  },
  previousMode() {
    const last = this._lastMode;
    if (last) {
      this.toMode(last);
    }
  },
};

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
  State.status = {
    type,
    message,
  };
  if (timeout) {
    setTimeout(clearStatus, timeout);
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
 * @param taskId {string}
 */
function clearTaskStatus(taskId) {
  State.taskStatus[taskId] = null;
}

function renderHeader() {
  const name =
    State.mode === "update"
      ? "Update"
      : State.mode === "token"
        ? "Token"
        : "Worktree";

  const actions =
    State.mode === "idle"
      ? ["[enter|right|l]open"]
      : State.mode === "update"
        ? ["[enter|right|l]open", "[a]ll", "[s]elected", "[b|left|h]ack"]
        : [];

  if (State.mode === "token") {
    if (State.input) {
      actions.push("[enter]set token");
    }

    actions.push("[esc]back");
  } else {
    if (State.mode === "idle") {
      if (State.token) {
        actions.push("[u]pdate");
      } else {
        actions.push("[t]oken");
      }
    }

    if (State.status) {
      actions.push("[c]lear");
    }

    actions.push("[q]uit");
  }

  header = `  ${chalk.bold(name.padEnd(10, " "))}\t${chalk.dim(actions.join(" | "))}`;

  output.write("\n");
  output.write(header);
  output.write("\n");
  output.write(chalk.dim("─".repeat(80)));
  output.write("\n");
}

function renderStatus() {
  output.write(chalk.dim("─".repeat(80)));

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
      : chalk.blue;
}

function renderBranches() {
  for (let i = 0; i < State.paths.length; i++) {
    const path = State.paths[i];
    const branch = getTaskFromPath(path);

    if (State.selected === i) {
      output.write(chalk.yellow.bold(` [${branch}]`));
    } else {
      output.write(`  ${branch} `);
    }

    if (State.tasks.includes(branch)) {
      const description = State.taskNames[branch];
      const status = State.taskStatus[branch];

      if (status) {
        const format = getFormatFromType(status.type);
        output.write(format(`\t${status.message}`));
      } else if (description) {
        output.write(chalk.dim(`\t${description}`));
      } else {
        output.write(chalk.dim(`\tmissing task name`));
      }
    }

    output.write("\n");
  }
}

function render() {
  console.clear();

  if (!State.token) {
    setStatus("error", "Missing CLICKUP_TOKEN");
  } else if (State.status && State.status.message.includes("CLICKUP_TOKEN")) {
    clearStatus();
  }

  renderHeader();

  if (State.mode == "token") {
    renderToken();
  } else {
    renderBranches();
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

function refetchSelected() {
  if (!State.token) {
    State.toMode("token");
    return;
  }

  setStatus("info", "Fetching task information");

  const path = State.paths[State.selected];
  if (!path) {
    setStatus("error", "Unable to selected path");
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
    State.toMode("token");
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
    Promise.all(promises).then(() => {
      saveTasksFile();
      setStatus("success", "Information updated", 3000);
    });
  }
}

/**
 * @param taskId {string}
 * @returns {Promise<void>}
 */
async function fetchTaskName(taskId) {
  setTaskStatus(taskId, "info", "fetching task name...");
  return fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: State.token,
    },
  })
    .then((res) => res.json())
    .then((res) => {
      if (res.err) {
        setTaskStatus(taskId, "error", `Clickup error: ${res.err}`);
        return;
      }

      State.taskNames[taskId] = res.name;
      clearTaskStatus(taskId);
    })
    .catch((error) => setTaskStatus(taskId, "error", error));
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
    return;
  }

  State.selected = Math.max(
    0,
    State.paths.findIndex((path) => path.endsWith(branch)),
  );
}

function readToken() {
  if (File.existsSync(TOKEN_FILE)) {
    State.token = File.readFileSync(TOKEN_FILE, { encoding: "utf8" }).replace(
      "\n",
      "",
    );
  } else {
    State.token = process.env.CLICKUP_TOKEN;
  }
}

function readTasks() {
  if (!File.existsSync(TASKS_FILE)) {
    Child.execSync(
      `mkdir -p ${Path.dirname(TASKS_FILE)} && touch ${TASKS_FILE}`,
    );
    return;
  }

  const content = File.readFileSync(TASKS_FILE, { encoding: "utf8" });

  for (const line of content.split("\n")) {
    const [id, ...name] = line.split(TASKS_FILE_SEPARATOR);
    if (id) {
      State.taskNames[id] = name.join(TASKS_FILE_SEPARATOR);
    }
  }
}

input.on("data", (data) => {
  const key = data.toString("utf8");

  if (key === "q") {
    console.clear();
    if (State.interval) {
      clearInterval(State.interval);
    }

    process.exit(0);
  }

  if (["update", "idle"].includes(State.mode)) {
    if (isDirection("DOWN", key)) {
      State.selected = Math.min(State.paths.length - 1, State.selected + 1);
    } else if (isDirection("UP", key)) {
      State.selected = Math.max(0, State.selected - 1);
    } else if (State.status && key === "c") {
      clearStatus();
    } else if (key === ENTER || isDirection("RIGHT", key)) {
      enterProject();
    }
  }

  if (["update", "token"].includes(State.mode)) {
    if (key == "b" || isDirection("LEFT", key)) {
      State.previousMode();
    }
  }

  if (State.mode === "idle") {
    if (key === "u" && State.token) {
      State.toMode("update");
    } else if (!State.token && key === "t") {
      State.toMode("token");
    }
  } else if (State.mode === "update" && State.token) {
    if (key === "s") {
      refetchSelected();
    } else if (key === "a") {
      refetchAll();
    }
  } else if (State.mode === "token") {
    if (key === ESC) {
      State.previousMode();
      State.input = "";
    } else if (key === BACKSPACE) {
      State.input = State.input.slice(0, -1);
    } else if (key === ENTER && State.input) {
      State.token = State.input;
      State.input = "";
      State.toMode("idle");
      saveTokenFile();
      refetchMissing();
    } else {
      State.input += key;
    }
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

      for (const path of State.paths) {
        const taskId = getTaskFromPath(path);

        if (isTask(taskId)) {
          State.tasks.push(taskId);
        }
      }

      if (State.token) {
        refetchMissing();
      }

      setSelectedBasedOnBranch();
      State.interval = setInterval(() => {
        render();
      }, 1000 / 60);
      render();
    },
  );
}

main();
