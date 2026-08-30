# Private Game Server Discord Dashboard

A private Discord bot that checks Minecraft Java, Palworld, and Project Zomboid
servers, edits a persistent rich-embed dashboard, and sets the bot's activity to
a summary such as `Watching 3/3 game servers online`.

The complete behavior and architecture are recorded in
[APPLICATION.md](./APPLICATION.md).

## What it does

- Checks every configured server concurrently on a configurable interval.
- Uses the Minecraft Java status protocol over TCP.
- Uses Palworld's supported REST API by default, with legacy Steam/Valve
  `A2S_INFO` available as an optional fallback.
- Uses Project Zomboid's Steam `A2S_INFO` query on its configured game/query
  port.
- Shows online state, players, latency, address, version, map, and server name
  when the game exposes them.
- Edits the same Discord message after each check instead of posting repeatedly.
- Persists dashboard message IDs in `.data/dashboard-state.json` across restarts.
- Supports more servers by adding entries to one JSON file. More than ten
  servers are automatically split across multiple dashboard messages.

## Requirements

- Node.js 20.12 or newer
- A Discord application/bot
- Network access from this bot to each game server's status/query port

## 1. Create and invite the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application, open **Bot**, and create/reset its token.
3. Keep the token private. Do not commit or paste it into `servers.json`.
4. Under **OAuth2 → URL Generator**, select the `bot` scope.
5. Grant these bot permissions:
   - View Channels
   - Send Messages
   - Embed Links
   - Read Message History
6. Use the generated URL to invite the bot to your private Discord server.

No privileged gateway intents are required.

## 2. Configure the application

In PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item config/servers.example.json config/servers.json
```

Edit `.env` and set `DISCORD_TOKEN`. To copy the channel ID, enable Discord
Developer Mode, right-click the target channel, and choose **Copy Channel ID**.
Put that value in `config/servers.json`.

Then replace the example hostnames and ports:

```json
{
  "discord": {
    "channelId": "123456789012345678",
    "dashboardTitle": "My Game Servers",
    "accentColor": "#57F287"
  },
  "refreshIntervalSeconds": 60,
  "queryTimeoutMs": 5000,
  "servers": [
    {
      "id": "minecraft-main",
      "type": "minecraft-java",
      "name": "Minecraft",
      "host": "192.168.1.50",
      "port": 25565,
      "displayAddress": "play.example.net:25565"
    },
    {
      "id": "palworld-main",
      "type": "palworld",
      "name": "Palworld",
      "host": "192.168.1.60",
      "port": 8211,
      "statusProtocol": "rest",
      "queryPort": 27015,
      "restPort": 8212,
      "restPasswordEnv": "PALWORLD_ADMIN_PASSWORD",
      "displayAddress": "palworld.example.net:8211"
    },
    {
      "id": "zomboid-main",
      "type": "project-zomboid",
      "name": "Project Zomboid",
      "host": "192.168.1.70",
      "port": 16261,
      "queryPort": 16261,
      "displayAddress": "zomboid.example.net:16261"
    }
  ]
}
```

`host` is what the bot connects to. `displayAddress` is only what members see
in Discord, so it can be a friendly public DNS name while the bot uses a private
LAN address.

For Palworld, `port` is the player connection port shown in Discord.
`statusProtocol: "rest"` uses `restPort` (normally `8212`) and reads the
administrator password from the environment variable named by
`restPasswordEnv`. Set the matching value in `.env`:

```dotenv
PALWORLD_ADMIN_PASSWORD=the-same-value-as-AdminPassword
```

On the Palworld host, set `RESTAPIEnabled=True`, `RESTAPIPort=8212`, and a strong
`AdminPassword` in the active `PalWorldSettings.ini`, then restart Palworld.
Keep this administrative port on the LAN; do not expose it to the Internet.

Legacy `statusProtocol: "a2s"` uses the UDP `queryPort`, commonly `27015`.

For Project Zomboid, `port` is the address displayed to players and
`queryPort` is where the bot sends Steam status queries. Both are `16261/UDP`
by default. Project Zomboid's published networking design uses an additional
port—historically `16262/UDP` by default—for direct player connections, but the
tracker does not query that second port. If your server changes `DefaultPort`,
update both `port` and `queryPort` to match. See the
[official networking explanation](https://projectzomboid.com/blog/news/2022/09/the-good-life/).

## 3. Install and run

```powershell
npm install
npm test
npm run build
npm start
```

For automatic reload during local development:

```powershell
npm run dev
```

The first successful refresh creates the dashboard message. Later refreshes and
process restarts edit it in place.

## Docker (optional)

After creating `.env` and `config/servers.json`:

```powershell
docker compose up -d --build
docker compose logs -f
```

The Compose volume preserves the dashboard message IDs across container
recreation.

## Troubleshooting

- **The bot logs in but cannot publish:** verify the channel ID and the bot's
  channel permissions.
- **Minecraft is offline in Discord but players can connect:** ensure the bot
  can reach the configured TCP host and port. Proxies should expose the Java
  status handshake on that endpoint.
- **Palworld REST connection is refused:** verify `RESTAPIEnabled=True`, restart
  Palworld, and confirm TCP `restPort` is reachable from the bot.
- **Palworld REST rejects credentials:** make sure `.env` contains the same
  password as `AdminPassword` and restart the bot so it reloads `.env`.
- **Project Zomboid times out:** verify the bot can reach `queryPort` over UDP
  and that it matches the server's `DefaultPort` (normally `16261`). Do not use
  the separate direct-connection port as the Steam query endpoint.
- **A host works publicly but not inside Docker:** use an address resolvable and
  reachable from the container; on a LAN that may be the server's private IP.
- **The bot creates a replacement dashboard:** its state file was missing, the
  old message was deleted, or it lost permission to read message history.

Detailed query errors are written to the local process log. Discord receives a
short, non-sensitive error summary.
