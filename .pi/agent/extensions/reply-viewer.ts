import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type Component,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

interface AssistantReplyItem {
  index: number;
  entryId: string;
  timestamp: string;
  text: string;
}

function assistantReplyText(message: AssistantReplyItemMessage): string {
  const parts = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .filter((part) => part.trim().length > 0);

  return parts.join("\n").trim();
}

type AssistantReplyItemMessage = ReturnType<
  ExtensionContext["sessionManager"]["getBranch"]
>[number] extends infer Entry
  ? Entry extends { type: "message"; message: infer Message }
    ? Message extends { role: "assistant" }
      ? Message
      : never
    : never
  : never;

function getAssistantReplies(ctx: ExtensionContext): AssistantReplyItem[] {
  const replies: AssistantReplyItem[] = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "assistant") continue;

    const text = assistantReplyText(message);
    if (!text) continue;

    replies.push({
      index: replies.length + 1,
      entryId: entry.id,
      timestamp: entry.timestamp,
      text,
    });
  }

  return replies;
}

function markdownForReply(
  reply: AssistantReplyItem,
  ctx: ExtensionContext,
): string {
  const sessionFile = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";

  return [
    `# Assistant Reply ${reply.index}`,
    "",
    `- Exported: ${new Date().toISOString()}`,
    `- Reply timestamp: ${reply.timestamp}`,
    `- Entry ID: ${reply.entryId}`,
    `- Working directory: ${ctx.cwd}`,
    `- Session: ${sessionFile}`,
    `- Model: ${model}`,
    "",
    "---",
    "",
    reply.text,
    "",
  ].join("\n");
}

async function writeAndOpenReply(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  reply: AssistantReplyItem,
): Promise<void> {
  const dir = join(homedir(), ".pi", "agent", "last-replies");
  await mkdir(dir, { recursive: true });

  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(
    dir,
    `assistant-reply-${reply.index}-${safeTimestamp}-${randomUUID()}.md`,
  );
  await writeFile(filePath, markdownForReply(reply, ctx), "utf8");

  const result = await pi.exec("code", [
    "--reuse-window",
    "--goto",
    `${filePath}:1:1`,
  ]);
  if (result.code === 0) {
    ctx.ui.notify(
      `Opened assistant reply ${reply.index} in VS Code: ${filePath}`,
      "info",
    );
    return;
  }

  ctx.ui.notify(
    `Wrote assistant reply ${reply.index} to ${filePath}, but failed to run VS Code CLI: ${result.stderr || result.stdout}`,
    "warning",
  );
}

class AssistantReplyPicker implements Component {
  private selected: number;
  private scroll = 0;

  constructor(
    private readonly replies: AssistantReplyItem[],
    private readonly getHeight: () => number,
    private readonly done: (reply: AssistantReplyItem | null) => void,
    private readonly accent: (text: string) => string,
    private readonly muted: (text: string) => string,
    private readonly dim: (text: string) => string,
    private readonly selectedText: (text: string) => string,
    private readonly bold: (text: string) => string,
  ) {
    this.selected = Math.max(0, replies.length - 1);
  }

  handleInput(data: string): void {
    const page = Math.max(1, this.listHeight() - 1);

    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data === "q"
    ) {
      this.done(null);
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.done(this.replies[this.selected] ?? null);
      return;
    }

    if (matchesKey(data, Key.home)) {
      this.selected = 0;
      return;
    }

    if (matchesKey(data, Key.end)) {
      this.selected = this.replies.length - 1;
      return;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.selected = Math.max(0, this.selected - page);
      return;
    }

    if (matchesKey(data, Key.pageDown)) {
      this.selected = Math.min(this.replies.length - 1, this.selected + page);
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1);
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.selected = Math.min(this.replies.length - 1, this.selected + 1);
    }
  }

  render(width: number): string[] {
    const height = this.getHeight();
    const listHeight = this.listHeight();
    const maxScroll = Math.max(0, this.replies.length - listHeight);

    if (this.selected < this.scroll) this.scroll = this.selected;
    if (this.selected >= this.scroll + listHeight)
      this.scroll = this.selected - listHeight + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));

    const header = this.accent(this.bold(" Open assistant reply "));
    const subheader = this.dim(
      " Enter opens selected reply in VS Code · ↑/↓ select · PgUp/PgDn page · Esc/q close ",
    );
    const footer = this.dim(
      ` ${this.selected + 1}/${this.replies.length} selected `,
    );
    const visibleReplies = this.replies.slice(
      this.scroll,
      this.scroll + listHeight,
    );

    const lines = [this.pad(header, width), this.pad(subheader, width)];
    for (const reply of visibleReplies) {
      lines.push(this.renderReply(reply, width));
    }
    while (lines.length < height - 1) {
      lines.push(this.pad("", width));
    }
    lines.push(this.pad(footer, width));

    return lines.slice(0, height);
  }

  invalidate(): void {}

  private listHeight(): number {
    return Math.max(1, this.getHeight() - 3);
  }

  private renderReply(reply: AssistantReplyItem, width: number): string {
    const selected = this.replies[this.selected]?.entryId === reply.entryId;
    const marker = selected ? "›" : " ";
    const label = `${marker} #${reply.index} ${reply.timestamp} `;
    const firstLine =
      reply.text
        .split("\n")
        .find((line) => line.trim().length > 0)
        ?.trim() ?? "(empty)";
    const snippetWidth = Math.max(1, width - visibleWidth(label) - 1);
    const snippet = truncateToWidth(
      firstLine.replace(/\s+/g, " "),
      snippetWidth,
      "…",
    );
    const line = `${label}${snippet}`;

    return this.pad(
      selected ? this.selectedText(line) : this.muted(line),
      width,
    );
  }

  private pad(line: string, width: number): string {
    const clipped = truncateToWidth(line, width, "");
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  }
}

async function openMostRecentReply(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const replies = getAssistantReplies(ctx);
  const reply = replies.at(-1);

  if (!reply) {
    ctx.ui.notify("No assistant replies found in this session.", "warning");
    return;
  }

  await writeAndOpenReply(pi, ctx, reply);
}

async function openReplyPicker(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const replies = getAssistantReplies(ctx);

  if (replies.length === 0) {
    ctx.ui.notify("No assistant replies found in this session.", "warning");
    return;
  }

  const selectedReply = await ctx.ui.custom<AssistantReplyItem | null>(
    (tui, theme, _keybindings, done) =>
      new AssistantReplyPicker(
        replies,
        () => Math.max(8, Math.min(30, Math.floor(tui.terminal.rows * 0.8))),
        done,
        (text) => theme.fg("accent", text),
        (text) => theme.fg("muted", text),
        (text) => theme.fg("dim", text),
        (text) => theme.bg("selectedBg", theme.fg("accent", text)),
        (text) => theme.bold(text),
      ),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "90%",
        maxHeight: "80%",
        margin: 1,
      },
    },
  );

  if (!selectedReply) return;
  await writeAndOpenReply(pi, ctx, selectedReply);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("open-reply", {
    description: "Pick an assistant reply and open it in VS Code",
    handler: async (_args, ctx) => {
      await openReplyPicker(pi, ctx);
    },
  });

  pi.registerCommand("open-last-reply", {
    description: "Open the most recent assistant reply in VS Code",
    handler: async (_args, ctx) => {
      await openMostRecentReply(pi, ctx);
    },
  });

  pi.registerShortcut("alt+home", {
    description: "Open the most recent assistant reply in VS Code",
    handler: async (ctx) => {
      await openMostRecentReply(pi, ctx);
    },
  });
}
