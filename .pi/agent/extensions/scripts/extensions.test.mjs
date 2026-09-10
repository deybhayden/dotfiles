import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  discoverAndLoadExtensions,
  initTheme,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "pi-extension-tests-"));
const cwd = join(temporary, "project");
await mkdir(cwd);
// Never use a caller's shared todo directory or start theme file watchers.
process.env.PI_TODO_PATH = join(temporary, "todos");
initTheme("dark", false);
const paths = (await readdir(root))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(root, name));
const loaded = await discoverAndLoadExtensions(
  paths,
  cwd,
  join(temporary, "agent"),
);
after(() => rm(temporary, { recursive: true, force: true }));

function extension(name) {
  const found = loaded.extensions.find(
    (item) => basename(item.path) === `${name}.ts`,
  );
  assert.ok(found, `Extension ${name} loaded`);
  return found;
}

function tool(file, name) {
  return extension(file).tools.get(name).definition;
}

const theme = { fg: (_color, text) => text };
function customLoader(factory) {
  return new Promise((resolve) => {
    let component;
    component = factory({ requestRender() {} }, theme, {}, (result) => {
      component?.dispose?.();
      resolve(result);
    });
  });
}

function context(mode = "tui") {
  return {
    cwd,
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    sessionManager: SessionManager.inMemory(cwd),
    ui: { notify() {} },
  };
}

async function execute(definition, params, ctx = context(), signal) {
  return definition.execute("test-call", params, signal, undefined, ctx);
}

test("all extensions load with the installed pi runtime", () => {
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, paths.length);
  assert.equal(loaded.extensions.flatMap((item) => [...item.tools]).length, 6);
});

test("terminal-only commands do not enter custom UI in RPC mode", async () => {
  for (const [file, name, args] of [
    ["answer", "answer", ""],
    ["handoff", "handoff", "next task"],
    ["review", "review", ""],
    ["security-review", "security-review", ""],
    ["simplify", "simplify", ""],
    ["review-fix-loop", "review-fix-loop", ""],
    ["reply-viewer", "open-reply", ""],
  ]) {
    const ctx = context("rpc");
    let notices = 0;
    ctx.ui.notify = () => notices++;
    ctx.ui.custom = () => assert.fail(`${name} attempted terminal UI in RPC`);
    await extension(file).commands.get(name).handler(args, ctx);
    assert.equal(notices, 1, name);
  }
});

test("handoff uses provider runtime, compacted context, and replacement context", async () => {
  const ctx = context();
  ctx.model = { id: "custom-model", provider: "custom-provider" };
  ctx.sessionManager.appendMessage({
    role: "user",
    content: "discarded history",
    timestamp: 1,
  });
  const kept = ctx.sessionManager.appendMessage({
    role: "user",
    content: "retained history",
    timestamp: 2,
  });
  ctx.sessionManager.appendCompaction("compacted summary", kept, 100);
  ctx.sessionManager.appendCustomMessageEntry(
    "note",
    "extension context",
    false,
  );
  let modelCalls = 0;
  ctx.modelRegistry = {
    async complete(model, input, options) {
      modelCalls++;
      assert.equal(model, ctx.model);
      assert.match(input.messages[0].content[0].text, /compacted summary/);
      assert.match(input.messages[0].content[0].text, /retained history/);
      assert.match(input.messages[0].content[0].text, /extension context/);
      assert.doesNotMatch(
        input.messages[0].content[0].text,
        /discarded history/,
      );
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.cacheRetention, "none");
      assert.ok(options.sessionId);
      return {
        stopReason: "stop",
        content: [{ type: "text", text: "generated handoff" }],
      };
    },
  };
  let stale = false;
  ctx.ui = new Proxy(
    {
      custom: customLoader,
      async editor(_title, draft) {
        assert.equal(draft, "generated handoff");
        return "edited handoff";
      },
      notify() {},
    },
    {
      get(target, key) {
        assert.equal(
          stale,
          false,
          `Old UI accessed after session replacement: ${String(key)}`,
        );
        return target[key];
      },
    },
  );
  let draft;
  ctx.newSession = async ({ withSession }) => {
    stale = true;
    await withSession({
      ui: {
        setEditorText: (text) => {
          draft = text;
        },
        notify() {},
      },
    });
    return { cancelled: false };
  };
  await extension("handoff").commands.get("handoff").handler("next task", ctx);
  assert.equal(modelCalls, 1);
  assert.equal(draft, "edited handoff");
});

test("answer extraction calls the session's provider runtime", async () => {
  const ctx = context();
  ctx.model = { id: "custom-model", provider: "custom-provider" };
  ctx.sessionManager.appendMessage({
    role: "assistant",
    stopReason: "stop",
    timestamp: 1,
    content: [{ type: "text", text: "Do you want tests?" }],
  });
  let called = false;
  ctx.modelRegistry = {
    find: () => undefined,
    async complete(model, _input, options) {
      called = true;
      assert.equal(model, ctx.model);
      assert.ok(options.signal instanceof AbortSignal);
      return {
        stopReason: "stop",
        content: [{ type: "text", text: '{"questions":[]}' }],
      };
    },
  };
  ctx.ui.custom = customLoader;
  await extension("answer").commands.get("answer").handler("", ctx);
  assert.equal(called, true);
});

test("tool failures reject instead of returning successful error-shaped results", async () => {
  await assert.rejects(
    execute(tool("github", "github_pr"), {
      action: "get_pull_request",
      pull_request_number: 0,
    }),
    /GitHub request failed/,
  );
  await assert.rejects(
    execute(tool("bitbucket", "bitbucket_pr"), {
      action: "get_pull_request",
      pull_request_id: 0,
    }),
    /Bitbucket request failed/,
  );
  await assert.rejects(
    execute(tool("web-search", "web_search"), { query: " " }),
    /query is required/,
  );
  await assert.rejects(
    execute(tool("web-search", "fetch_url"), { url: "not-a-url" }),
    /Failed to fetch/,
  );
  await assert.rejects(
    execute(tool("todos", "todo"), { action: "get" }),
    /id required/,
  );
});

test("fetch_url forwards cancellation and honors already-aborted signals", async (t) => {
  const fetchTool = tool("web-search", "fetch_url");
  let calls = 0;
  let requestSignal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    requestSignal = options.signal;
    return {
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: () =>
        new Promise((_resolve, reject) => {
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal.reason),
            { once: true },
          );
        }),
    };
  });
  const controller = new AbortController();
  const pending = execute(
    fetchTool,
    { url: "https://example.com" },
    context(),
    controller.signal,
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error("cancelled by test"));
  await assert.rejects(pending, /cancelled by test/);
  assert.equal(requestSignal.aborted, true);
  await assert.rejects(
    execute(
      fetchTool,
      { url: "https://example.com" },
      context(),
      controller.signal,
    ),
    /cancelled by test/,
  );
  assert.equal(calls, 1);
});

test("fetch_url extracts HTML with the updated runtime dependencies", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        "<html><head><title>Test article</title></head><body><article><h1>Test article</h1><p>" +
          "This article describes testing extensions with the current pi runtime. ".repeat(
            20,
          ) +
          '</p><p><a href="https://example.com/reference">Reference</a></p></article></body></html>',
        { headers: { "content-type": "text/html" } },
      ),
  );
  const result = await execute(tool("web-search", "fetch_url"), {
    url: "https://example.com/article",
    includeLinks: true,
  });
  assert.equal(result.details.title, "Test article");
  assert.match(result.content[0].text, /testing extensions/);
  assert.match(result.content[0].text, /https:\/\/example.com\/reference/);
});

test("web renderers show both current and persisted legacy errors", () => {
  for (const name of ["web_search", "fetch_url"]) {
    const definition = tool("web-search", name);
    for (const legacy of [false, true]) {
      const result = {
        content: [{ type: "text", text: "request failed" }],
        details: legacy ? { error: "request failed" } : undefined,
      };
      const component = definition.renderResult(
        result,
        { expanded: false, isPartial: false },
        theme,
        { isError: !legacy },
      );
      assert.match(component.render(80).join("\n"), /request failed/);
    }
  }
});

test("parallel todo appends preserve every update", async () => {
  const ctx = context();
  const todo = tool("todos", "todo");
  const created = await execute(
    todo,
    { action: "create", title: "Parallel updates" },
    ctx,
  );
  const id = created.details.todo.id;
  await Promise.all(
    ["first", "second", "third"].map((body) =>
      execute(todo, { action: "append", id, body }, ctx),
    ),
  );
  const result = await execute(todo, { action: "get", id }, ctx);
  assert.match(result.details.todo.body, /first/);
  assert.match(result.details.todo.body, /second/);
  assert.match(result.details.todo.body, /third/);
});
