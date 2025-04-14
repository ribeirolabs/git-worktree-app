import os from "node:os";
import path from "node:path";
import file from "node:fs";
import child from "node:child_process";

const STORE_DIR = ".local/share/gw-app";

export class FileStore {
  private _file: string;

  constructor(filename: string) {
    this._file = path.join(os.homedir(), STORE_DIR, filename);

    if (!file.existsSync(this._file)) {
      child.execSync(`touch ${this._file}`);
    }
  }

  read(): string {
    return file
      .readFileSync(this._file, { encoding: "utf8" })
      .replace(/\n$/, "");
  }

  write(content: string) {
    file.writeFileSync(this._file, content);
  }
}
