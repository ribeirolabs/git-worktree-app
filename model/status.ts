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

  Files.debug.append(`local statuses: ${JSON.stringify(local, null, 2)}`);
  if (listId in local) {
    Files.debug.append(`Loaded status from local file, list: ${listId}`);
    return local[listId];
  }
  const statuses = await Clickup.getStatuses(listId);
  Files.debug.append(`Loaded status from clickup, list: ${listId}`);
  saveStatuses({ ...local, [listId]: statuses });
  return statuses;
}

export function saveStatuses(statuses: StatusCache): void {
  Files.statuses.write(yaml.stringify(statuses));
}
