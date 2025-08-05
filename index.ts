import { stdin as input, stdout as output } from "node:process";
import { exec, execSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import yaml from "yaml";
import { Clickup } from "./service/clickup.ts";
import { FileStore } from "./service/file-store.ts";
import { App, TaskSchema } from "./app.ts";
import { getTaskFromPath, isTask, runOnce } from "./utils.ts";
import { renderRow } from "./layout.ts";
import { Form } from "./ui/form.ts";
import { Keys } from "./keys.ts";
import { Files } from "./files.ts";
import { loadOrFetchStatuses } from "./model/status.ts";
import { setTimeout } from "node:timers/promises";

const HIDE_CURSOR = "\u001B[?25l";
const SHOW_CURSOR = "\u001B[?25h";

const KEY_TEXT: Record<string, string> = {
  [Keys.ENTER]: "enter",
  [Keys.ESC]: "esc",
  [Keys.ARROW_UP]: "↑",
  [Keys.ARROW_DOWN]: "↓",
  [Keys.ARROW_LEFT]: "←",
  [Keys.ARROW_RIGHT]: "→",
};

const SearchForm = new Form.Container();
const SearchInput = new Form.Input().setName("search").setSize(30);

function renderHeader() {
  const name = chalk.bold("Worktree");
  const page = App.page !== "idle" ? chalk.dim("/" + App.page) : "";

  renderRow([{ text: " " + name + page, size: 30 }]);

  renderRow([
    {
      text: " " + getActions(),
      hidden: App.page.includes("delete-"),
    },
  ]);

  renderHorizontalLine();
  output.write("\n");
}

function renderHorizontalLine() {
  output.write(chalk.dim.gray("─".repeat(output.columns)));
}

function setupActions() {
  const searching = App.mode === "search";

  App.setupActions({
    idle: {
      add: {
        disabled: () => searching,
        callback: () => App.toPage("add"),
      },
      delete: {
        disabled: () => searching,
        callback: deleteConfirmation,
      },
      copy: {
        disabled: () => searching,
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
      open: {
        hidden: true,
        shortcut: Keys.ENTER,
        callback: () => {
          if (App.mode === "search") {
            const selected = App.filteredPaths[App.selected];
            SearchForm.clear();
            App.selected = App.paths.indexOf(selected);
            App.filteredPaths = App.paths;
            App.mode = "idle";
          } else {
            enterProject();
          }
        },
      },
      "pull request": {
        disabled: () => {
          if (searching) {
            return true;
          }
          const branch = App.getSelectedBranch();
          return branch === "master" || isTask(branch);
        },
        callback: () =>
          exec(
            `gh pr create --web --fill --head ${App.getSelectedBranch()}`,
            (e, _, err) => {
              if (e || err) App.setStatus("error", err);
            },
          ),
      },
      view: {
        disabled: () => searching || !isTask(App.getSelectedBranch()),
        callback: () =>
          exec(`open ${Clickup.getTaskUrl(App.getSelectedBranch())}`),
      },
      update: {
        hidden: !App.token,
        disabled: () => searching || !App.token,
        callback: () => App.toPage("update"),
      },
      edit: {
        hidden: !App.token,
        disabled: () =>
          searching || !App.token || !isTask(App.getSelectedBranch()),
        callback: () => App.toPage("edit-task"),
      },
      token: {
        hidden: !!App.token,
        disabled: () => searching || !!App.token,
        callback: () => App.toPage("token"),
      },
      back: {
        shortcut: Keys.ESC,
        hidden: true,
        callback: () => {
          if (App.mode === "search") {
            SearchForm.clear();
            App.mode = "idle";
          }
        },
      },
      "/": {
        hidden: true,
        disabled: () => searching,
        callback: () => (App.mode = "search"),
      },
    },
    update: {
      all: {
        disabled: () => !App.token,
        callback: () => refetchAll().then(() => App.toPage("idle")),
      },
      selected: {
        disabled: () => !App.token || !isTask(App.getSelectedBranch()),
        callback: () => refetchSelected().then(() => App.toPage("idle")),
      },
      back: {
        shortcut: Keys.ESC,
        callback: () => App.previousPage(),
      },
    },
    token: {
      "set token": {
        shortcut: Keys.ENTER,
        disabled: () => !TokenForm.value["token"],
        callback: () => {
          App.token = TokenForm.value["token"] as string;
          App.toPage("idle");
          TokenForm.reset();
          saveTokenFile();
          refetchMissing();
        },
      },
      back: {
        shortcut: Keys.ESC,
        callback: () => {
          TokenForm.reset();
          App.previousPage();
        },
      },
    },
    "delete-worktree": {
      yes: {
        callback: deleteSelectedWorktree,
      },
      no: {
        callback: () => {
          App.clearTaskStatus();
          App.toPage("idle");
        },
      },
    },
    "delete-branch": {
      yes: {
        callback: () => {
          deleteSelectedBranch()
            .then(() => {
              removeSelectedBranchFromList();
            })
            .finally(() => {
              App.toPage("idle");
            });
        },
      },
      no: {
        callback: () => {
          const branch = App.getSelectedBranch();
          removeSelectedBranchFromList();
          App.setStatus(
            "success",
            `worktree [${branch}] successfully deleted`,
            3000,
          );
          App.clearTaskStatus();
          App.toPage("idle");
        },
      },
    },
    add: {
      create: {
        shortcut: Keys.ENTER,
        disabled: () => !AddForm.isValid(),
        callback: () => {
          const branch = AddForm.value.branch as string;
          const path = (AddForm.value.path || branch) as string;
          const commit = (AddForm.value.commit || branch) as string;

          const errorLog = new FileStore("error-log");

          App.setStatus("info", `adding worktree ${branch}...`);

          try {
            const isInsideWorktree = execSync(
              "git rev-parse --is-inside-work-tree",
            )
              .toString("utf8")
              .startsWith("true");

            execSync("git fetch --all");

            execSync(
              [
                "git worktree add",
                AddForm.value.create ? `-b ${branch} ` : "",
                (isInsideWorktree ? "../" : "") + path,
                AddForm.value.create
                  ? commit !== branch
                    ? `origin/${commit}`
                    : ""
                  : commit,
              ].join(" "),
            );
            App.setStatus("success", `worktree ${branch} added`, 3000);
            App.setPaths(App.paths.concat(dirname(App.paths[0]) + "/" + path));
            if (isTask(path)) {
              refetchTasks([path]);
            }
            AddForm.reset();
            App.toPage("idle");
          } catch (e: any) {
            errorLog.append(e);
            App.setStatus("error", `[worktree-add]: ${e}`);
            App.toPage("idle");
          }
        },
      },
      back: {
        shortcut: Keys.ESC,
        callback: () => {
          AddForm.reset();
          App.toPage("idle");
        },
      },
    },
    "edit-task": {
      update: {
        shortcut: Keys.ENTER,
        disabled: () => !UpdateStatus.Form.value.status,
        callback: () => {
          const task = App.tasks[App.getSelectedBranch()];
          if (!task) return;

          const status = UpdateStatus.Status.getSelectedOption();
          if (!status) return;

          App.setStatus("info", "updating task...");
          Clickup.updateTask({
            id: task.id,
            status: status.label,
          })
            .then(() => {
              App.tasks[task.id] = {
                ...task,
                status,
              };
              saveTasksFile();
              App.setStatus("success", "task updated!", 3000);
            })
            .catch((e) => {
              App.setStatus("error", `unable to update task: ${e}`);
            });
        },
      },
      back: {
        shortcut: Keys.ESC,
        callback: () => {
          UpdateStatus.Form.reset();
          App.toPage("idle");
        },
      },
    },
  });

  App.addActions({
    quit: {
      hidden: true,
      disabled: () => AddForm.hasFocus(),
      callback: quit,
    },
  });
}

function getActions() {
  const actions = App.actions
    .filter((action) => {
      if (action.hidden) {
        return false;
      }

      return true;
    })
    .map((action) => {
      const shortcut = KEY_TEXT[action.shortcut] || action.shortcut;
      const disabled = action.disabled?.() === true;

      return [
        (disabled ? chalk.dim.gray : chalk.white.bold)(`[${shortcut}]`),
        (disabled ? chalk.dim.gray : chalk.dim)(action.label),
      ].join("");
    });

  return actions.join(chalk.dim("  "));
}

function renderStatus() {
  if (App.mode === "search") {
    SearchForm.add(SearchInput).update().render();
    return;
  }

  if (!App.status || "message" in App.status === false) {
    return;
  }

  const format = getFormatFromType(App.status.type);

  output.write("\n");
  output.write(" " + format(App.status.message));
  output.write("\n");
  output.write("\n");
}

function getFormatFromType(type: NonNullable<(typeof App)["status"]>["type"]) {
  return type === "error"
    ? chalk.red
    : type === "success"
      ? chalk.green
      : type === "confirmation"
        ? chalk.blue.yellow
        : chalk.dim;
}

function renderBranches() {
  const search = SearchForm.value.search as string;

  App.filteredPaths = App.paths;

  if (search) {
    App.selected = 0;
    App.filteredPaths = App.paths.filter((path) =>
      getTaskFromPath(path).includes(search),
    );
  }

  for (let i = 0; i < App.filteredPaths.length; i++) {
    const path = App.filteredPaths[i];
    const branch = getTaskFromPath(path);
    const status = App.taskStatus[branch];
    const task = App.tasks[branch];

    const isDeleting = App.page.startsWith("delete");
    const isSelected = App.selected === i;

    const branchText = isSelected
      ? chalk.yellow(`[${branch}]`)
      : isDeleting
        ? chalk.dim(` ${branch} `)
        : ` ${branch} `;

    let nameText = "";
    if (status) {
      const format = getFormatFromType(status.type);
      nameText = format(`${status.message}`);

      if (isSelected && status.type === "confirmation") {
        nameText += " " + getActions();
      }
    } else if (task) {
      nameText = task.name ? `${task.name}` : chalk.dim(`missing name`);
    }

    renderRow(
      [
        { text: branchText, size: 30 },
        {
          text: nameText,
          hidden: isDeleting && !isSelected,
          align: "start",
        },
      ],
      {
        mode: "truncate",
      },
    );

    if (task) {
      renderRow([
        { text: "", size: 30 },
        {
          text: chalk.dim(task.status.label),
          hidden: !task || isDeleting,
        },
      ]);
    }
  }
}

function loop() {
  console.clear();

  // Update key states at the beginning of each frame
  App.updateKeyStates();

  if (App.token) {
    Clickup.setToken(App.token);
  }

  setupActions();

  if (!App.token) {
    App.setStatus("error", "Missing CLICKUP_TOKEN");
  } else if (App.status?.message?.includes("CLICKUP_TOKEN")) {
    App.clearStatus();
  }

  render();
}

const TokenForm = new Form.Container();
const TokenInput = new Form.Input()
  .setName("token")
  .setSize(30)
  .setSecret(true);

function renderToken() {
  TokenForm.add(TokenInput).update().render();
}

const AddForm = new Form.Container();
const branchInput = new Form.Input().setName("branch").setSize(15);
const pathInput = new Form.Input().setName("path").setSize(15);
const commitInput = new Form.Input().setName("commit").setSize(15);
const createCheckbox = new Form.Checkbox().setName("create");

function renderAdd() {
  AddForm.add(branchInput, { newLine: false })
    .add(createCheckbox)
    .add(pathInput)
    .add(commitInput)
    .update();

  pathInput.placeholder = branchInput.value;
  commitInput.placeholder = branchInput.value;

  if (App.paths.map(getTaskFromPath).includes(branchInput.value)) {
    branchInput.setInvalid();
    App.setStatus("error", "worktree already exists");
  } else {
    branchInput.setValid();
  }

  AddForm.render();
}

const UpdateStatus = {
  Form: new Form.Container(),
  Status: new Form.Select().setName("status").setMinSize(20),
  Done: new Form.Checkbox().setName("done"),
};

function renderEditTask() {
  const task = App.tasks[App.getSelectedBranch()];

  if (!task) {
    App.toPage("idle");
    return;
  }

  if (!UpdateStatus.Status.options.length) {
    runOnce("load-statuses", (resolve) => {
      loadOrFetchStatuses(task.list.id)
        .then((statuses) => {
          App.clearStatus();
          UpdateStatus.Status.setOptions(statuses);
          // UpdateStatus.Form.value.status = task.status.id;
          UpdateStatus.Form.initialValue.status = task.status.id;
        })
        .catch((e) => {
          App.setStatus("error", e);
        })
        .finally(resolve);
    });
  }

  output.write(chalk.yellow(` ▓ ${task.name}\n`));
  output.write(
    ` ${chalk.yellow("▓")} ${task.id}  ${chalk.dim(task.status.label)}\n`,
  );
  renderHorizontalLine();

  UpdateStatus.Form.add(UpdateStatus.Status, { newLine: false })
    .add(UpdateStatus.Done)
    .update()
    .render();
}

function render() {
  renderHeader();

  if (App.page === "token") {
    renderToken();
  } else if (App.page === "add") {
    renderAdd();
  } else if (App.page === "edit-task") {
    renderEditTask();
  } else {
    renderBranches();
    renderHorizontalLine();
  }
  renderStatus();

  if (App.debug) {
    output.write("\n" + App.debug);
  }

  output.write(HIDE_CURSOR);
}

async function refetchSelected(): Promise<unknown> {
  if (!App.token) {
    App.toPage("token");
    return;
  }

  App.setStatus("info", "fetching task information...");

  const taskId = App.getSelectedBranch();

  try {
    await fetchTask(taskId);
    saveTasksFile();
    App.setStatus("success", "successfully updated task", 3000);
  } catch (e) {
    App.setStatus("error", "unable updated task", 3000);
  }
}

function refetchAll() {
  return refetchTasks(App.taskIds);
}

function refetchMissing() {
  const missing = App.taskIds.filter((taskId) => !App.tasks[taskId]?.name);
  return refetchTasks(missing);
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
    promises.push(fetchTask(taskId));
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

async function fetchTask(taskId: string): Promise<void> {
  App.setTaskStatus(taskId, "info", "fetching task information...");
  try {
    const task = await Clickup.getTask(taskId);
    App.tasks[taskId] = task;
    App.clearTaskStatus(taskId);
  } catch (e: any) {
    App.setTaskStatus(taskId, "error", `clickup error: ${e}`);
    throw new Error(e);
  }
}

function saveTokenFile() {
  if (App.token) {
    Files.token.write(App.token);
  }
}

function saveTasksFile() {
  const content = yaml.stringify(Object.values(App.tasks));
  Files.tasks.write(content);
}

function enterProject() {
  const project = App.paths[App.selected];
  // This hack allow us to cd into the branch folder
  writeFileSync("/tmp/gw-last-dir", project);
  quit();
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
  const token = Files.token.read() || process.env.CLICKUP_TOKEN;
  if (token) {
    App.token = token;
  }
}

function readTasks() {
  const content = yaml.parse(Files.tasks.read());
  if (!content) {
    return;
  }

  for (const entity of content) {
    const task = TaskSchema.safeParse(entity);
    if (!task.success) {
      continue;
    }
    App.tasks[task.data.id] = task.data;
  }
}

function deleteConfirmation() {
  const branch = App.getSelectedBranch();
  App.toPage("delete-worktree");
  App.setTaskStatus(branch, "confirmation", "are you sure?");
}

async function deleteSelectedWorktree() {
  const branch = App.getSelectedBranch();

  try {
    App.setTaskStatus(branch, "info", "deleting worktree...");
    await setTimeout(250);
    execSync(`git worktree remove ${branch}`);

    App.toPage("delete-branch");
    App.setStatus("success", "worktree deleted", 3000);
    App.setTaskStatus(branch, "confirmation", "delete branch?");
  } catch (e) {
    App.setTaskStatus(branch, "error", `unable to delete worktree: ${e}`);
    App.toPage("idle");
    return;
  }
}

async function deleteSelectedBranch() {
  const branch = App.getSelectedBranch();

  App.setTaskStatus(branch, "info", "deleting branch...");
  const promises: Promise<void>[] = [
    new Promise((resolve, reject) => {
      exec(`git branch -D ${branch}`, (error) => {
        if (error) {
          App.setStatus("error", `unable to delete local branch: ${error}`);
          return reject();
        }

        return resolve();
      });
    }),
    new Promise((resolve, reject) => {
      exec(`git push origin :${branch}`, (error) => {
        if (error) {
          App.setStatus("error", `unable to delete remote branch: ${error}`);
          return reject();
        }

        return resolve();
      });
    }),
  ];

  try {
    await Promise.all(promises);
    App.setStatus("success", `branch [${branch}] successfuly deleted`, 3000);
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
  output.write(SHOW_CURSOR);

  if (App.interval) {
    clearInterval(App.interval);
  }

  process.exit(0);
}

input.setRawMode(true);
input.resume();
// Track key down events
input.on("data", (data) => {
  const key = data.toString("utf8");

  // Set the key state to pressed
  App.setKeyState(key, true);

  // Handle immediate key actions
  if (["update", "idle"].includes(App.page) && App.mode !== "search") {
    if (key === "j" || key === Keys.ARROW_DOWN) {
      App.selectNext();
    } else if (key === "k" || key === Keys.ARROW_UP) {
      App.selectPrevious();
    } else if (App.status && key === "c") {
      App.clearStatus();
    } else if (key === "K" || key === Keys.SHIFT_ARROW_UP) {
      App.selectFirst();
    } else if (key === "J" || key === Keys.SHIFT_ARROW_DOWN) {
      App.selectLast();
    }
  }

  for (const action of App.actions) {
    if (action.disabled && action.disabled()) {
      continue;
    }

    if (action.shortcut.includes(key)) {
      App.consumeKey(key, action.callback);
      return;
    }
  }

  // Simulate key release after a short delay
  // This is needed because Node.js doesn't provide keyup events in raw mode
  setTimeout(100).then(() => {
    App.setKeyState(key, false);
  }); // 100ms is a reasonable time for most key presses
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

      if (DISABLE_LOOP) {
        return;
      }

      App.interval = setInterval(() => {
        loop();
      }, 1000 / 24);
    },
  );
}

global.onunhandledrejection = (event) => {
  Files.error.append("[unhandled-error]" + event.reason);
  quit();
};

main();
