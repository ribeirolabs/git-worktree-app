import { FileStore } from "./service/file-store.ts";

export const Files = {
  tasks: new FileStore("tasks.yaml"),
  statuses: new FileStore("statuses.yaml"),
  config: new FileStore("config.yaml"),
  token: new FileStore("token"),
  error: new FileStore("error-log"),
};
