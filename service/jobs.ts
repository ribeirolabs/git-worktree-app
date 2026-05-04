type Job = { id: string; promise: Promise<void> };

class JobRunner {
  private jobs = new Map<string, Job>();

  run(id: string, work: () => Promise<void>): void {
    if (this.jobs.has(id)) return;
    const promise = work().finally(() => {
      this.jobs.delete(id);
    });
    this.jobs.set(id, { id, promise });
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  size(): number {
    return this.jobs.size;
  }

  async drain(): Promise<void> {
    await Promise.all([...this.jobs.values()].map((j) => j.promise));
  }
}

export const Jobs = new JobRunner();
