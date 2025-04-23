import { stdout as output } from "node:process";
import chalk from "chalk";
import stripAnsi from "strip-ansi";
import { App } from "../app.ts";
import { Keys } from "../keys.ts";

class FormElement<T> {
  focused = false;
  name = "";
  size = 0;
  valid = true;

  setName(name: string): this {
    this.name = name;
    return this;
  }

  focus(): this {
    this.focused = true;
    return this;
  }

  blur(): this {
    this.focused = false;
    return this;
  }

  setSize(size: number): this {
    this.size = size;
    return this;
  }

  setInvalid(): this {
    this.valid = false;
    return this;
  }

  setValid(): this {
    this.valid = true;
    return this;
  }

  render(): void {}
  update(): void {}
  setValue(value: T): void {}
}

class Input extends FormElement<string> {
  editing = false;
  placeholder = "";
  value = "";
  secret = false;

  setPlaceholder(placeholder: string): this {
    this.placeholder = placeholder;
    return this;
  }

  setSecret(secret: boolean): this {
    this.secret = secret;
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  render() {
    const value = this.value
      ? this.secret
        ? this.value.replace(/./g, "*")
        : this.value
      : chalk.dim(this.placeholder);
    const valueSize = stripAnsi(value).length;
    const size = Math.max(this.size, valueSize);
    const content = "[" + value + " ".repeat(size - valueSize) + "]";
    output.write(this.name + ": ");
    const format = this.focused
      ? this.valid
        ? chalk.bgWhite.black
        : chalk.bgRed.white
      : this.valid
        ? chalk
        : chalk.red;
    output.write(format(content));
  }
}

class Checkbox extends FormElement<boolean> {
  value = false;
  size = 3;

  toggle(): this {
    this.setValue(!this.value);
    return this;
  }

  update(): void {}

  setValue(value: boolean): void {
    this.value = value;
  }

  render(): void {
    const content = "[" + (this.value ? "YES" : "NO ") + "]";
    output.write(this.name + ": ");
    output.write(this.focused ? chalk.bgWhite.black(content) : content);
  }
}

class Container {
  elements: FormElement<string | boolean>[] = [];
  focused = 0;
  breaks: Record<string, boolean> = {};
  value: Record<string, string | boolean> = {};
  initialValue: Record<string, string | boolean> = {};

  hasFocus(): boolean {
    return !!this.elements[this.focused];
  }

  add(
    element: FormElement<string | boolean>,
    { newLine = true }: { newLine?: boolean } = {},
  ): this {
    if (this.elements.find((el) => el.name === element.name)) {
      return this;
    }
    this.elements.push(element);
    this.value[element.name] = element instanceof Checkbox ? false : "";
    this.initialValue = { ...this.value };
    if (newLine) {
      this.breaks[this.elements.length - 1] = true;
    }
    return this;
  }

  focusNext(): this {
    this.focused = Math.min(this.focused + 1, this.elements.length - 1);
    return this;
  }

  focusPrevious(): this {
    this.focused = Math.max(0, this.focused - 1);
    return this;
  }

  clear(): this {
    this.value = { ...this.initialValue };
    return this;
  }

  reset(): this {
    this.clear();
    this.elements = [];
    return this;
  }

  isValid(): boolean {
    for (const element of this.elements) {
      if (!element.valid) {
        return false;
      }
    }

    return true;
  }

  update(): this {
    const focused = this.elements[this.focused];

    App.consumeKey(Keys.TAB, () => this.focusNext());
    App.consumeKey(Keys.SHIFT_TAB, () => this.focusPrevious());

    if (focused instanceof Checkbox) {
      App.consumeKey(Keys.SPACE, () => {
        this.value[focused.name] = !this.value[focused.name];
      });
    } else if (focused instanceof Input) {
      App.consumeAnyKey((key) => {
        if (/[\w -/]/.test(key)) {
          this.value[focused.name] += key;
        } else if (key === Keys.BACKSPACE) {
          this.value[focused.name] = (this.value[focused.name] as string).slice(
            0,
            -1,
          );
        }
      });
    }

    for (const element of this.elements) {
      element.setValue(this.value[element.name]);
    }

    return this;
  }

  render(): void {
    let size = 1;

    for (const element of this.elements) {
      const nameSize = stripAnsi(element.name).length;
      if (nameSize > size) {
        size = nameSize;
      }
    }

    // output.write(chalk.grey.dim(` ┌${"─".repeat(size)}┐\n`));
    // output.write(chalk.grey.dim(` │ `));

    for (let i = 0; i < this.elements.length; i++) {
      const element = this.elements[i];

      if (this.focused === i) {
        element.focus();
      } else {
        element.blur();
      }

      const nameSize = stripAnsi(element.name).length;
      output.write(" ".repeat(size + 1 - nameSize));

      element.render();
      if (this.breaks[i]) {
        output.write("\n");
      }
    }
    // output.write(chalk.grey.dim(` │ `));
    // output.write("\n");
    // output.write(chalk.grey.dim(` └${"─".repeat(size)}┘\n`));
  }
}

export const Form = {
  Container,
  Input,
  Checkbox,
};
