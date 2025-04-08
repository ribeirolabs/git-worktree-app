const { stdin: input, stdout: output } = require("node:process");
const Child = require("node:child_process");
const Path = require("node:path");
const File = require("node:fs");
const { default: chalk } = require("chalk");

const ENTER = "\r";
const ESC = "\u001b";
const BACKSPACE = "\u007f";

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
      ? ["[enter]open"]
      : State.mode === "update"
        ? ["[enter]open", "[a]ll", "[s]elected", "[b]ack"]
        : [];

  if (State.mode === "token") {
    if (State.input) {
      actions.push("[enter]set token");
    }

    actions.push("[esc]back");
  } else {
    if (State.mode === "idle") {
      if (State.token) {
        actions.push("[u]update");
      } else {
        actions.push("[t]oken");
      }
    }

    if (State.status) {
      actions.push("[c]lear");
    }

    actions.push("[q]uit");
  }

  header = ` ${chalk.bold(name.padEnd(10, " "))}${chalk.dim(actions.join(" | "))}`;

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
      output.write(chalk.bold(`[${branch}]`));
    } else {
      output.write(` ${branch} `);
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
  if (!State.token) {
    State.toMode("token");
    return;
  }

  setStatus("info", `Fetching information from: ${State.tasks.join(", ")}`);

  /** @type {Promise[]} */
  const promises = [];

  for (const taskId of State.tasks) {
    promises.push(fetchTaskName(taskId));
  }

  Promise.all(promises).then(() => {
    setStatus("success", "Information updated", 3000);
  });
}

/**
 * @param taskId {string}
 * @returns {Promise<void>}
 */
function fetchTaskName(taskId) {
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
      writeTaskName(taskId, res.name);
      clearTaskStatus(taskId);
    })
    .catch((error) => setTaskStatus(taskId, "error", error));
}

/**
 * @param id {string}
 * @param name {string}
 */
function writeTaskName(id, name) {
  File.writeFileSync(getTaskNameFile(id), name);
}

function setTaskNameOrFetch(taskId) {
  const taskNameFile = getTaskNameFile(taskId);

  if (File.existsSync(taskNameFile)) {
    const name = File.readFileSync(taskNameFile, {
      encoding: "utf8",
    });
    State.taskNames[taskId] = name.replace("\n", "");
  } else if (State.token) {
    fetchTaskName(taskId);
  }
}

/**
 * @param id {string}
 * @returns {string}
 */
function getTaskNameFile(id) {
  return Path.join("/tmp/gw-tasks", id);
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
    if (key === "j") {
      State.selected = Math.min(State.paths.length - 1, State.selected + 1);
    } else if (key === "k") {
      State.selected = Math.max(0, State.selected - 1);
    } else if (State.status && State.status.type === "error" && key === "c") {
      clearStatus();
    }
  }

  if (["update", "token"].includes(State.mode)) {
    if (key == "b") {
      State.previousMode();
    }
  }

  if (State.mode === "idle") {
    if (key === "u" && State.token) {
      State.toMode("update");
    } else if (!State.token && key === "t") {
      State.toMode("token");
    } else if (key === ENTER) {
      enterProject();
    }
  } else if (State.mode === "update" && State.token) {
    if (key === "s") {
      refetchSelected();
    } else if (key === "a") {
      refetchAll();
    } else if (key === ENTER) {
      enterProject();
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
      State.previousMode();
    } else {
      State.input += key;
    }
  }
});

function main() {
  State.token = process.env.CLICKUP_TOKEN;

  Child.exec("mkdir -p /tmp/gw-tasks");
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
          setTaskNameOrFetch(taskId);
        }
      }

      setSelectedBasedOnBranch();
      State.interval = setInterval(() => {
        render();
      }, 100);
    },
  );
}

render();
main();
