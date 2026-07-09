export type GatewayHandler<I = unknown, O = unknown> = (pluginId: string, input: I) => Promise<O>;

export interface GatewayCallContext {
  pluginId: string;
  permission: string;
}
