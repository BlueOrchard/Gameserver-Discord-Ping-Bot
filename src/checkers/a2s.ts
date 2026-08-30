import { createSocket, type Socket } from "node:dgram";

const A2S_INFO_REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from("Source Engine Query\0", "ascii"),
]);

export interface A2sInfo {
  serverName: string;
  map: string;
  folder: string;
  game: string;
  applicationId: number;
  currentPlayers: number;
  maxPlayers: number;
  bots: number;
  version: string;
}

export interface A2sQueryResult {
  info: A2sInfo;
  latencyMs: number;
}

class BufferCursor {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  ensure(length: number): void {
    if (this.offset + length > this.buffer.length) {
      throw new Error("A2S_INFO response was truncated.");
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
      throw new Error("A2S_INFO response contains an invalid string.");
    }
    const value = this.buffer.subarray(this.offset, end).toString("utf8");
    this.offset = end + 1;
    return value;
  }

  remaining(): number {
    return this.buffer.length - this.offset;
  }
}

export function parseA2sInfo(message: Buffer): A2sInfo {
  if (message.length < 6 || message.readInt32LE(0) !== -1) {
    if (message.length >= 4 && message.readInt32LE(0) === -2) {
      throw new Error("Split A2S responses are not supported.");
    }
    throw new Error("Invalid A2S_INFO response.");
  }

  const cursor = new BufferCursor(message.subarray(4));
  const responseType = cursor.uint8();
  if (responseType !== 0x49) {
    throw new Error(
      `Unexpected A2S response type 0x${responseType.toString(16)}.`,
    );
  }

  cursor.uint8(); // Protocol version
  const serverName = cursor.string();
  const map = cursor.string();
  const folder = cursor.string();
  const game = cursor.string();
  const applicationId = cursor.uint16();
  const currentPlayers = cursor.uint8();
  const maxPlayers = cursor.uint8();
  const bots = cursor.uint8();
  cursor.skip(4); // Server type, environment, visibility, VAC
  const version = cursor.string();

  // Extra Data Flag fields are optional and not needed by the dashboard.
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
    serverName,
    map,
    folder,
    game,
    applicationId,
    currentPlayers,
    maxPlayers,
    bots,
    version,
  };
}

async function receiveA2s(
  socket: Socket,
  host: string,
  port: number,
  timeoutMs: number,
  label: string,
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
      socket.send(payload, port, host, (error) => {
        if (error) finish(error);
      });
    };

    const timer = setTimeout(
      () => finish(new Error(`${label} query timed out after ${timeoutMs}ms.`)),
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

export async function queryA2sInfo(
  host: string,
  port: number,
  timeoutMs: number,
  label: string,
): Promise<A2sQueryResult> {
  const socket = createSocket("udp4");
  const startedAt = performance.now();
  const message = await receiveA2s(socket, host, port, timeoutMs, label);
  return {
    info: parseA2sInfo(message),
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}
