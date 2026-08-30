import type {
  ProjectZomboidServerConfig,
  ServerChecker,
  ServerStatus,
} from "../types.js";
import { queryA2sInfo, type A2sInfo } from "./a2s.js";

export function projectZomboidStatusFromA2s(
  info: A2sInfo,
  serverId: string,
  latencyMs: number,
  checkedAt = new Date(),
): ServerStatus {
  return {
    serverId,
    online: true,
    checkedAt,
    latencyMs,
    players: {
      current: info.currentPlayers,
      max: info.maxPlayers,
    },
    ...(info.serverName ? { serverName: info.serverName } : {}),
    ...(info.map ? { map: info.map } : {}),
    ...(info.version ? { version: info.version } : {}),
  };
}

export class ProjectZomboidChecker
  implements ServerChecker<ProjectZomboidServerConfig>
{
  async check(
    server: ProjectZomboidServerConfig,
    timeoutMs: number,
  ): Promise<ServerStatus> {
    const { info, latencyMs } = await queryA2sInfo(
      server.host,
      server.queryPort,
      timeoutMs,
      "Project Zomboid",
    );
    return projectZomboidStatusFromA2s(info, server.id, latencyMs);
  }
}
