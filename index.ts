import { stdin as input, stdout as output } from "node:process";
import { exec, execSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import chalk from "chalk";
import { Clickup } from "./service/clickup.ts";
import { FileStore } from "./service/file-store.ts";
import { App } from "./app.ts";
import { getTaskFromPath, isTask } from "./utils.ts";

const ENTER = "\r";
const ESC = "\u001b";
const BACKSPACE = "\u007f";
const ARROW_UP = "\u001b[A";
const ARROW_DOWN = "\u001b[B";
const ARROW_RIGHT = "\u001b[C";
const ARROW_LEFT = "\u001b[D";

const KEY_TEXT: Record<string, string> = {
  [ENTER]: "enter",
  [ESC]: "esc",
  [ARROW_UP]: "↑",
  [ARROW_DOWN]: "↓",
  [ARROW_LEFT]: "←",
  [ARROW_RIGHT]: "→",
};

const TASKS_FILE_SEPARATOR = ":";

const Cache = {
  tasks: new FileStore("tasks"),
  token: new FileStore("token"),
};

function renderHeader() {
  const name = chalk.bold("🌳");
  const page = App.page !== "idle" ? chalk.dim("/" + App.page) : "";

  output.write("\n");
  output.write(`  ${(name + page).padEnd(20, " ")}`);
  output.write("\t");
  renderActions();
  renderHorizontalLine();
  output.write("\n");
}

function renderHorizontalLine() {
  output.write(chalk.dim("─".repeat(output.columns)));
}

function setupActions() {
  App.actions = [];

  if (App.page === "idle") {
    App.addActions({
      open: {
        shortcut: [ENTER],
        callback: enterProject,
      },
      view: {
        cond: () => isTask(App.getSelectedBranch()),
        callback: () =>
          exec(`xdg-open ${Clickup.getTaskUrl(App.getSelectedBranch())}`),
      },
      "pull request": {
        cond: () => App.getSelectedBranch() !== "master",
        callback: () =>
          exec(
            `gh pr create --web --fill --head ${App.getSelectedBranch()}`,
            (e, _, err) => {
              if (e || err) App.setStatus("error", err);
            },
          ),
      },
      copy: {
        callback: () => {
          const branch = App.getSelectedBranch();
          try {
            spawn("xclip", ["-sel", "c"]).stdin.end(branch, () => {
              App.setTaskStatus(branch, "success", "copied.", 2000);
            });
          } catch (e) {
            App.setTaskStatus(branch, "error", `unable to copy ${e}`);
          }
        },
      },
      update: {
        cond: () => !!App.token,
        callback: () => App.toPage("update"),
      },
      token: {
        cond: () => !App.token,
        callback: () => App.toPage("token"),
      },
      delete: {
        callback: deleteConfirmation,
      },
    });
  } else if (App.page === "update") {
    App.addActions({
      all: {
        cond: () => !!App.token,
        callback: refetchAll,
      },
      selected: {
        cond: () => !!App.token,
        callback: () => refetchSelected().then(() => App.toPage("idle")),
      },
      back: {
        shortcut: [ESC],
        callback: () => App.previousPage(),
      },
    });
  } else if (App.page === "token") {
    App.addActions({
      "set token": {
        shortcut: [ENTER],
        cond: () => !!App.input,
        callback: () => {
          App.token = App.input;
          App.input = "";
          App.toPage("idle");
          saveTokenFile();
          refetchMissing();
        },
      },
      back: {
        shortcut: [ESC],
        callback: () => {
          App.input = "";
          App.previousPage();
        },
      },
      erase: {
        shortcut: [BACKSPACE],
        hidden: true,
        callback: () => {
          App.input = App.input.slice(0, -1);
        },
      },
    });
  } else if (App.page === "delete-worktree") {
    App.addActions({
      yes: {
        hidden: true,
        callback: deleteSelectedWorktree,
      },
      no: {
        hidden: true,
        callback: () => {
          App.clearTaskStatus();
          App.toPage("idle");
        },
      },
    });
  } else if (App.page === "delete-branch") {
    App.addActions({
      yes: {
        hidden: true,
        callback: () => {
          deleteSelectedBranch().then(() => {
            removeSelectedBranchFromList();
            App.toPage("idle");
          });
        },
      },
      no: {
        hidden: true,
        callback: () => {
          removeSelectedBranchFromList();
          App.clearTaskStatus();
          App.toPage("idle");
        },
      },
    });
  }

  App.addActions({
    quit: {
      hidden: true,
      callback: quit,
    },
  });
}

function renderActions() {
  const actions = App.actions
    .filter((action) => {
      if (action.hidden) {
        return false;
      }

      return action.cond ? action.cond() : true;
    })
    .map((action) => {
      const shortcut = action.shortcut
        .map((key) => KEY_TEXT[key] || key)
        .join("|");

      return [chalk.white.bold(`[${shortcut}]`), chalk.dim(action.label)].join(
        "",
      );
    });

  output.write(`${actions.join(chalk.dim("  "))}`);
  output.write("\n");
}

function renderStatus() {
  if (!App.status || "message" in App.status === false) {
    return;
  }

  const format = getFormatFromType(App.status.type);

  output.write("\n");
  output.write("\t\t" + format(App.status.message));
  output.write("\n");
  output.write("\n");
}

function getFormatFromType(type: NonNullable<(typeof App)["status"]>["type"]) {
  return type === "error"
    ? chalk.red
    : type === "success"
      ? chalk.green
      : type === "confirmation"
        ? chalk.blue.bold
        : chalk.dim;
}

function renderBranches() {
  for (let i = 0; i < App.paths.length; i++) {
    const path = App.paths[i];
    const branch = getTaskFromPath(path);
    const status = App.taskStatus[branch];

    if (App.selected === i) {
      output.write(chalk.yellow.bold(` [${branch}]`));
    } else if (App.page.startsWith("delete")) {
      output.write(chalk.dim(`  ${branch} \n`));
      continue;
    } else {
      output.write(`  ${branch} `);
    }

    if (App.tasks.includes(branch) && !status) {
      const description = App.taskNames[branch];

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

  if (App.token) {
    Clickup.setToken(App.token);
  }

  setupActions();

  if (!App.token) {
    App.setStatus("error", "Missing CLICKUP_TOKEN");
  } else if (App.status && App.status.message.includes("CLICKUP_TOKEN")) {
    App.clearStatus();
  }

  render();
}

function render() {
  renderHeader();

  if (App.page == "token") {
    renderToken();
  } else {
    renderBranches();
    renderHorizontalLine();
    renderStatus();
  }

  if (App.debug) {
    output.write("\n" + App.debug);
  }
}

function renderToken() {
  if (App.input) {
    output.write(" " + App.input.replace(/./g, "*"));
  } else {
    output.write(chalk.dim(" paste or type token..."));
  }
}

async function refetchSelected(): Promise<unknown> {
  if (!App.token) {
    App.toPage("token");
    return;
  }

  App.setStatus("info", "fetching task information");

  const taskId = App.getSelectedBranch();

  try {
    await fetchTaskName(taskId);
    saveTasksFile();
    App.setStatus("success", "successfully updated task", 3000);
  } catch (e) {
    App.setStatus("error", "unable updated task", 3000);
  }
}

function refetchAll() {
  refetchTasks(App.tasks);
}

function refetchMissing() {
  const missing = App.tasks.filter((taskId) => !App.taskNames[taskId]);
  refetchTasks(missing);
}

async function refetchTasks(tasks: string[]): Promise<void> {
  if (!App.token) {
    App.toPage("token");
    return;
  }

  if (!tasks.length) {
    return;
  }

  const promises: Promise<unknown>[] = [];

  for (const taskId of tasks) {
    promises.push(fetchTaskName(taskId));
  }

  if (!promises.length) {
    return;
  }

  try {
    App.setStatus("info", `Fetching information from: ${tasks.join(", ")}`);
    await Promise.all(promises);
    saveTasksFile();
    App.setStatus("success", "Information updated", 3000);
  } catch (e) {
    App.setStatus("info", "unable to update tasks", 3000);
  }
}

async function fetchTaskName(taskId: string): Promise<void> {
  App.setTaskStatus(taskId, "info", "fetching task name...");
  try {
    const name = await Clickup.getTaskName(taskId);
    App.taskNames[taskId] = name;
    App.clearTaskStatus(taskId);
  } catch (e: any) {
    App.setTaskStatus(taskId, "error", `clickup error: ${e}`);
    throw new Error(e);
  }
}

function saveTokenFile() {
  if (App.token) {
    Cache.token.write(App.token);
  }
}

function saveTasksFile() {
  const content = Object.keys(App.taskNames)
    .map((id) => [id, App.taskNames[id]].join(TASKS_FILE_SEPARATOR))
    .join("\n");
  Cache.tasks.write(content);
}

function enterProject() {
  const project = App.paths[App.selected];
  // This hack allow us to cd into the branch folder
  writeFileSync("/tmp/gw-last-dir", project);
  console.clear();
  process.exit(0);
}

function setSelectedBasedOnBranch() {
  const branch = execSync("git branch 2>/dev/null | grep '^*' | colrm 1 2")
    .toString("utf8")
    .replace("\n", "");

  if (!branch) {
    App.selected = 0;
    return;
  }

  const index = App.paths.findIndex((path) => path.endsWith(branch));
  App.selected = Math.max(0, index);
}

function readToken() {
  const token = Cache.token.read() || process.env.CLICKUP_TOKEN;
  if (token) {
    App.token = token;
  }
}

function readTasks() {
  const content = Cache.tasks.read();

  for (const line of content.split("\n")) {
    const [id, ...name] = line.split(TASKS_FILE_SEPARATOR);
    if (id) {
      App.taskNames[id] = name.join(TASKS_FILE_SEPARATOR);
    }
  }
}

function deleteConfirmation() {
  const branch = App.getSelectedBranch();
  App.toPage("delete-worktree");
  App.setTaskStatus(
    branch,
    "confirmation",
    `are you sure? [y]${chalk.dim("yes")} | [n]${chalk.dim("no")}`,
  );
}

function deleteSelectedWorktree() {
  const branch = App.getSelectedBranch();

  try {
    App.setTaskStatus(branch, "info", "removing worktree...");
    execSync(`git worktree remove ${branch}`);
  } catch (e) {
    App.setTaskStatus(branch, "error", `unable to remove worktree: ${e}`);
    return;
  }

  App.toPage("delete-branch");
  App.setTaskStatus(
    branch,
    "confirmation",
    "done. delete branch? [y] yes | [n] no",
  );
}

async function deleteSelectedBranch() {
  const branch = App.getSelectedBranch();

  const promises: Promise<void>[] = [
    new Promise((resolve) => {
      exec(`git branch -D ${branch}`, (error) => {
        if (error) {
          App.setStatus("error", `unable to remove local branch: ${error}`);
          return;
        }

        return resolve();
      });
    }),
    new Promise((resolve) => {
      exec(`git push origin :${branch}`, (error) => {
        if (error) {
          App.setStatus("error", `unable to remove remote branch: ${error}`);
          return;
        }

        return resolve();
      });
    }),
  ];

  try {
    await Promise.all(promises);
    App.setStatus("success", `${branch} successfuly deleted`);
  } catch (e) {
    App.setStatus("error", `unable to delete branch ${branch}`);
  }
}

function removeSelectedBranchFromList() {
  const branch = App.getSelectedBranch();
  App.setPaths(App.paths.filter((path) => !path.endsWith(branch)));
  App.selectPrevious();
}

function quit() {
  console.clear();
  if (App.interval) {
    clearInterval(App.interval);
  }

  process.exit(0);
}

input.setRawMode(true);
input.resume();
input.on("data", (data) => {
  const key = data.toString("utf8");

  if (["update", "idle"].includes(App.page)) {
    if (key === "j") {
      App.selectNext();
    } else if (key === "k") {
      App.selectPrevious();
    } else if (App.status && key === "c") {
      App.clearStatus();
    }
  }

  for (const action of App.actions) {
    if (action.cond && !action.cond()) {
      continue;
    }

    if (action.shortcut.includes(key)) {
      action.callback();
      return;
    }
  }

  if (App.page === "token") {
    App.input += key;
  }
});

const DISABLE_LOOP = false;

function main() {
  readToken();
  readTasks();

  exec(
    "git worktree list | rg -v 'bare' | cut -d' ' -f1",
    (error, stdout, stderr) => {
      if (error || stderr) {
        console.clear();
        output.write(stderr);
        process.exit(1);
      }

      const result = stdout.toString();
      App.setPaths(result.split("\n").filter(Boolean));
      setSelectedBasedOnBranch();
      loop();

      if (App.token) {
        refetchMissing();
      }

      if (!DISABLE_LOOP) {
        App.interval = setInterval(() => {
          loop();
        }, 1000 / 60);
      }
    },
  );
}

main();
