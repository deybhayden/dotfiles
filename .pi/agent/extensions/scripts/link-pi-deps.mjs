import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Typecheck against the installed host, rather than a second copy of pi.
const managedRoot =
  process.env.PI_MANAGED_INSTALL_ROOT ||
  join(
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
    "install",
  );
const versionFile = join(managedRoot, "current-version");
let piAgent;
if (existsSync(versionFile)) {
  const version = readFileSync(versionFile, "utf8").trim();
  if (
    !/^[a-zA-Z0-9._+-]+$/.test(version) ||
    version === "." ||
    version === ".."
  ) {
    throw new Error(`Invalid managed pi version in ${versionFile}`);
  }
  piAgent = join(
    managedRoot,
    "releases",
    version,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
} else {
  const globalRoot = execFileSync("npm", ["root", "-g"], {
    encoding: "utf8",
  }).trim();
  piAgent = join(globalRoot, "@earendil-works", "pi-coding-agent");
}

const nodeModules = resolve(import.meta.dirname, "../node_modules");
const scopeDir = join(nodeModules, "@earendil-works");
const hostRequire = createRequire(join(piAgent, "package.json"));
const links = [[piAgent, join(scopeDir, "pi-coding-agent")]];
for (const name of [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "typebox",
]) {
  // Search from the host so both nested npm and hoisted managed dependencies work.
  // Inspect package.json directly: these packages need not export it to require().
  const target = hostRequire.resolve
    .paths(name)
    .find((directory) => existsSync(join(directory, name, "package.json")));
  if (!target) {
    throw new Error(
      `Missing pi dependency ${name} for ${piAgent}. Repair your pi installation.`,
    );
  }
  links.push([join(target, name), join(nodeModules, name)]);
}

// Validate everything before replacing any existing links.
for (const [target] of links) {
  if (!existsSync(join(target, "package.json"))) {
    throw new Error(
      `Missing pi dependency: ${target}. Install or repair pi using the managed installer or npm.`,
    );
  }
}

mkdirSync(scopeDir, { recursive: true });
for (const [target, linkPath] of links) {
  rmSync(linkPath, { recursive: true, force: true });
  symlinkSync(target, linkPath, "junction");
}
