import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

const packages = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "typebox",
];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "link-pi-deps-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const agentDir = join(root, "agent");
  const managedRoot = join(agentDir, "install");
  const globalRoot = join(root, "global");
  const bin = join(root, "bin");
  mkdirSync(join(project, "scripts"), { recursive: true });
  mkdirSync(bin);
  copyFileSync(
    join(import.meta.dirname, "link-pi-deps.mjs"),
    join(project, "scripts", "link-pi-deps.mjs"),
  );
  // Make fallback deterministic and detect unwanted npm calls for managed installs.
  writeFileSync(
    join(bin, "npm"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(join(root, "npm-called"))}, "");\nconsole.log(${JSON.stringify(globalRoot)});\n`,
    { mode: 0o755 },
  );
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  delete env.PI_MANAGED_INSTALL_ROOT;
  env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  return {
    root,
    project,
    env,
    managedRoot,
    globalRoot,
    run: () =>
      spawnSync(
        process.execPath,
        [join(project, "scripts", "link-pi-deps.mjs")],
        { env, encoding: "utf8" },
      ),
  };
}

function packageAt(root, name) {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name }));
  return directory;
}

function managedInstall(root, version = "1.2.0") {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "current-version"), `${version}\n`);
  const modules = join(root, "releases", version, "node_modules");
  for (const name of packages) packageAt(modules, name);
  return modules;
}

function assertLinks(project, targets) {
  for (const [index, name] of packages.entries()) {
    assert.equal(
      realpathSync(join(project, "node_modules", name)),
      join(targets[index], name),
    );
  }
}

test("links the managed current version without invoking npm and refreshes after updates", (t) => {
  const f = fixture(t);
  let modules = managedInstall(f.managedRoot);
  assert.equal(f.run().status, 0);
  assertLinks(
    f.project,
    packages.map(() => modules),
  );
  assert.equal(existsSync(join(f.root, "npm-called")), false);
  modules = managedInstall(f.managedRoot, "1.3.0");
  assert.equal(f.run().status, 0);
  assertLinks(
    f.project,
    packages.map(() => modules),
  );
});

test("finds the default managed install outside a pi session", (t) => {
  const f = fixture(t);
  delete f.env.PI_CODING_AGENT_DIR;
  f.env.HOME = join(f.root, "home");
  const modules = managedInstall(join(f.env.HOME, ".pi", "agent", "install"));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assertLinks(
    f.project,
    packages.map(() => modules),
  );
});

test("honors PI_MANAGED_INSTALL_ROOT", (t) => {
  const f = fixture(t);
  f.env.PI_MANAGED_INSTALL_ROOT = join(f.root, "custom-install");
  const modules = managedInstall(f.env.PI_MANAGED_INSTALL_ROOT);
  assert.equal(f.run().status, 0);
  assertLinks(
    f.project,
    packages.map(() => modules),
  );
});

test("falls back to a global npm install with nested dependencies", (t) => {
  const f = fixture(t);
  const host = packageAt(f.globalRoot, packages[0]);
  const nested = join(host, "node_modules");
  for (const name of packages.slice(1)) packageAt(nested, name);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assertLinks(f.project, [f.globalRoot, nested, nested, nested]);
  assert.ok(existsSync(join(f.root, "npm-called")));
});

test("validates dependencies before replacing existing links", (t) => {
  const f = fixture(t);
  const modules = managedInstall(f.managedRoot);
  rmSync(join(modules, "typebox"), { recursive: true });
  const existing = join(f.project, "node_modules", packages[0], "package.json");
  mkdirSync(dirname(existing), { recursive: true });
  writeFileSync(existing, "keep me");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing pi dependency typebox/);
  assert.equal(readFileSync(existing, "utf8"), "keep me");
});

test("rejects invalid managed version paths", (t) => {
  const f = fixture(t);
  mkdirSync(f.managedRoot, { recursive: true });
  for (const version of ["", ".", "..", "../../elsewhere"]) {
    writeFileSync(join(f.managedRoot, "current-version"), version);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid managed pi version/);
  }
});
