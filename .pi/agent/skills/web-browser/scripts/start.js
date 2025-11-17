#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const useProfile = process.argv[2] === "--profile";
const debugPort = 9222;

if (process.argv[2] && process.argv[2] !== "--profile") {
  console.log("Usage: start.ts [--profile]");
  console.log("\nOptions:");
  console.log(
    "  --profile  Copy your default Chrome profile (cookies, logins)",
  );
  console.log("\nExamples:");
  console.log("  start.ts            # Start with fresh profile");
  console.log("  start.ts --profile  # Start with your Chrome profile");
  process.exit(1);
}

// Get Windows username for WSL2
function getWindowsUsername() {
  try {
    return execSync("cmd.exe /c echo %USERNAME%", { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Failed to get Windows username");
  }
}

const winUser = getWindowsUsername();
const chromePath = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const winProfilePath = `/mnt/c/Users/${winUser}/AppData/Local/Google/Chrome/User Data`;

// Use a Windows-accessible path for the scraping profile
const scrapingProfileWsl = `/mnt/c/Users/${winUser}/AppData/Local/Google/Chrome/ScrapingProfile`;
const scrapingProfileWin = `C:\\Users\\${winUser}\\AppData\\Local\\Google\\Chrome\\ScrapingProfile`;

// Kill existing debug Chrome instances (only ones using our debug port/profile)
try {
  const psCommand = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*--remote-debugging-port=${debugPort}*' -and $_.CommandLine -like '*ScrapingProfile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  execSync(`powershell.exe -NoProfile -Command "${psCommand}"`, {
    stdio: "ignore",
  });
} catch {}

// Wait a bit for processes to fully die
await new Promise((r) => setTimeout(r, 1000));

// Setup profile directory (Windows-accessible)
execSync(`mkdir -p "${scrapingProfileWsl}"`, { stdio: "ignore" });

if (useProfile) {
  // Sync profile with rsync (much faster on subsequent runs)
  execSync(
    `rsync -a --delete "${winProfilePath}/" "${scrapingProfileWsl}/"`,
    { stdio: "pipe" },
  );
}

// Start Chrome in background (detached so Node can exit)
// Use Windows path format for --user-data-dir since it's a Windows executable
spawn(
  chromePath,
  [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${scrapingProfileWin}`,
    "--profile-directory=Default",
    "--disable-search-engine-choice-screen",
    "--no-first-run",
    "--disable-features=ProfilePicker",
  ],
  { detached: true, stdio: "ignore" },
).unref();

// Wait for Chrome to be ready by checking the debugging endpoint
let connected = false;
for (let i = 0; i < 30; i++) {
  try {
    const response = await fetch(`http://localhost:${debugPort}/json/version`);
    if (response.ok) {
      connected = true;
      break;
    }
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (!connected) {
  console.error("✗ Failed to connect to Chrome");
  process.exit(1);
}

// Start background watcher for logs/network (detached)
const scriptDir = dirname(fileURLToPath(import.meta.url));
const watcherPath = join(scriptDir, "watch.js");
spawn(process.execPath, [watcherPath], { detached: true, stdio: "ignore" }).unref();

console.log(
  `✓ Chrome started on :${debugPort}${useProfile ? " with your profile" : ""}`,
);
