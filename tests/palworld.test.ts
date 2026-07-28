import assert from "node:assert/strict";
import test from "node:test";
import {
  parseA2sInfoResponse,
  parseRestResponses,
} from "../src/checkers/palworld.js";

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

test("Palworld A2S parser extracts server details", () => {
  const appId = Buffer.alloc(2);
  appId.writeUInt16LE(2394010 & 0xffff);
  const message = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x11]),
    cstring("Friends-only Palworld"),
    cstring("Palworld"),
    cstring("palworld"),
    cstring("Palworld"),
    appId,
    Buffer.from([3, 32, 0, 0x64, 0x77, 0, 1]),
    cstring("0.6.2"),
    Buffer.from([0]),
  ]);

  const checkedAt = new Date("2026-07-28T12:00:00Z");
  const status = parseA2sInfoResponse(
    message,
    "palworld-main",
    18,
    checkedAt,
  );

  assert.deepEqual(status, {
    serverId: "palworld-main",
    online: true,
    checkedAt,
    latencyMs: 18,
    players: { current: 3, max: 32 },
    serverName: "Friends-only Palworld",
    map: "Palworld",
    version: "0.6.2",
  });
});

test("Palworld REST parser combines info and metrics", () => {
  const checkedAt = new Date("2026-07-28T12:00:00Z");
  const status = parseRestResponses(
    {
      servername: "Friends-only Palworld",
      version: "v1.0.0",
    },
    {
      currentplayernum: 4,
      maxplayernum: 32,
    },
    "palworld-main",
    12,
    checkedAt,
  );

  assert.deepEqual(status, {
    serverId: "palworld-main",
    online: true,
    checkedAt,
    latencyMs: 12,
    players: { current: 4, max: 32 },
    serverName: "Friends-only Palworld",
    version: "v1.0.0",
  });
});
