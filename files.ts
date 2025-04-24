import { FileStore } from "./service/file-store.ts";

export const Files = {
  tasks: new FileStore("tasks"),
  statuses: new FileStore("statuses.yaml"),
  token: new FileStore("token"),
  error: new FileStore("error-log"),
  config: new FileStore("config"),
};
