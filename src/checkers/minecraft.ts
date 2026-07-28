import { Socket } from "node:net";
import type {
  MinecraftServerConfig,
  ServerChecker,
  ServerStatus,
} from "../types.js";

const MAX_PACKET_SIZE = 2 * 1024 * 1024;

interface VarInt {
  value: number;
  bytes: number;
}

interface MinecraftStatusResponse {
  version?: { name?: unknown };
  players?: {
    online?: unknown;
    max?: unknown;
    sample?: Array<{ name?: unknown }>;
  };
}

export function encodeVarInt(value: number): Buffer {
  let remaining = value >>> 0;
  const bytes: number[] = [];
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

export function decodeVarInt(buffer: Buffer, offset = 0): VarInt | undefined {
  let value = 0;
  let position = 0;

  while (position < 5) {
    const byte = buffer[offset + position];
    if (byte === undefined) {
      return undefined;
    }
    value |= (byte & 0x7f) << (7 * position);
    position += 1;
    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, bytes: position };
    }
  }
  throw new Error("Invalid VarInt in Minecraft response.");
}

function encodeString(value: string): Buffer {
  const content = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(content.length), content]);
}

function packet(payload: Buffer): Buffer {
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

function createStatusRequest(server: MinecraftServerConfig): Buffer {
  const port = Buffer.allocUnsafe(2);
  port.writeUInt16BE(server.port);
  const handshake = Buffer.concat([
    encodeVarInt(0),
    encodeVarInt(-1),
    encodeString(server.host),
    port,
    encodeVarInt(1),
  ]);
  return Buffer.concat([packet(handshake), packet(Buffer.from([0]))]);
}

export function parseMinecraftStatusPacket(
  payload: Buffer,
  serverId: string,
  latencyMs: number,
  checkedAt = new Date(),
): ServerStatus {
  const packetId = decodeVarInt(payload);
  if (!packetId || packetId.value !== 0) {
    throw new Error("Unexpected Minecraft status packet.");
  }

  const length = decodeVarInt(payload, packetId.bytes);
  if (!length) {
    throw new Error("Minecraft status response is missing its JSON length.");
  }
  const start = packetId.bytes + length.bytes;
  const end = start + length.value;
  if (end > payload.length) {
    throw new Error("Minecraft status response was truncated.");
  }

  const parsed = JSON.parse(
    payload.subarray(start, end).toString("utf8"),
  ) as MinecraftStatusResponse;
  const online = parsed.players?.online;
  const max = parsed.players?.max;
  const sample = parsed.players?.sample
    ?.map((player) => player.name)
    .filter((name): name is string => typeof name === "string")
    .slice(0, 10);

  return {
    serverId,
    online: true,
    checkedAt,
    latencyMs,
    ...(typeof online === "number" && typeof max === "number"
      ? { players: { current: online, max, ...(sample?.length ? { sample } : {}) } }
      : {}),
    ...(typeof parsed.version?.name === "string"
      ? { version: parsed.version.name }
      : {}),
  };
}

async function readStatusPacket(
  socket: Socket,
  timeoutMs: number,
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    let settled = false;

    const finish = (error?: Error, payload?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve(payload!);
    };

    const timer = setTimeout(
      () => finish(new Error(`Minecraft query timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );

    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      const length = decodeVarInt(received);
      if (!length) return;
      if (length.value > MAX_PACKET_SIZE) {
        finish(new Error("Minecraft response exceeded the safety limit."));
        return;
      }
      const packetEnd = length.bytes + length.value;
      if (received.length >= packetEnd) {
        finish(undefined, received.subarray(length.bytes, packetEnd));
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("end", () => {
      if (!settled) finish(new Error("Minecraft server closed the connection."));
    });
  });
}

export class MinecraftChecker
  implements ServerChecker<MinecraftServerConfig>
{
  async check(
    server: MinecraftServerConfig,
    timeoutMs: number,
  ): Promise<ServerStatus> {
    const socket = new Socket();
    const startedAt = performance.now();
    const response = readStatusPacket(socket, timeoutMs);
    socket.connect(server.port, server.host, () => {
      socket.write(createStatusRequest(server));
    });

    const payload = await response;
    return parseMinecraftStatusPacket(
      payload,
      server.id,
      Math.max(0, Math.round(performance.now() - startedAt)),
    );
  }
}
