import { stdout } from "node:process";
import stripAnsi from "strip-ansi";
import { getColumns, truncate } from "./utils.ts";
import chalk from "chalk";

type Child = {
  text: string;
  align?: "start" | "end";
  hidden?: boolean;
  size?: number;
};

function calculateRowSizes(initialSizes: number[]) {
  const empty: number[] = [];
  const sizes = [...initialSizes];
  let total = 0;
  for (let i = 0; i < initialSizes.length; i++) {
    const size = sizes[i];
    if (size) {
      total += size;
    } else {
      empty.push(i);
    }
  }
  const rest = Math.floor((getColumns() - total) / empty.length);

  for (const i of empty) {
    sizes[i] = rest;
  }

  return sizes;
}

type RenderOptions = {
  mode?: "truncate" | "wrap" | "responsive";
  paddingX?: number;
};

export function renderRow(
  children: Child[],
  { mode = "wrap" }: RenderOptions = {},
): void {
  const sizes = calculateRowSizes(children.map((child) => child.size ?? 0));
  let sizeCount = 0;
  for (let i = 0; i < children.length; i++) {
    const size = sizes[i];
    const child = children[i];
    const text = child.text;
    const align = child.align ?? "start";
    const textSize = stripAnsi(text).length;

    if (child.hidden) {
      continue;
    }

    if (textSize > size) {
      if (mode === "truncate") {
        stdout.write(truncate(text, size));
      } else if (mode === "responsive") {
        stdout.write("\n" + text);
      } else {
        stdout.write(chalk.bgGray(text));
      }
    } else if (textSize < size) {
      const pad = " ".repeat(size - textSize);
      stdout.write(align === "start" ? text + pad : pad + text);
    } else {
      stdout.write(text);
    }

    sizeCount += size ?? 0;
  }

  stdout.write("\n");
}
