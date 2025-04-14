class Clickup {
  /**
   * @param {string} token
   */
  setToken(token) {
    if (!token) throw new Error("Invalid token");
    this._token = token;
  }

  /**
   * @param {string} url
   * @returns {Promise<any>}
   */
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
  }

  /**
   * @param {string} taskId
   * @returns {Promise<string>}
   */
  async getTaskName(taskId) {
    if (!taskId) throw new Error("Missing taskId");
    const response = await this._request(`/task/${taskId}`);
    return response.name;
  }

  /**
   * @returns {Promise<{
   *  id: string,
   *  name: string,
   *  status: string
   * }>}
   */
  async getList() {
    const response = await this._request(`/view/183aev-81593/task`);
    return response.tasks.map((task) => {
      return {
        id: task.id,
        name: task.name,
        status: task.status.status,
      };
    });
  }

  /**
   * @param {string} branch
   * @returns {string}
   */
  getUrl(branch) {
    return `https://app.clickup.com/t/${branch}`;
  }
}

module.exports = {
  Clickup
}
