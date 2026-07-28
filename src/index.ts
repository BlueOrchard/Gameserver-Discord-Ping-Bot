import "dotenv/config";
import { loadConfig } from "./config.js";
import { runBot } from "./bot.js";

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token || token === "replace-with-your-bot-token") {
    throw new Error(
      "DISCORD_TOKEN is missing. Copy .env.example to .env and add your private bot token.",
    );
  }

  const configPath = process.env.CONFIG_PATH?.trim() || "config/servers.json";
  const config = await loadConfig(configPath);
  await runBot(config, token);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
