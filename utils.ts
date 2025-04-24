import { basename } from "node:path";
import { stdout } from "node:process";
import sliceAnsi from "slice-ansi";
import chalk from "chalk";

export function getTaskFromPath(path: string): string {
  return basename(path);
}

export function isTask(branch: string): boolean {
  return (
    /^[\w\d]+$/.test(branch) &&
    ["master", "solo-", "mob-", "fix-", "feat"].find((match) =>
      branch.includes(match),
    ) == null
  );
}

const TRUNCATE_CHAR = "…";
export function truncate(text: string, size: number): string {
  const truncated = sliceAnsi(text, 0, size - 1);
  return truncated.length < text.length
    ? truncated + chalk.dim(TRUNCATE_CHAR)
    : text;
}

export function getColumns(): number {
  return stdout.columns - 1;
}

const _running: Record<string, boolean> = {};

export function runOnce(id: string, cb: (resolve: () => void) => void) {
  if (_running[id]) {
    return;
  }
  function resolve() {
    delete _running[id];
  }
  cb(resolve);
}
