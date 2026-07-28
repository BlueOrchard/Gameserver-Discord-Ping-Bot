import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeVarInt,
  parseMinecraftStatusPacket,
} from "../src/checkers/minecraft.js";

test("Minecraft status parser extracts player and version data", () => {
  const json = Buffer.from(
    JSON.stringify({
      version: { name: "1.21.8" },
      players: {
        online: 2,
        max: 20,
        sample: [{ name: "Alex" }, { name: "Steve" }],
      },
    }),
  );
  const payload = Buffer.concat([
    encodeVarInt(0),
    encodeVarInt(json.length),
    json,
  ]);

  const checkedAt = new Date("2026-07-28T12:00:00Z");
  const status = parseMinecraftStatusPacket(
    payload,
    "minecraft-main",
    42,
    checkedAt,
  );

  assert.deepEqual(status, {
    serverId: "minecraft-main",
    online: true,
    checkedAt,
    latencyMs: 42,
    players: {
      current: 2,
      max: 20,
      sample: ["Alex", "Steve"],
    },
    version: "1.21.8",
  });
});
