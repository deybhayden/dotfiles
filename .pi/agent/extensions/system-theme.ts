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
} from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);
const CHECK_INTERVAL_MS = 2000;
const DARK_THEME_NAME = "dark";
const LIGHT_THEME_NAME = "light";

async function getWindowsTheme(): Promise<"dark" | "light" | null> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "(Get-ItemPropertyValue -Path 'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Themes\\\\Personalize' -Name AppsUseLightTheme)",
    ]);
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
  const settingsManager = SettingsManager.create(process.cwd(), getAgentDir());
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastSystemTheme: "dark" | "light" | null = null;
  let isChecking = false;

  const updateTheme = async (ctx: ExtensionContext) => {
    if (isChecking) {
      return;
    }
    isChecking = true;
    try {
      const systemTheme = await getWindowsTheme();
      if (!systemTheme || systemTheme === lastSystemTheme) {
        return;
      }
      lastSystemTheme = systemTheme;
      const themeName =
        systemTheme === "dark" ? DARK_THEME_NAME : LIGHT_THEME_NAME;
      const result = ctx.ui.setTheme(themeName);
      if (result.success) {
        settingsManager.setTheme(themeName);
      }
    } finally {
      isChecking = false;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    lastSystemTheme = null;
    await updateTheme(ctx);

    intervalId = setInterval(() => {
      void updateTheme(ctx);
    }, CHECK_INTERVAL_MS);
  });

  pi.on("session_shutdown", () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
}
