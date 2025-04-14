export class Clickup {
  private _token?: string;

  setToken(token: string) {
    if (!token) throw new Error("Invalid token");
    this._token = token;
  }

  private async _request<T extends unknown>(url: string): Promise<T> {
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
    return json as T;
  }

  async getTaskName(taskId: string): Promise<string> {
    if (!taskId) throw new Error("Missing taskId");
    const response = await this._request<{ name: string }>(`/task/${taskId}`);
    return response.name;
  }

  async getList(): Promise<
    Array<{
      id: string;
      name: string;
      status: string;
    }>
  > {
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
  }

  getTaskUrl(branch: string): string {
    return `https://app.clickup.com/t/${branch}`;
  }
}
