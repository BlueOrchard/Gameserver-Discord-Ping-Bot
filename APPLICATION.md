# Application Memory: Game Server Discord Checker

## Purpose

This repository contains a private Discord bot for displaying the live status
of personal game servers. It currently supports Minecraft Java Edition,
Palworld, and Project Zomboid. It is intentionally simple to operate for a
small private community, while keeping game checks modular so more server types
can be added later.

This document is the durable product and architecture record. Update it whenever
the application's behavior, configuration, supported protocols, or operational
requirements change.

## User-visible behavior

The bot maintains a rich status dashboard in one configured Discord text
channel. Each configured game server receives its own embed with:

- a green/accent online or red offline indicator;
- current and maximum player count when available;
- query latency;
- a configurable display address;
- version, map, and reported server name when available;
- a relative "last refreshed" time.

The bot edits its previously created dashboard message rather than sending a new
message every interval. Discord allows ten embeds per message, so the dashboard
automatically uses additional messages when more than ten servers are
configured. The IDs of bot-owned dashboard messages are stored at
`.data/dashboard-state.json`.

The bot also updates its Discord activity to:

```text
Watching <online>/<configured> game servers online
```

Checks run immediately after Discord login and then every configured interval.
All configured servers are checked concurrently. A failed server query does not
prevent the other server statuses from being displayed.

## Architecture

```text
config/servers.json + .env
             |
             v
       configuration validation
             |
             v
        checker registry (concurrent)
          |          |          |
          v          v          v
   Minecraft TCP  Palworld   Zomboid A2S
   status protocol REST/A2S   UDP query
          \          |          /
           v         v         v
        normalized ServerStatus[]
                   |
                   v
        Discord embed renderer
                   |
                   v
       edit/create persistent messages
       + update bot activity presence
```

Important source modules:

- `src/index.ts`: environment loading and startup.
- `src/config.ts`: strict runtime validation of JSON configuration.
- `src/bot.ts`: Discord lifecycle, refresh scheduling, presence, and graceful
  shutdown.
- `src/dashboard.ts`: embed construction, message chunking, edit/create logic,
  and stale bot-message cleanup.
- `src/state-store.ts`: atomic persistence of dashboard message IDs.
- `src/checkers/index.ts`: checker registry, failure isolation, and safe public
  error messages.
- `src/checkers/minecraft.ts`: Minecraft Java status request and response parser.
- `src/checkers/a2s.ts`: shared Valve/Steam A2S_INFO UDP request, challenge
  handling, and response parser.
- `src/checkers/palworld.ts`: REST info/metrics requests plus legacy Valve
  A2S_INFO querying and response parsing.
- `src/checkers/project-zomboid.ts`: Project Zomboid A2S status normalization.

## Protocol behavior

### Minecraft Java

The checker opens a TCP connection to `host:port`, sends a Minecraft status
handshake followed by a status request, and parses the JSON response. It does
not join the server and does not require an in-game account, RCON, Query, or a
Minecraft plugin. The response can include player count, a small player sample,
and the reported server version.

### Palworld

The default `rest` checker concurrently requests `/v1/api/info` and
`/v1/api/metrics` from `host:restPort`. It uses HTTP Basic Auth with username
`admin`; the password is loaded from the environment variable named by
`restPasswordEnv`. This supplies server name, version, player counts, and
latency without placing the administrative password in JSON or Discord.

Palworld must have `RESTAPIEnabled=True`, a `RESTAPIPort`, and a strong
`AdminPassword`. The API is administrative and must remain on the trusted LAN;
it should never be port-forwarded to the Internet. HTTP redirects are rejected
so credentials cannot be forwarded to another endpoint.

The legacy `a2s` mode sends a Valve/Steam `A2S_INFO` request over UDP to
`host:queryPort` and supports the standard challenge exchange. Some Palworld
builds bind the query port but do not answer these packets, which is why REST is
the preferred protocol.

### Project Zomboid

The checker sends a Valve/Steam `A2S_INFO` request over UDP to
`host:queryPort`. The default Project Zomboid game port, `16261`, handles Steam
queries; the networking design also uses a separate port for direct client
connections. The query response supplies current/max players, public server
name, map, version, and latency when the server reports them. No RCON
credentials are required.

## Configuration contract

Runtime secrets belong in `.env`:

- `DISCORD_TOKEN` (required): private Discord bot token.
- `DISCORD_CHANNEL_ID` (optional): overrides the JSON channel ID.
- `CONFIG_PATH` (optional): defaults to `config/servers.json`.
- `PALWORLD_ADMIN_PASSWORD` (required by the example REST configuration):
  must match Palworld's `AdminPassword`.

Non-secret behavior belongs in `config/servers.json`:

| Field | Meaning |
| --- | --- |
| `discord.channelId` | Discord text channel receiving the dashboard |
| `discord.dashboardTitle` | Heading above the first embed group |
| `discord.accentColor` | Six-digit hex color used for online embeds |
| `refreshIntervalSeconds` | Delay after one refresh finishes; 15–3600 |
| `queryTimeoutMs` | Per-server query timeout; 500–30000 |
| `servers` | Non-empty list of game server definitions |

Every server has a unique lowercase `id`, supported `type`, display `name`,
network `host`, gameplay `port`, and `displayAddress`. Palworld additionally
selects `statusProtocol`, `restPort`, `restPasswordEnv`, and the legacy
`queryPort`. Project Zomboid has a `queryPort` that defaults to its configured
`port`. Configuration and environment variables are loaded once at startup;
restart the process after editing either one.

## Privacy and security decisions

- The Discord token is loaded only from the environment and `.env` is ignored by
  Git.
- Game-server credentials are not needed.
- The Palworld REST administrator password stays in `.env`, is used only in the
  Basic Auth header, and is never included in dashboard or error output.
- Detailed network/parser errors remain in local logs. Embeds show short generic
  failures and do not expose stack traces.
- Discord `allowedMentions` is empty, so configuration text cannot ping members.
- Message deletion is limited to obsolete message IDs previously recorded by
  this bot in its state file.
- Packet sizes and timeouts are bounded to avoid waiting forever or accepting an
  unreasonably large Minecraft response.
- The bot requests only the `Guilds` gateway intent; no privileged member or
  message-content intent is used.

The configured `displayAddress` is intentionally shown in Discord. Use a
friendly DNS name or omit sensitive private addresses if members should not see
them.

## Adding another server instance

Add another entry of an already supported `type` to `servers.json` and restart
the bot. No code changes are required.

## Adding another game type

1. Add the new literal to `ServerType` and its typed configuration to
   `src/types.ts`.
2. Validate game-specific fields in `src/config.ts`.
3. Implement `ServerChecker` under `src/checkers/`.
4. Register it in `src/checkers/index.ts`.
5. Add an icon or label behavior in `src/dashboard.ts` if desired.
6. Add parser fixtures and failure tests in `tests/`.
7. Update this document and the example configuration.

All checkers must return the common `ServerStatus` model, enforce a timeout, and
throw protocol/network errors. The registry catches those errors so one broken
server cannot abort the complete refresh.

## Operational characteristics

- Designed for one private bot process. Do not run two replicas against the same
  Discord channel and state file; they can race while editing the dashboard.
- Refresh scheduling is non-overlapping. The next interval starts after the
  previous refresh completes.
- State writes are atomic through a temporary file and rename.
- Server queries are read-only and make no game-server changes.
- The process handles `SIGINT` and `SIGTERM` and closes the Discord client.

## Verification

Use these commands before deployment or after changes:

```powershell
npm test
npm run typecheck
npm run build
```

The automated tests contain synthetic Minecraft, Palworld, and Project Zomboid
packets and verify that their normalized status data is parsed correctly. A
complete live smoke test additionally requires valid Discord credentials and
reachable game servers, which are intentionally not stored in this repository.
