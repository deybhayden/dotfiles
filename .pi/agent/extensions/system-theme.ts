/**
 * Sync pi theme with Windows system appearance (light/dark).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  SettingsManager,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const CHECK_INTERVAL_MS = 2000;
const DARK_THEME_NAME = "dark";
const LIGHT_THEME_NAME = "light";

async function getWindowsTheme(
  signal: AbortSignal,
): Promise<"dark" | "light" | null> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "(Get-ItemPropertyValue -Path 'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Themes\\\\Personalize' -Name AppsUseLightTheme)",
      ],
      { signal, timeout: 5000 },
    );
    const value = stdout.trim().toLowerCase();
    if (value === "0" || value === "false") {
      return "dark";
    }
    if (value === "1" || value === "true") {
      return "light";
    }
    return null;
  } catch {
    return null;
  }
}

export default function (pi: ExtensionAPI) {
  let settingsManager: SettingsManager | undefined;
  let controller: AbortController | undefined;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastSystemTheme: "dark" | "light" | null = null;
  let isChecking = false;

  const updateTheme = async (ctx: ExtensionContext) => {
    if (isChecking || !controller || controller.signal.aborted) {
      return;
    }
    isChecking = true;
    try {
      const signal = controller.signal;
      const systemTheme = await getWindowsTheme(signal);
      if (signal.aborted || !systemTheme || systemTheme === lastSystemTheme) {
        return;
      }
      const themeName =
        systemTheme === "dark" ? DARK_THEME_NAME : LIGHT_THEME_NAME;
      const result = ctx.ui.setTheme(themeName);
      if (result.success) {
        lastSystemTheme = systemTheme;
        settingsManager?.setTheme(themeName);
      }
    } finally {
      isChecking = false;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") {
      return;
    }
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    controller?.abort();
    controller = new AbortController();
    settingsManager = SettingsManager.create(ctx.cwd, getAgentDir());
    lastSystemTheme = null;
    await updateTheme(ctx);
    if (controller.signal.aborted) return;

    intervalId = setInterval(() => {
      void updateTheme(ctx);
    }, CHECK_INTERVAL_MS);
  });

  pi.on("session_shutdown", async () => {
    controller?.abort();
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    await settingsManager?.flush();
  });
}
