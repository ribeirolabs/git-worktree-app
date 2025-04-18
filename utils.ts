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

const TRUNCATE_CHAR = "…";
export function truncate(text: string, size: number): string {
  const truncated = text.slice(0, size - 1);
  return truncated.length < text.length ? truncated + TRUNCATE_CHAR : text;
}
