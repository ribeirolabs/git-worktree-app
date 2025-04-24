import * as z from "zod";
import { type Task } from "../app.ts";
import { parse } from "yaml";
import { Files } from "../files.ts";

const ConfigSchema = z.object({
  team_id: z.number(),
  project_id: z.number(),
  folder_id: z.number(),
  space_id: z.number(),
});

const Config = ConfigSchema.parse(parse(Files.config.read()));

const TaskResponseSchema = z.interface({
  id: z.string(),
  name: z.string(),
  status: z.interface({
    id: z.string(),
    status: z.string(),
  }),
});

const SpaceResponseSchema = z.object({
  statuses: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
    }),
  ),
});

export const Clickup: {
  readonly _token?: string;
  setToken(token: string): void;
  _request<T extends unknown>(url: string, init?: RequestInit): Promise<T>;
  getTask(taskId: string): Promise<Task>;
  updateTask(
    data: { id: string } & Partial<{ name: string; status: string }>,
  ): Promise<void>;
  getTaskList(): Promise<Task[]>;
  getStatuses(): Promise<{ id: string; label: string }[]>;
  getTaskUrl(taskId: string): string;
} = {
  _token: undefined,

  setToken(token) {
    // @ts-ignore
    this._token = token;
  },

  async _request(url, init) {
    if (!this._token) throw new Error("Missing token");
    if (!url) throw new Error("Missing request url");

    const response = await fetch(`https://api.clickup.com/api${url}`, {
      method: init?.method ?? "GET",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        Authorization: this._token,
      },
      body: init?.body,
    });

    const json = await response.json();
    if (json.err) throw new Error(json.err);
    return json;
  },

  async getTask(taskId) {
    const response = await this._request(`/v2/task/${taskId}`);
    const task = TaskResponseSchema.safeParse(response);
    if (!task.success) {
      Files.error.append(
        `Invalid task response:\n${z.prettifyError(task.error)}\nThe response was:\n${JSON.stringify(response, null, 2)}`,
      );
      throw new Error("Invalid task response");
    }
    return {
      id: task.data.id,
      name: task.data.name,
      status: {
        id: task.data.status.id,
        label: task.data.status.status,
      },
    };
  },

  async updateTask(task) {
    // const response = await this._request(`/v2/task/${task.id}`, {
    //   method: "PUT",
    //   body: JSON.stringify({
    //     status: task.status,
    //   }),
    // });
    await this._request(`/v1/task/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({
        // item_ids: [task.id],
        status: task.status,
      }),
    });
  },

  async getTaskList() {
    const response = await this._request<{
      tasks: z.output<typeof TaskResponseSchema>[];
    }>(`/v2/view/183aev-81593/task`);
    return response.tasks.map((task) => {
      return {
        id: task.id,
        name: task.name,
        status: {
          id: task.status.id,
          label: task.status.status,
        },
      };
    });
  },

  async getStatuses() {
    const response = await this._request<{
      tasks: { id: string; name: string; status: { status: string } }[];
    }>(`/v2/space/${Config.space_id}`);

    const result = SpaceResponseSchema.parse(response);

    return result.statuses.map((status) => {
      return {
        id: status.id,
        label: status.status,
      };
    });
  },

  getTaskUrl(taskId: string): string {
    return `https://app.clickup.com/t/${taskId}`;
  },
};
