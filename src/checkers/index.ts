import type {
  GameServerConfig,
  ServerChecker,
  ServerStatus,
} from "../types.js";
import { MinecraftChecker } from "./minecraft.js";
import { PalworldChecker } from "./palworld.js";
import { ProjectZomboidChecker } from "./project-zomboid.js";

const checkers: Record<GameServerConfig["type"], ServerChecker> = {
  "minecraft-java": new MinecraftChecker() as ServerChecker,
  palworld: new PalworldChecker() as ServerChecker,
  "project-zomboid": new ProjectZomboidChecker() as ServerChecker,
};

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/timed out/i.test(error.message)) return "No response before timeout";
    if (/password environment variable .* is missing/i.test(error.message)) {
      return "REST API password is not configured";
    }
    if (/rejected the configured admin password/i.test(error.message)) {
      return "REST API rejected its credentials";
    }
    if (/ECONNREFUSED/i.test(error.message)) return "Connection refused";
    if (/ENOTFOUND|EAI_AGAIN/i.test(error.message)) return "Host not found";
  }
  return "Server did not answer the status query";
}

export async function checkServer(
  server: GameServerConfig,
  timeoutMs: number,
): Promise<ServerStatus> {
  try {
    return await checkers[server.type].check(server, timeoutMs);
  } catch (error) {
    console.error(`[status:${server.id}]`, error);
    return {
      serverId: server.id,
      online: false,
      checkedAt: new Date(),
      error: safeErrorMessage(error),
    };
  }
}
