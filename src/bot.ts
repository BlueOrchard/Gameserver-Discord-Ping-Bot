import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { resolve } from "node:path";
import { checkServer } from "./checkers/index.js";
import { createDashboardPayloads, DashboardPublisher } from "./dashboard.js";
import type { AppConfig, ServerStatus } from "./types.js";

function presenceText(statuses: ServerStatus[]): string {
  const online = statuses.filter((status) => status.online).length;
  return `${online}/${statuses.length} game servers online`;
}

export async function runBot(config: AppConfig, token: string): Promise<void> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const publisher = new DashboardPublisher(
    client,
    config.discord.channelId,
    resolve(".data/dashboard-state.json"),
  );
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;

  const refresh = async (): Promise<void> => {
    const startedAt = Date.now();
    const statuses = await Promise.all(
      config.servers.map((server) =>
        checkServer(server, config.queryTimeoutMs),
      ),
    );

    await publisher.publish(createDashboardPayloads(config, statuses));
    client.user?.setPresence({
      activities: [
        { name: presenceText(statuses), type: ActivityType.Watching },
      ],
      status: statuses.some((status) => status.online) ? "online" : "idle",
    });

    const online = statuses.filter((status) => status.online).length;
    console.log(
      `[refresh] ${online}/${statuses.length} online; completed in ${Date.now() - startedAt}ms`,
    );
  };

  const schedule = (): void => {
    if (stopping) return;
    timer = setTimeout(async () => {
      try {
        await refresh();
      } catch (error) {
        console.error("[refresh] Dashboard update failed:", error);
      } finally {
        schedule();
      }
    }, config.refreshIntervalSeconds * 1_000);
  };

  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    console.log("[bot] Shutting down.");
    client.destroy();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[bot] Logged in as ${readyClient.user.tag}.`);
    try {
      await refresh();
    } catch (error) {
      console.error("[refresh] Initial dashboard update failed:", error);
    }
    schedule();
  });

  await client.login(token);
}
