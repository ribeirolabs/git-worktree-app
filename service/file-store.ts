import os from "node:os";
import path from "node:path";
import file from "node:fs";
import child from "node:child_process";

const STORE_DIR = ".local/share/gw-app";

export class FileStore {
  private _file: string;
  private _content: string;
  private _memory: boolean;

  constructor(filename: string, opts: { memory?: boolean } = {}) {
    const storeDir = path.join(os.homedir(), STORE_DIR);
    this._file = path.join(storeDir, filename);
    this._content = "";
    this._memory = opts.memory ?? true;

    if (!file.existsSync(storeDir)) {
      child.execSync(`mkdir -p ${storeDir}`);
    }

    if (!file.existsSync(this._file)) {
      child.execSync(`touch ${this._file}`);
    }
  }

  read(): string {
    if (this._content.length && this._memory) {
      return this._content;
    }

    const content = file
      .readFileSync(this._file, { encoding: "utf8" })
      .replace(/\n$/, "");

    if (this._memory) {
      this._content = content;
    }

    return content;
  }

  write(content: string) {
    if (this._memory) {
      this._content = content;
    }
    file.writeFileSync(this._file, content);
  }

  append(content: string) {
    const value = `[${new Date().toISOString()}]\n` + content + "\n";

    if (this._memory) {
      this._content += value;
    }

    file.appendFileSync(this._file, value);
  }
}
