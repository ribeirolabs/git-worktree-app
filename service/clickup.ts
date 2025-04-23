import * as z from "zod";
import { type Task } from "../app.ts";
import { FileStore } from "./file-store.ts";

const errorLog = new FileStore("error-log");

const TaskResponseSchema = z.interface({
  id: z.string(),
  name: z.string(),
  status: z.interface({
    status: z.string(),
  }),
});

export const Clickup: {
  readonly _token?: string;
  setToken(token: string): void;
  _request<T extends unknown>(url: string): Promise<T>;
  getTask(taskId: string): Promise<Task>;
  getTaskList(): Promise<Task[]>;
  getTaskUrl(taskId: string): string;
} = {
  _token: undefined,

  setToken(token) {
    // @ts-ignore
    this._token = token;
  },

  async _request(url) {
    if (!this._token) throw new Error("Missing token");
    if (!url) throw new Error("Missing request url");

    const response = await fetch(`https://api.clickup.com/api/v2${url}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: this._token,
      },
    });

    const json = await response.json();
    if (json.err) throw new Error(json.err);
    return json;
  },

  async getTask(taskId) {
    const response = await this._request(`/task/${taskId}`);
    const task = TaskResponseSchema.safeParse(response);
    if (!task.success) {
      errorLog.append(
        `Invalid task response:\n${z.prettifyError(task.error)}\nThe response was:\n${JSON.stringify(response, null, 2)}`,
      );
      throw new Error("Invalid task response");
    }
    return {
      id: task.data.id,
      name: task.data.name,
      status: task.data.status.status,
    };
  },

  async getTaskList() {
    const response = await this._request<{
      tasks: { id: string; name: string; status: { status: string } }[];
    }>(`/view/183aev-81593/task`);
    return response.tasks.map((task) => {
      return {
        id: task.id,
        name: task.name,
        status: task.status.status,
      };
    });
  },

  getTaskUrl(taskId: string): string {
    return `https://app.clickup.com/t/${taskId}`;
  },
};
