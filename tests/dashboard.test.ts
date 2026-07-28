import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardPayloads } from "../src/dashboard.js";
import type {
  AppConfig,
  MinecraftServerConfig,
  ServerStatus,
} from "../src/types.js";

test("dashboard splits more than ten servers without enabling mentions", () => {
  const servers: MinecraftServerConfig[] = Array.from(
    { length: 11 },
    (_, index) => ({
      id: `minecraft-${index}`,
      type: "minecraft-java",
      name: `Minecraft ${index}`,
      host: "127.0.0.1",
      port: 25_565 + index,
      displayAddress: `mc-${index}.example.test`,
    }),
  );
  const config: AppConfig = {
    discord: {
      channelId: "123456789012345678",
      dashboardTitle: "Test servers",
      accentColor: "#57F287",
    },
    refreshIntervalSeconds: 60,
    queryTimeoutMs: 5_000,
    servers,
  };
  const checkedAt = new Date("2026-07-28T12:00:00Z");
  const statuses: ServerStatus[] = servers.map((server) => ({
    serverId: server.id,
    online: true,
    checkedAt,
    players: { current: 1, max: 20 },
    latencyMs: 10,
  }));

  const payloads = createDashboardPayloads(config, statuses);

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0]?.embeds.length, 10);
  assert.equal(payloads[1]?.embeds.length, 1);
  assert.deepEqual(payloads[0]?.allowedMentions, { parse: [] });
  assert.equal(payloads[0]?.embeds[0]?.toJSON().color, 0x57f287);
});
