import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  COLLECT_END_TARGETS_EVENT,
  type ActiveEndTarget,
  type CollectEndTargetsEvent,
} from "./_shared/end-events.js";

function getActiveTargets(
  pi: ExtensionAPI,
  ctx: CollectEndTargetsEvent["ctx"],
) {
  const event: CollectEndTargetsEvent = { ctx, targets: [] };
  pi.events.emit(COLLECT_END_TARGETS_EVENT, event);

  const seen = new Set<string>();
  const deduped: typeof event.targets = [];

  for (let index = event.targets.length - 1; index >= 0; index -= 1) {
    const target = event.targets[index]!;
    if (seen.has(target.key)) {
      continue;
    }
    seen.add(target.key);
    deduped.unshift(target);
  }

  return deduped;
}

export default function endExtension(pi: ExtensionAPI) {
  pi.registerCommand("end", {
    description: "Finish the active child workflow",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/end requires interactive mode", "error");
        return;
      }

      const activeTargets = getActiveTargets(pi, ctx);

      if (activeTargets.length === 0) {
        ctx.ui.notify("No active child workflow found.", "info");
        return;
      }

      if (activeTargets.length === 1) {
        await activeTargets[0]!.run();
        return;
      }

      const choice = await ctx.ui.select(
        "Multiple child workflows look active. Which one should /end finish?",
        activeTargets.map((target) => target.label),
      );

      if (choice === undefined) {
        ctx.ui.notify("/end cancelled", "info");
        return;
      }

      const target = activeTargets.find(
        (item: ActiveEndTarget) => item.label === choice,
      );

      if (!target) {
        ctx.ui.notify("Could not resolve end target", "error");
        return;
      }

      await target.run();
    },
  });
}
