/**
 * Cycle themes with keyboard shortcuts.
 *
 * - Alt+T: Cycle to next theme
 *
 * Persists the selected theme to settings.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { SettingsManager, getAgentDir } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  const settingsManager = SettingsManager.create(process.cwd(), getAgentDir());

  function getThemeNames(ctx: ExtensionContext): string[] {
    return ctx.ui.getAllThemes().map((t) => t.name);
  }

  function getCurrentThemeName(ctx: ExtensionContext): string | undefined {
    return ctx.ui.theme.name;
  }

  function cycleTheme(ctx: ExtensionContext): void {
    const themes = getThemeNames(ctx);
    if (themes.length === 0) return;

    const current = getCurrentThemeName(ctx);
    const currentIndex = current ? themes.indexOf(current) : -1;
    const nextIndex = (currentIndex + 1) % themes.length;

    const nextTheme = themes[nextIndex];
    const result = ctx.ui.setTheme(nextTheme);
    if (result.success) {
      settingsManager.setTheme(nextTheme);
      ctx.ui.notify(`Theme: ${nextTheme}`, "info");
    } else {
      ctx.ui.notify(`Failed to set theme: ${result.error}`, "error");
    }
  }

  pi.registerShortcut(Key.alt("t"), {
    description: "Cycle to next theme",
    handler: async (ctx) => {
      cycleTheme(ctx);
    },
  });
}
