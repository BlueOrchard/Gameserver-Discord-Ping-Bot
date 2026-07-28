export type ServerType = "minecraft-java" | "palworld";

export interface DiscordConfig {
  channelId: string;
  dashboardTitle: string;
  accentColor: string;
}

export interface BaseServerConfig {
  id: string;
  type: ServerType;
  name: string;
  host: string;
  port: number;
  displayAddress: string;
}

export interface MinecraftServerConfig extends BaseServerConfig {
  type: "minecraft-java";
}

export interface PalworldServerConfig extends BaseServerConfig {
  type: "palworld";
  statusProtocol: "a2s" | "rest";
  queryPort: number;
  restPort: number;
  restPasswordEnv: string;
}

export type GameServerConfig = MinecraftServerConfig | PalworldServerConfig;

export interface AppConfig {
  discord: DiscordConfig;
  refreshIntervalSeconds: number;
  queryTimeoutMs: number;
  servers: GameServerConfig[];
}

export interface PlayerCount {
  current: number;
  max: number;
  sample?: string[];
}

export interface ServerStatus {
  serverId: string;
  online: boolean;
  checkedAt: Date;
  latencyMs?: number;
  players?: PlayerCount;
  version?: string;
  map?: string;
  serverName?: string;
  error?: string;
}

export interface ServerChecker<TConfig extends GameServerConfig = GameServerConfig> {
  check(server: TConfig, timeoutMs: number): Promise<ServerStatus>;
}
