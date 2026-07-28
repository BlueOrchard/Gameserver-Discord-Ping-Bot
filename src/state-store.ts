import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface DashboardState {
  messageIds: string[];
}

export async function readDashboardState(
  path: string,
): Promise<DashboardState> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      messageIds?: unknown;
    };
    const messageIds = Array.isArray(raw.messageIds)
      ? raw.messageIds.filter((id): id is string => typeof id === "string")
      : [];
    return { messageIds };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read dashboard state at ${path}; recreating it.`);
    }
    return { messageIds: [] };
  }
}

export async function writeDashboardState(
  path: string,
  state: DashboardState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
