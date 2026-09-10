import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

// Typecheck against the installed host, rather than a second copy of pi.
const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const nodeModules = resolve(import.meta.dirname, "../node_modules");
const scopeDir = join(nodeModules, "@earendil-works");
const piAgent = join(globalRoot, "@earendil-works", "pi-coding-agent");
const piAgentDeps = join(piAgent, "node_modules");

const links = [
  [piAgent, join(scopeDir, "pi-coding-agent")],
  [join(piAgentDeps, "@earendil-works", "pi-ai"), join(scopeDir, "pi-ai")],
  [join(piAgentDeps, "@earendil-works", "pi-tui"), join(scopeDir, "pi-tui")],
  [join(piAgentDeps, "typebox"), join(nodeModules, "typebox")],
];

// Validate everything before replacing any existing links.
for (const [target] of links) {
  if (!existsSync(join(target, "package.json"))) {
    throw new Error(
      `Missing pi dependency: ${target}. Install @earendil-works/pi-coding-agent globally first.`,
    );
  }
}

mkdirSync(scopeDir, { recursive: true });
for (const [target, linkPath] of links) {
  rmSync(linkPath, { recursive: true, force: true });
  symlinkSync(target, linkPath, "junction");
}
