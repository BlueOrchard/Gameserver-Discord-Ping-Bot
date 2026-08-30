import assert from "node:assert/strict";
import test from "node:test";
import { parseA2sInfo } from "../src/checkers/a2s.js";
import { projectZomboidStatusFromA2s } from "../src/checkers/project-zomboid.js";

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

test("Project Zomboid status extracts Steam query details", () => {
  const appId = Buffer.alloc(2);
  appId.writeUInt16LE(108600 & 0xffff);
  const message = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x11]),
    cstring("Rosewood Survivors"),
    cstring("Muldraugh, KY"),
    cstring("zomboid"),
    cstring("Project Zomboid"),
    appId,
    Buffer.from([5, 32, 0, 0x64, 0x77, 0, 1]),
    cstring("41.78.16"),
    Buffer.from([0]),
  ]);
  const checkedAt = new Date("2026-08-30T12:00:00Z");

  const status = projectZomboidStatusFromA2s(
    parseA2sInfo(message),
    "zomboid-main",
    23,
    checkedAt,
  );

  assert.deepEqual(status, {
    serverId: "zomboid-main",
    online: true,
    checkedAt,
    latencyMs: 23,
    players: { current: 5, max: 32 },
    serverName: "Rosewood Survivors",
    map: "Muldraugh, KY",
    version: "41.78.16",
  });
});
