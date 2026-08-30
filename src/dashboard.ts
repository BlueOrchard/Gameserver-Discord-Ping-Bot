import {
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type MessageMentionOptions,
} from "discord.js";
import type {
  AppConfig,
  GameServerConfig,
  ServerStatus,
} from "./types.js";
import {
  readDashboardState,
  writeDashboardState,
} from "./state-store.js";

const EMBEDS_PER_MESSAGE = 10;

export interface DashboardPayload {
  content: string;
  embeds: EmbedBuilder[];
  allowedMentions: MessageMentionOptions;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function serverEmoji(server: GameServerConfig): string {
  if (server.type === "project-zomboid") return "🧟";
  return server.type === "minecraft-java" ? "⛏️" : "🌴";
}

function buildServerEmbed(
  server: GameServerConfig,
  status: ServerStatus,
  accentColor: string,
): EmbedBuilder {
  const color = status.online ? "#57F287" : "#ED4245";
  const checkedUnix = Math.floor(status.checkedAt.getTime() / 1000);
  const fields = [
    {
      name: "Status",
      value: status.online ? "🟢 Online" : "🔴 Offline",
      inline: true,
    },
    {
      name: "Players",
      value: status.players
        ? `👥 ${status.players.current} / ${status.players.max}`
        : "—",
      inline: true,
    },
    {
      name: "Latency",
      value:
        status.latencyMs === undefined ? "—" : `📶 ${status.latencyMs} ms`,
      inline: true,
    },
    {
      name: "Address",
      value: `\`${truncate(server.displayAddress, 100)}\``,
      inline: false,
    },
  ];

  if (status.serverName && status.serverName !== server.name) {
    fields.push({
      name: "Server name",
      value: truncate(status.serverName, 1_024),
      inline: true,
    });
  }
  if (status.map) {
    fields.push({
      name: "Map",
      value: truncate(status.map, 1_024),
      inline: true,
    });
  }
  if (status.version) {
    fields.push({
      name: "Version",
      value: truncate(status.version, 1_024),
      inline: true,
    });
  }
  if (status.players?.sample?.length) {
    fields.push({
      name: "Online players",
      value: truncate(status.players.sample.join(", "), 1_024),
      inline: false,
    });
  }
  if (!status.online && status.error) {
    fields.push({
      name: "Check result",
      value: truncate(status.error, 1_024),
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setColor(
      (status.online ? accentColor : color) as ColorResolvable,
    )
    .setTitle(`${serverEmoji(server)} ${truncate(server.name, 240)}`)
    .setDescription(
      status.online
        ? `Last refreshed <t:${checkedUnix}:R>`
        : `Last attempted <t:${checkedUnix}:R>`,
    )
    .addFields(fields)
    .setFooter({
      text: `Server ID: ${truncate(server.id, 100)}`,
    })
    .setTimestamp(status.checkedAt);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function createDashboardPayloads(
  config: AppConfig,
  statuses: ServerStatus[],
): DashboardPayload[] {
  const byId = new Map(statuses.map((status) => [status.serverId, status]));
  const embeds = config.servers.map((server) => {
    const status = byId.get(server.id) ?? {
      serverId: server.id,
      online: false,
      checkedAt: new Date(),
      error: "Status unavailable",
    };
    return buildServerEmbed(
      server,
      status,
      config.discord.accentColor,
    );
  });

  return chunks(embeds, EMBEDS_PER_MESSAGE).map((embedChunk, index) => ({
    content:
      index === 0
        ? `## ${truncate(config.discord.dashboardTitle, 90)}\nAutomatically refreshed every ${config.refreshIntervalSeconds} seconds.`
        : `**${truncate(config.discord.dashboardTitle, 90)} — continued**`,
    embeds: embedChunk,
    allowedMentions: { parse: [] },
  }));
}

export class DashboardPublisher {
  constructor(
    private readonly client: Client,
    private readonly channelId: string,
    private readonly statePath: string,
  ) {}

  async publish(payloads: DashboardPayload[]): Promise<void> {
    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel?.isSendable()) {
      throw new Error(
        `Discord channel ${this.channelId} was not found or is not sendable.`,
      );
    }

    const state = await readDashboardState(this.statePath);
    const nextIds: string[] = [];

    for (const [index, payload] of payloads.entries()) {
      const currentId = state.messageIds[index];
      let message =
        currentId === undefined
          ? undefined
          : await channel.messages.fetch(currentId).catch(() => undefined);

      if (message) {
        message = await message.edit(payload);
      } else {
        message = await channel.send(payload);
      }
      nextIds.push(message.id);
    }

    for (const staleId of state.messageIds.slice(payloads.length)) {
      const staleMessage = await channel.messages
        .fetch(staleId)
        .catch(() => undefined);
      await staleMessage?.delete().catch(() => undefined);
    }

    await writeDashboardState(this.statePath, { messageIds: nextIds });
  }
}
