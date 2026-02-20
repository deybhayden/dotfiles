import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Constants ─────────────────────────────────────────────────────

const BRAVE_API_BASE = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LENGTH = 15_000;

// ─── Brave Search types ────────────────────────────────────────────

interface BraveSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface BraveSearchDetails {
  query: string;
  provider: string;
  count: number;
  freshness?: string;
  country?: string;
  results: BraveSearchResult[];
  urls: string[];
  truncation?: TruncationResult;
  fullOutputPath?: string;
  error?: string;
}

// ─── Fetch URL types ───────────────────────────────────────────────

interface FetchResult {
  title: string;
  content: string;
  byline: string;
  length: number;
  url: string;
}

interface FetchUrlDetails {
  url: string;
  title?: string;
  extractedLength?: number;
  originalLength?: number;
  selector?: string;
  error?: string;
}

// ─── Brave Search ──────────────────────────────────────────────────

function getBraveApiKey(): string | undefined {
  return process.env.BRAVE_API_KEY;
}

async function braveSearch(
  query: string,
  opts: {
    count?: number;
    freshness?: string;
    country?: string;
  },
  signal?: AbortSignal,
): Promise<BraveSearchResult[]> {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    throw new Error(
      "BRAVE_API_KEY environment variable is not set. " +
        "Get a free API key at https://brave.com/search/api/",
    );
  }

  const count = Math.max(
    1,
    Math.min(MAX_RESULTS_LIMIT, opts.count ?? DEFAULT_MAX_RESULTS),
  );
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    text_decorations: "false",
  });
  if (opts.freshness) params.set("freshness", opts.freshness);
  if (opts.country) params.set("country", opts.country);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortHandler = () => controller.abort();
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const response = await fetch(`${BRAVE_API_BASE}?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Brave Search API error: HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await response.json()) as any;
    const results: BraveSearchResult[] = [];

    for (const item of data.web?.results ?? []) {
      results.push({
        title: item.title || "",
        url: item.url || "",
        snippet: item.description || "",
      });
    }

    return results;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(
        `Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
}

// ─── Fetch & Extract ───────────────────────────────────────────────

async function fetchAndExtract(
  url: string,
  opts: { selector?: string; maxLength?: number; includeLinks?: boolean },
): Promise<FetchResult> {
  const { Readability } = await import("@mozilla/readability");
  const { JSDOM } = await import("jsdom");
  const TurndownService = (await import("turndown")).default;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  // Non-HTML: return raw text
  if (!contentType.includes("html")) {
    const raw = await response.text();
    const maxLen = opts.maxLength ?? DEFAULT_MAX_LENGTH;
    return {
      title: url,
      content: raw.slice(0, maxLen),
      byline: "",
      length: raw.length,
      url,
    };
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });

  if (opts.selector) {
    const selected = dom.window.document.querySelector(opts.selector);
    if (selected) {
      dom.window.document.body.innerHTML = selected.outerHTML;
    }
  }

  const article = new Readability(dom.window.document).parse();
  if (!article || !article.content) {
    throw new Error("Readability could not extract content from this page");
  }

  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  td.addRule("removeImages", { filter: "img", replacement: () => "" });

  if (!opts.includeLinks) {
    td.addRule("stripLinks", {
      filter: "a",
      replacement: (_content: string, node: any) => node.textContent || "",
    });
  }

  let markdown = td.turndown(article.content);

  markdown = markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^#+\s*$/gm, "")
    .replace(/^(Share|Tweet|Pin|Email|Print)(\s+(this|on|via))?.{0,20}$/gim, "")
    .replace(/^.*(cookie|consent|privacy policy|accept all).*$/gim, "")
    .trim();

  const maxLen = opts.maxLength ?? DEFAULT_MAX_LENGTH;
  if (markdown.length > maxLen) {
    markdown = markdown.slice(0, maxLen) + "\n\n[... truncated]";
  }

  return {
    title: article.title || "",
    content: markdown,
    byline: article.byline || "",
    length: article.length || markdown.length,
    url,
  };
}

// ─── Formatting helpers ────────────────────────────────────────────

function formatSearchResults(
  query: string,
  results: BraveSearchResult[],
): string {
  if (!results.length) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [
    `Search: "${query}" via Brave (${results.length} results)`,
    "",
  ];

  for (const [index, result] of results.entries()) {
    lines.push(`${index + 1}. **${result.title}**`);
    lines.push(`   ${result.url}`);
    if (result.snippet) {
      lines.push(`   ${result.snippet}`);
    }
    lines.push("");
  }

  lines.push("Use fetch_url to read the full content of specific results.");
  return lines.join("\n").trim();
}

// ─── Extension ─────────────────────────────────────────────────────

export default function webSearchExtension(pi: ExtensionAPI) {
  // ── Tool 1: web_search (Brave) ─────────────────────────────────

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      `Search the web using Brave Search API. Returns a list of results (title, url, snippet). ` +
      `Requires BRAVE_API_KEY env var. Use fetch_url to read specific pages from the results. ` +
      `Supports freshness filters: "pd" (day), "pw" (week), "pm" (month), "py" (year), or date ranges like "2024-01-01to2024-06-30". ` +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first).`,
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search query. Include specifics (e.g., year, framework, country) for better results.",
      }),
      count: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_RESULTS_LIMIT,
          description: `Number of results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_LIMIT}).`,
        }),
      ),
      freshness: Type.Optional(
        Type.String({
          description:
            'Freshness filter: "pd" (day), "pw" (week), "pm" (month), "py" (year), or "YYYY-MM-DDtoYYYY-MM-DD".',
        }),
      ),
      country: Type.Optional(
        Type.String({
          description:
            "Two-letter country code for localized results (e.g., US, GB, DE).",
        }),
      ),
    }) as any,

    async execute(_toolCallId, rawParams, signal, onUpdate) {
      const params = rawParams as {
        query: string;
        count?: number;
        freshness?: string;
        country?: string;
      };

      const query = params.query?.trim();
      if (!query) {
        return {
          content: [{ type: "text", text: "Error: query is required." }],
          details: {
            error: "query is required",
          } satisfies Partial<BraveSearchDetails>,
          isError: true,
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Searching Brave for "${query}"...` }],
        details: {},
      });

      try {
        const results = await braveSearch(
          query,
          {
            count: params.count,
            freshness: params.freshness,
            country: params.country,
          },
          signal,
        );

        const details: BraveSearchDetails = {
          query,
          provider: "brave",
          count: results.length,
          freshness: params.freshness,
          country: params.country,
          results,
          urls: results.map((r) => r.url),
        };

        const fullText = formatSearchResults(query, results);
        const truncation = truncateHead(fullText, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let outputText = truncation.content;
        if (truncation.truncated) {
          const tempDir = mkdtempSync(join(tmpdir(), "pi-web-search-"));
          const tempFile = join(tempDir, "results.txt");
          writeFileSync(tempFile, fullText, "utf8");

          details.truncation = truncation;
          details.fullOutputPath = tempFile;

          outputText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
          outputText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
          outputText += ` Full output saved to: ${tempFile}]`;
        }

        return { content: [{ type: "text", text: outputText }], details };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Web search failed: ${message}` }],
          details: {
            query,
            provider: "brave",
            count: 0,
            results: [],
            urls: [],
            error: message,
          } satisfies BraveSearchDetails,
          isError: true,
        };
      }
    },

    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("web_search "));
      text += theme.fg("accent", `"${args.query || "..."}"`);
      if (args.freshness)
        text += theme.fg("muted", ` freshness=${args.freshness}`);
      if (args.country) text += theme.fg("muted", ` country=${args.country}`);
      if (args.count) text += theme.fg("dim", ` (${args.count} results)`);
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = result.details as BraveSearchDetails | undefined;
      if (details?.error) {
        return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
      }

      let text = theme.fg("success", "✓ ");
      text += theme.fg("muted", `${details?.count ?? "?"} results via Brave`);

      if (expanded) {
        const content = result.content[0];
        if (content?.type === "text") {
          text += "\n\n" + theme.fg("toolOutput", content.text);
        }
      } else if (details?.urls?.length) {
        const preview = details.urls.slice(0, 3).join("\n  ");
        text += "\n  " + theme.fg("dim", preview);
        if (details.urls.length > 3) {
          text += theme.fg("muted", `\n  ... +${details.urls.length - 3} more`);
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── Tool 2: fetch_url ──────────────────────────────────────────

  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch a URL and return clean, readable content as Markdown. " +
      "Uses Mozilla Readability to strip navigation, ads, and boilerplate. " +
      "Use `selector` to extract a specific section (CSS selector). " +
      "Use `maxLength` to limit output size (default: 15000 chars). " +
      "Set `includeLinks: true` to preserve hyperlinks (stripped by default to save tokens).",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      selector: Type.Optional(
        Type.String({
          description:
            "CSS selector to narrow extraction (e.g. 'main', '.docs-content', '#api-reference')",
        }),
      ),
      maxLength: Type.Optional(
        Type.Number({
          description: "Max characters to return. Default: 15000",
        }),
      ),
      includeLinks: Type.Optional(
        Type.Boolean({
          description:
            "Keep hyperlinks in output. Default: false (saves tokens)",
        }),
      ),
    }) as any,

    async execute(_toolCallId, rawParams, _signal) {
      const params = rawParams as {
        url: string;
        selector?: string;
        maxLength?: number;
        includeLinks?: boolean;
      };

      try {
        const result = await fetchAndExtract(params.url, {
          selector: params.selector,
          maxLength: params.maxLength,
          includeLinks: params.includeLinks,
        });

        const header = [
          result.title && `# ${result.title}`,
          result.byline && `*${result.byline}*`,
          `Source: ${result.url}`,
          `Extracted: ${result.content.length} chars from ${result.length} original`,
        ]
          .filter(Boolean)
          .join("\n");

        const text = `${header}\n\n---\n\n${result.content}`;

        const truncation = truncateHead(text, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let output = truncation.content;
        if (truncation.truncated) {
          const tempDir = mkdtempSync(join(tmpdir(), "pi-fetch-url-"));
          const tempFile = join(tempDir, "content.md");
          writeFileSync(tempFile, text, "utf8");

          output += `\n\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines, `;
          output += `${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}. `;
          output += `Full output saved to: ${tempFile}]`;
        }

        const details: FetchUrlDetails = {
          url: result.url,
          title: result.title,
          extractedLength: result.content.length,
          originalLength: result.length,
          selector: params.selector,
        };
        return {
          content: [{ type: "text", text: output }],
          details,
        };
      } catch (err: any) {
        const details: FetchUrlDetails = {
          url: params.url,
          error: err.message,
        };
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch ${params.url}: ${err.message}`,
            },
          ],
          details,
          isError: true,
        };
      }
    },

    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("fetch_url "));
      text += theme.fg("accent", args.url || "...");
      if (args.selector) text += theme.fg("muted", ` → ${args.selector}`);
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = result.details as FetchUrlDetails | undefined;
      if (details?.error) {
        return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
      }

      let text = theme.fg("success", "✓ ");
      if (details?.title) text += theme.fg("toolTitle", details.title) + " ";
      text += theme.fg("muted", `(${details?.extractedLength ?? "?"} chars`);
      if (details?.selector)
        text += theme.fg("muted", `, selector: ${details.selector}`);
      text += theme.fg("muted", ")");

      if (expanded) {
        const content = result.content[0];
        if (content?.type === "text") {
          text += "\n\n" + theme.fg("toolOutput", content.text.slice(0, 2000));
          if (content.text.length > 2000) {
            text += theme.fg("muted", "\n... (truncated in preview)");
          }
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
