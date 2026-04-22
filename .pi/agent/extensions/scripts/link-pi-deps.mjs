import { execSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const nodeModules = join(process.cwd(), "node_modules");
const marioDir = join(nodeModules, "@mariozechner");
const deprecatedSinclairDir = join(nodeModules, "@sinclair");

mkdirSync(marioDir, { recursive: true });
rmSync(deprecatedSinclairDir, { recursive: true, force: true });

const piAgent = join(globalRoot, "@mariozechner", "pi-coding-agent");
const piAgentDeps = join(piAgent, "node_modules");

const links = [
  [piAgent, join(marioDir, "pi-coding-agent")],
  [join(piAgentDeps, "@mariozechner", "pi-ai"), join(marioDir, "pi-ai")],
  [join(piAgentDeps, "@mariozechner", "pi-tui"), join(marioDir, "pi-tui")],
  [join(piAgentDeps, "typebox"), join(nodeModules, "typebox")],
];

for (const [target, linkPath] of links) {
  rmSync(linkPath, { recursive: true, force: true });
  symlinkSync(target, linkPath, "junction");
}
