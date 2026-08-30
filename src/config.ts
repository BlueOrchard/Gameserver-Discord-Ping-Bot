import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AppConfig,
  GameServerConfig,
  ServerType,
} from "./types.js";

const SUPPORTED_TYPES = new Set<ServerType>([
  "minecraft-java",
  "palworld",
  "project-zomboid",
]);
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringAt(
  value: unknown,
  path: string,
  options: { pattern?: RegExp; defaultValue?: string } = {},
): string {
  if (value === undefined && options.defaultValue !== undefined) {
    return options.defaultValue;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string.`);
  }
  const result = value.trim();
  if (options.pattern && !options.pattern.test(result)) {
    throw new Error(`${path} has an invalid format.`);
  }
  return result;
}

function integerAt(
  value: unknown,
  path: string,
  min: number,
  max: number,
  defaultValue?: number,
): number {
  if (value === undefined && defaultValue !== undefined) {
    return defaultValue;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`${path} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function parseServer(value: unknown, index: number): GameServerConfig {
  const path = `servers[${index}]`;
  const raw = objectAt(value, path);
  const type = stringAt(raw.type, `${path}.type`) as ServerType;

  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(
      `${path}.type "${type}" is unsupported. Supported types: ${[...SUPPORTED_TYPES].join(", ")}.`,
    );
  }

  const shared = {
    id: stringAt(raw.id, `${path}.id`, { pattern: /^[a-z0-9][a-z0-9_-]*$/ }),
    name: stringAt(raw.name, `${path}.name`),
    host: stringAt(raw.host, `${path}.host`),
    port: integerAt(raw.port, `${path}.port`, 1, 65_535),
    displayAddress: stringAt(
      raw.displayAddress,
      `${path}.displayAddress`,
      { defaultValue: `${String(raw.host)}:${String(raw.port)}` },
    ),
  };

  if (type === "minecraft-java") {
    return { ...shared, type };
  }

  if (type === "project-zomboid") {
    return {
      ...shared,
      type,
      queryPort: integerAt(
        raw.queryPort,
        `${path}.queryPort`,
        1,
        65_535,
        shared.port,
      ),
    };
  }

  return {
    ...shared,
    type,
    statusProtocol: stringAt(
      raw.statusProtocol,
      `${path}.statusProtocol`,
      { defaultValue: "a2s", pattern: /^(a2s|rest)$/ },
    ) as "a2s" | "rest",
    queryPort: integerAt(
      raw.queryPort,
      `${path}.queryPort`,
      1,
      65_535,
      27_015,
    ),
    restPort: integerAt(
      raw.restPort,
      `${path}.restPort`,
      1,
      65_535,
      8_212,
    ),
    restPasswordEnv: stringAt(
      raw.restPasswordEnv,
      `${path}.restPasswordEnv`,
      {
        defaultValue: "PALWORLD_ADMIN_PASSWORD",
        pattern: /^[A-Z_][A-Z0-9_]*$/,
      },
    ),
  };
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const absolutePath = resolve(configPath);
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load configuration at ${absolutePath}: ${message}`);
  }

  const raw = objectAt(parsed, "config");
  const discord = objectAt(raw.discord, "discord");
  if (!Array.isArray(raw.servers) || raw.servers.length === 0) {
    throw new Error("servers must be a non-empty array.");
  }

  const servers = raw.servers.map(parseServer);
  const ids = new Set<string>();
  for (const server of servers) {
    if (ids.has(server.id)) {
      throw new Error(`Server id "${server.id}" is duplicated.`);
    }
    ids.add(server.id);
  }

  const configuredChannelId = stringAt(
    discord.channelId,
    "discord.channelId",
    { pattern: SNOWFLAKE_PATTERN },
  );
  const channelId = process.env.DISCORD_CHANNEL_ID?.trim() || configuredChannelId;
  if (!SNOWFLAKE_PATTERN.test(channelId)) {
    throw new Error("DISCORD_CHANNEL_ID must be a valid Discord channel id.");
  }

  return {
    discord: {
      channelId,
      dashboardTitle: stringAt(
        discord.dashboardTitle,
        "discord.dashboardTitle",
        { defaultValue: "Game Server Status" },
      ),
      accentColor: stringAt(discord.accentColor, "discord.accentColor", {
        defaultValue: "#5865F2",
        pattern: HEX_COLOR_PATTERN,
      }),
    },
    refreshIntervalSeconds: integerAt(
      raw.refreshIntervalSeconds,
      "refreshIntervalSeconds",
      15,
      3_600,
      60,
    ),
    queryTimeoutMs: integerAt(
      raw.queryTimeoutMs,
      "queryTimeoutMs",
      500,
      30_000,
      5_000,
    ),
    servers,
  };
}
