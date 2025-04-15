export const Clickup: {
  readonly _token?: string;
  setToken(token: string): void;
  _request<T extends unknown>(url: string): Promise<T>;
  getTaskName(taskId: string): Promise<string>;
  getTaskList(): Promise<{ id: string; name: string; status: string }[]>;
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

  async getTaskName(taskId) {
    const response = await this._request<{ name: string }>(`/task/${taskId}`);
    return response.name;
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
