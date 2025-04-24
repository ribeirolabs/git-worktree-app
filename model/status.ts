import * as z from "zod";
import yaml from "yaml";
import { Files } from "../files.ts";
import { Clickup } from "../service/clickup.ts";

const StatusSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export type Status = z.output<typeof StatusSchema>;

export function loadStatuses(): Status[] {
  const content = Files.statuses.read();
  const result = z.array(StatusSchema).safeParse(content);
  if (result.success) {
    return result.data;
  }
  saveStatuses([]);
  return [];
}

export async function loadOrFetchStatuses(): Promise<Status[]> {
  const local = loadStatuses();
  if (local.length) {
    return local;
  }
  const statuses = await Clickup.getStatuses();
  saveStatuses(statuses);
  return statuses;
}

export function saveStatuses(statuses: Status[]): void {
  Files.statuses.write(yaml.stringify(statuses));
}
