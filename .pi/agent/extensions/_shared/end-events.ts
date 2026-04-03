import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export const COLLECT_END_TARGETS_EVENT = "pi:end:collect-targets";

export type ActiveEndTarget = {
  key: string;
  label: string;
  run: () => Promise<void>;
};

export type CollectEndTargetsEvent = {
  ctx: ExtensionCommandContext;
  targets: ActiveEndTarget[];
};
