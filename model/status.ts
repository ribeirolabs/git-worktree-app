import * as z from "zod";
import yaml from "yaml";
import { Files } from "../files.ts";
import { Clickup } from "../service/clickup.ts";

const StatusSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export type Status = z.infer<typeof StatusSchema>;

const StatusCacheSchema = z.record(z.string(), z.array(StatusSchema));

type StatusCache = z.infer<typeof StatusCacheSchema>;

export function loadStatuses(): Record<string, Status[]> {
  const content = Files.statuses.read();
  const result = StatusCacheSchema.safeParse(content);
  if (result.success) {
    return result.data;
  }
  saveStatuses({});
  return {};
}

export async function loadOrFetchStatuses(listId: string): Promise<Status[]> {
  const local = loadStatuses();
  if (listId in local) {
    return local[listId];
  }
  const statuses = await Clickup.getStatuses(listId);
  saveStatuses({ ...local, [listId]: statuses });
  return statuses;
}

export function saveStatuses(statuses: StatusCache): void {
  Files.statuses.write(yaml.stringify(statuses));
}
