import { stdout as output } from "node:process";
import chalk from "chalk";
import stripAnsi from "strip-ansi";
import { App } from "../app.ts";
import { Keys } from "../keys.ts";

class FormElement<T> {
  focused = false;
  name = "";
  // @ts-ignore
  value: T = "";
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
  setValue(value: T): void {
    this.value = value;
  }
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

    const content =
      (this.focused ? " " : "[") +
      value +
      " ".repeat(size - valueSize) +
      (this.focused ? " " : "]");

    output.write(this.name + ":");

    const format = this.focused
      ? this.valid
        ? chalk.bgWhite.black
        : chalk.bgRed.whiteBright
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
    const content =
      (this.focused ? " " : "[") +
      (this.value ? "YES" : "NO ") +
      (this.focused ? " " : "]");
    output.write(this.name + ": ");
    output.write(this.focused ? chalk.bgWhite.black(content) : content);
  }
}

class Container {
  elements: FormElement<string | boolean>[] = [];
  focused = 0;
  breaks: Record<string, boolean> = {};
  value: Record<string, string | boolean> = {};

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
    if (element.name in this.value === false) {
      this.value[element.name] = element instanceof Checkbox ? false : "";
    }
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
    this.value = {};
    return this;
  }

  reset(): this {
    this.elements = [];
    this.focused = 0;
    return this.clear().update();
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

    const _getValue = () => this.value[focused.name];
    const _setValue = (value: any) => {
      this.value[focused.name] = value;
    };

    if (focused instanceof Checkbox) {
      App.consumeKey(Keys.SPACE, () => {
        _setValue(!_getValue());
      });
    } else if (focused instanceof Input) {
      App.consumeAnyKey((key) => {
        if (/[\w -/]/.test(key)) {
          _setValue(_getValue() + key);
        } else if (key === Keys.BACKSPACE) {
          _setValue((_getValue() as string).slice(0, -1));
        }
      });
    } else if (focused instanceof Select) {
      if (!_getValue()) {
        _setValue(focused.options[0]?.id ?? "");
      }

      if (!focused.options.length) {
        return this;
      }

      App.consumeKey("j", () => {
        const nextIndex = Math.min(
          focused.options.length - 1,
          focused.options.findIndex((option) => option.id === _getValue()) + 1,
        );
        _setValue(focused.options[nextIndex].id);
      });

      App.consumeKey("k", () => {
        const nextIndex = Math.max(
          0,
          focused.options.findIndex((option) => option.id === _getValue()) - 1,
        );
        _setValue(focused.options[nextIndex].id);
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
  }
}

type SelectOption = {
  id: string;
  label: string;
};

class Select extends FormElement<string> {
  options: SelectOption[] = [];
  value = "";

  getSize(): number {
    if (this.size) {
      return this.size;
    }

    if (this.options.length) {
      return Math.max(...this.options.map((option) => option.label.length));
    }

    return 30;
  }

  setOptions(options: SelectOption[]): this {
    this.options = options;
    return this;
  }

  getSelectedOption(): SelectOption | null {
    return this.options.find((option) => option.id === this.value) ?? null;
  }

  getName(): string {
    return this.name || "select";
  }

  render(): void {
    const selected = this.getSelectedOption();
    const size = this.getSize();
    const content =
      (this.focused ? " " : "[") +
      (this.options.length === 0
        ? "loading...".padEnd(size, " ")
        : selected
          ? selected.label.slice(0, size).padEnd(size, "  ")
          : " ".repeat(size)) +
      " ▾" +
      (this.focused ? " " : "]");

    output.write(this.getName() + ":");
    output.write(
      this.focused
        ? this.options.length
          ? chalk.inverse(content)
          : chalk.bgGray.black(content)
        : content,
    );
  }
}

export const Form = {
  Container,
  Input,
  Checkbox,
  Select,
};
