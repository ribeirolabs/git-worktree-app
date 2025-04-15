import { basename } from "node:path";

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
