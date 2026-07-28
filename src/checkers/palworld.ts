import { createSocket, type Socket } from "node:dgram";
import type {
  PalworldServerConfig,
  ServerChecker,
  ServerStatus,
} from "../types.js";

const A2S_INFO_REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from("Source Engine Query\0", "ascii"),
]);

interface PalworldRestInfo {
  version?: unknown;
  servername?: unknown;
}

interface PalworldRestMetrics {
  currentplayernum?: unknown;
  maxplayernum?: unknown;
}

class BufferCursor {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  ensure(length: number): void {
    if (this.offset + length > this.buffer.length) {
      throw new Error("Palworld query response was truncated.");
    }
  }

  uint8(): number {
    this.ensure(1);
    return this.buffer[this.offset++]!;
  }

  uint16(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  skip(length: number): void {
    this.ensure(length);
    this.offset += length;
  }

  string(): string {
    const end = this.buffer.indexOf(0, this.offset);
    if (end === -1) {
      throw new Error("Palworld query response contains an invalid string.");
    }
    const value = this.buffer.subarray(this.offset, end).toString("utf8");
    this.offset = end + 1;
    return value;
  }

  remaining(): number {
    return this.buffer.length - this.offset;
  }
}

export function parseA2sInfoResponse(
  message: Buffer,
  serverId: string,
  latencyMs: number,
  checkedAt = new Date(),
): ServerStatus {
  if (message.length < 6 || message.readInt32LE(0) !== -1) {
    if (message.length >= 4 && message.readInt32LE(0) === -2) {
      throw new Error("Split A2S responses are not supported.");
    }
    throw new Error("Invalid Palworld A2S_INFO response.");
  }

  const cursor = new BufferCursor(message.subarray(4));
  const responseType = cursor.uint8();
  if (responseType !== 0x49) {
    throw new Error(
      `Unexpected Palworld A2S response type 0x${responseType.toString(16)}.`,
    );
  }

  cursor.uint8(); // Protocol version
  const serverName = cursor.string();
  const map = cursor.string();
  cursor.string(); // Folder
  cursor.string(); // Game name
  cursor.uint16(); // Steam application id
  const currentPlayers = cursor.uint8();
  const maxPlayers = cursor.uint8();
  cursor.uint8(); // Bots
  cursor.skip(4); // Server type, environment, visibility, VAC
  const version = cursor.string();

  // Extra Data Flag fields are optional and not needed for the dashboard.
  if (cursor.remaining() > 0) {
    const extraDataFlag = cursor.uint8();
    if ((extraDataFlag & 0x80) !== 0) cursor.skip(2);
    if ((extraDataFlag & 0x10) !== 0) cursor.skip(8);
    if ((extraDataFlag & 0x40) !== 0) {
      cursor.skip(2);
      cursor.string();
    }
    if ((extraDataFlag & 0x20) !== 0) cursor.string();
    if ((extraDataFlag & 0x01) !== 0) cursor.skip(8);
  }

  return {
    serverId,
    online: true,
    checkedAt,
    latencyMs,
    players: { current: currentPlayers, max: maxPlayers },
    ...(serverName ? { serverName } : {}),
    ...(map ? { map } : {}),
    ...(version ? { version } : {}),
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

async function queryA2s(
  socket: Socket,
  server: PalworldServerConfig,
  timeoutMs: number,
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    let challenged = false;
    let settled = false;

    const finish = (error?: Error, response?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close();
      if (error) reject(error);
      else resolve(response!);
    };

    const send = (payload: Buffer): void => {
      socket.send(payload, server.queryPort, server.host, (error) => {
        if (error) finish(error);
      });
    };

    const timer = setTimeout(
      () => finish(new Error(`Palworld query timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );

    socket.once("error", (error) => finish(error));
    socket.on("message", (message) => {
      const isChallenge =
        message.length >= 9 &&
        message.readInt32LE(0) === -1 &&
        message[4] === 0x41;
      if (isChallenge && !challenged) {
        challenged = true;
        send(Buffer.concat([A2S_INFO_REQUEST, message.subarray(5, 9)]));
        return;
      }
      finish(undefined, message);
    });

    send(A2S_INFO_REQUEST);
  });
}

export class PalworldChecker implements ServerChecker<PalworldServerConfig> {
  async check(
    server: PalworldServerConfig,
    timeoutMs: number,
  ): Promise<ServerStatus> {
    if (server.statusProtocol === "rest") {
      return await queryRest(server, timeoutMs);
    }

    const socket = createSocket("udp4");
    const startedAt = performance.now();
    const message = await queryA2s(socket, server, timeoutMs);
    return parseA2sInfoResponse(
      message,
      server.id,
      Math.max(0, Math.round(performance.now() - startedAt)),
    );
  }
}
