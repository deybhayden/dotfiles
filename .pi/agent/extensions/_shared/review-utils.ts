import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getEditorKeybindings } from "@mariozechner/pi-tui";

const SELECT_LIST_ACTIONS = [
  "selectUp",
  "selectDown",
  "selectPageUp",
  "selectPageDown",
  "selectConfirm",
  "selectCancel",
] as const;

export function isSelectListActionInput(data: string): boolean {
  const keybindings = getEditorKeybindings();
  return SELECT_LIST_ACTIONS.some((action) =>
    keybindings.matches(data, action),
  );
}

export function tokenizeSpaceSeparated(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let index = 0;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  while (index < input.length) {
    const char = input[index]!;
    const next = index + 1 < input.length ? input[index + 1]! : "";

    if (quote) {
      if (char === "\\" && (next === quote || next === "\\")) {
        current += next;
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
        index += 1;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      // Only treat quotes as delimiters at token boundaries.
      // Apostrophes/quotes inside path text (e.g. docs/it's-good.md) stay literal.
      if (current.length === 0) {
        quote = char;
        index += 1;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }

    if (
      char === "\\" &&
      (next === '"' || next === "'" || next === "\\" || /\s/.test(next))
    ) {
      current += next;
      index += 2;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (quote) {
    current = `${quote}${current}`;
  }

  pushCurrent();
  return tokens;
}

function hasQuotedTokenSyntax(line: string): boolean {
  return /(^|\s)["']/.test(line);
}

export function parseReviewPathsInput(value: string): string[] {
  // Single-line input behaves like shell tokenization: quote or escape spaces
  // to keep them inside a single path token.
  const trimmed = value.trim();
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return tokenizeSpaceSeparated(trimmed);
  }

  const paths: string[] = [];
  for (const line of lines) {
    if (hasQuotedTokenSyntax(line) || line.includes("\\ ")) {
      const parsed = tokenizeSpaceSeparated(line);
      if (parsed.length > 0) {
        paths.push(...parsed);
        continue;
      }
    }
    paths.push(line);
  }

  return paths;
}

export async function hasUpstreamTrackingBranch(
  pi: ExtensionAPI,
  branch: string,
): Promise<boolean> {
  try {
    const { stdout, code } = await pi.exec("git", [
      "rev-parse",
      "--abbrev-ref",
      `${branch}@{upstream}`,
    ]);
    return code === 0 && stdout.trim().length > 0;
  } catch {
    return false;
  }
}
