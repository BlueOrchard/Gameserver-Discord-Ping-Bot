import type {
  PalworldServerConfig,
  ServerChecker,
  ServerStatus,
} from "../types.js";
import { parseA2sInfo, queryA2sInfo } from "./a2s.js";

interface PalworldRestInfo {
  version?: unknown;
  servername?: unknown;
}

interface PalworldRestMetrics {
  currentplayernum?: unknown;
  maxplayernum?: unknown;
}

export function parseA2sInfoResponse(
  message: Buffer,
  serverId: string,
  latencyMs: number,
  checkedAt = new Date(),
): ServerStatus {
  const info = parseA2sInfo(message);

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

export function parseRestResponses(
  info: PalworldRestInfo,
  metrics: PalworldRestMetrics,
  serverId: string,
  latencyMs: number,
  checkedAt = new Date(),
): ServerStatus {
  const currentPlayers = metrics.currentplayernum;
  const maxPlayers = metrics.maxplayernum;

  if (
    typeof currentPlayers !== "number" ||
    typeof maxPlayers !== "number"
  ) {
    throw new Error("Palworld REST metrics response is missing player counts.");
  }

  return {
    serverId,
    online: true,
    checkedAt,
    latencyMs,
    players: { current: currentPlayers, max: maxPlayers },
    ...(typeof info.servername === "string" && info.servername
      ? { serverName: info.servername }
      : {}),
    ...(typeof info.version === "string" && info.version
      ? { version: info.version }
      : {}),
  };
}

async function readRestJson(
  response: Response,
  endpoint: string,
): Promise<Record<string, unknown>> {
  if (response.status === 401) {
    throw new Error(
      "Palworld REST API rejected the configured admin password (HTTP 401).",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Palworld REST ${endpoint} returned HTTP ${response.status}.`,
    );
  }

  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Palworld REST ${endpoint} returned invalid JSON.`);
  }
  return value as Record<string, unknown>;
}

async function queryRest(
  server: PalworldServerConfig,
  timeoutMs: number,
): Promise<ServerStatus> {
  const password = process.env[server.restPasswordEnv]?.trim();
  if (!password) {
    throw new Error(
      `Palworld REST password environment variable ${server.restPasswordEnv} is missing.`,
    );
  }

  const host = server.host.includes(":") ? `[${server.host}]` : server.host;
  const baseUrl = `http://${host}:${server.restPort}/v1/api`;
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const request = (endpoint: string): Promise<Response> =>
      fetch(`${baseUrl}/${endpoint}`, {
        headers: {
          Accept: "application/json",
          Authorization: authorization,
        },
        redirect: "error",
        signal: controller.signal,
      });
    const [infoResponse, metricsResponse] = await Promise.all([
      request("info"),
      request("metrics"),
    ]);
    const [info, metrics] = await Promise.all([
      readRestJson(infoResponse, "info"),
      readRestJson(metricsResponse, "metrics"),
    ]);

    return parseRestResponses(
      info,
      metrics,
      server.id,
      Math.max(0, Math.round(performance.now() - startedAt)),
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Palworld REST query timed out after ${timeoutMs}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class PalworldChecker implements ServerChecker<PalworldServerConfig> {
  async check(
    server: PalworldServerConfig,
    timeoutMs: number,
  ): Promise<ServerStatus> {
    if (server.statusProtocol === "rest") {
      return await queryRest(server, timeoutMs);
    }

    const { info, latencyMs } = await queryA2sInfo(
      server.host,
      server.queryPort,
      timeoutMs,
      "Palworld",
    );
    return {
      serverId: server.id,
      online: true,
      checkedAt: new Date(),
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
}
