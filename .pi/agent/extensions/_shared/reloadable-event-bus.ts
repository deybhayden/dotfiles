import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const RELOADABLE_EVENT_BUS_LISTENERS_KEY =
  "__piReloadableEventBusListeners" as const;

type EventBusDisposer = () => void;
type EventBusListenerRegistry = Map<string, EventBusDisposer>;

type GlobalWithReloadableEventBusListeners = typeof globalThis & {
  [RELOADABLE_EVENT_BUS_LISTENERS_KEY]?: EventBusListenerRegistry;
};

function getListenerRegistry(): EventBusListenerRegistry {
  const globalWithRegistry =
    globalThis as GlobalWithReloadableEventBusListeners;

  globalWithRegistry[RELOADABLE_EVENT_BUS_LISTENERS_KEY] ??= new Map();
  return globalWithRegistry[RELOADABLE_EVENT_BUS_LISTENERS_KEY];
}

export function registerReloadableEventBusListener(
  pi: ExtensionAPI,
  key: string,
  channel: string,
  handler: (data: unknown) => void,
): void {
  const registry = getListenerRegistry();
  registry.get(key)?.();
  registry.set(key, pi.events.on(channel, handler));
}
