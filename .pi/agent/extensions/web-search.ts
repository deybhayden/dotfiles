import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SearchTypes = ["web", "news"] as const;
type SearchType = (typeof SearchTypes)[number];

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 15;
const DEFAULT_MARKET = "en-US";
const REQUEST_TIMEOUT_MS = 15_000;

const WebSearchParams = Type.Object({
  query: Type.String({
    description:
      "Search query. Include specifics (e.g., year, framework, country) for better results.",
  }),
  type: Type.Optional(StringEnum(SearchTypes) as any),
  max_results: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_RESULTS_LIMIT,
      description: `Maximum number of results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_LIMIT}).`,
    }),
  ),
  market: Type.Optional(
    Type.String({
      description:
        "Bing market/locale (default en-US), e.g. en-US, en-GB, de-DE.",
    }),
  ),
}) as any;

interface WebSearchToolInput {
  query: string;
  type?: SearchType;
  max_results?: number;
  market?: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
}

interface WebSearchDetails {
  query: string;
  type: SearchType;
  market: string;
  endpoint: string;
  maxResults: number;
  resultCount: number;
  results: SearchResult[];
  truncation?: TruncationResult;
  fullOutputPath?: string;
  error?: string;
}

function clampResultCount(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS_LIMIT, Math.floor(value!)));
}

function normalizeSearchType(value?: string): SearchType {
  return value === "news" ? "news" : "web";
}

function normalizeMarket(value?: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_MARKET;
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : match;
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : match;
    }

    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function cleanText(value: string | undefined): string {
  if (!value) return "";
  const cdataMatch = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  const unwrapped = cdataMatch ? cdataMatch[1] : value;
  return stripTags(decodeXmlEntities(unwrapped)).replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTag(xmlBlock: string, tagName: string): string | undefined {
  const pattern = new RegExp(
    `<${escapeRegExp(tagName)}>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`,
    "i",
  );
  const match = xmlBlock.match(pattern);
  return match?.[1];
}

function decodeBingUParam(value: string): string | undefined {
  const decoded = decodeURIComponent(value);
  if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
    return decoded;
  }

  if (!decoded.startsWith("a1")) {
    return undefined;
  }

  const base64Payload = decoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64Payload.length % 4)) % 4);

  try {
    const candidate = Buffer.from(base64Payload + padding, "base64").toString(
      "utf8",
    );
    return candidate.startsWith("http://") || candidate.startsWith("https://")
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

function unwrapBingRedirectUrl(link: string): string {
  try {
    const parsed = new URL(link);
    if (!parsed.hostname.endsWith("bing.com")) {
      return link;
    }

    const encodedUrl = parsed.searchParams.get("url");
    if (encodedUrl) {
      return decodeURIComponent(encodedUrl);
    }

    const encodedU = parsed.searchParams.get("u");
    if (encodedU) {
      return decodeBingUParam(encodedU) ?? link;
    }

    return link;
  } catch {
    return link;
  }
}

function buildBingRssUrl(query: string, type: SearchType, market: string): URL {
  const baseUrl =
    type === "news"
      ? "https://www.bing.com/news/search"
      : "https://www.bing.com/search";

  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  if (market) {
    url.searchParams.set("mkt", market);
  }
  return url;
}

async function fetchWithTimeout(
  url: URL,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const abortHandler = () => controller.abort();
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/rss+xml, application/xml, text/xml;q=0.9",
        "user-agent": "pi-web-search-extension/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Request failed (${response.status} ${response.statusText})`,
      );
    }

    return await response.text();
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
}

function parseBingRss(xml: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) && results.length < maxResults) {
    const item = match[1];

    const title = cleanText(extractTag(item, "title"));
    const rawUrl = cleanText(extractTag(item, "link"));
    const snippet = cleanText(extractTag(item, "description"));
    const publishedAt = cleanText(extractTag(item, "pubDate"));
    const source = cleanText(extractTag(item, "News:Source"));

    if (!title || !rawUrl) {
      continue;
    }

    const url = unwrapBingRedirectUrl(rawUrl);
    if (!url || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);

    results.push({
      title,
      url,
      snippet,
      publishedAt: publishedAt || undefined,
      source: source || undefined,
    });
  }

  return results;
}

function formatResultsForAgent(
  query: string,
  type: SearchType,
  market: string,
  results: SearchResult[],
): string {
  if (!results.length) {
    return `No ${type} results found for "${query}".`;
  }

  const lines: string[] = [
    `${type === "news" ? "News" : "Web"} search results for "${query}" (market: ${market})`,
    "",
  ];

  for (const [index, result] of results.entries()) {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`   URL: ${result.url}`);
    if (result.source) {
      lines.push(`   Source: ${result.source}`);
    }
    if (result.publishedAt) {
      lines.push(`   Published: ${result.publishedAt}`);
    }
    if (result.snippet) {
      lines.push(`   Snippet: ${result.snippet}`);
    }
    lines.push("");
  }

  lines.push(
    "Tip: open primary sources for details and cross-check claims across multiple outlets.",
  );
  return lines.join("\n").trim();
}

export default function webSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      `Search the live web or news via Bing RSS for up-to-date research (e.g., 2026 best practices, current events). ` +
      `Use type="news" for current events. Returns title, URL, snippet, and publication metadata when available. ` +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first).`,
    parameters: WebSearchParams,

    async execute(_toolCallId, rawParams, signal, onUpdate) {
      const params = rawParams as WebSearchToolInput;
      const query = params.query?.trim();
      const type = normalizeSearchType(params.type);
      const maxResults = clampResultCount(params.max_results);
      const market = normalizeMarket(params.market);

      const baseDetails: Omit<WebSearchDetails, "endpoint" | "resultCount"> = {
        query: query ?? "",
        type,
        market,
        maxResults,
        results: [],
      };

      if (!query) {
        return {
          content: [{ type: "text", text: "Error: query is required." }],
          details: {
            ...baseDetails,
            endpoint: "",
            resultCount: 0,
            error: "query is required",
          },
          isError: true,
        };
      }

      const endpoint = buildBingRssUrl(query, type, market);
      onUpdate?.({
        content: [
          { type: "text", text: `Searching ${type} for "${query}"...` },
        ],
        details: {},
      });

      try {
        const xml = await fetchWithTimeout(endpoint, signal);
        const results = parseBingRss(xml, maxResults);

        const details: WebSearchDetails = {
          ...baseDetails,
          query,
          endpoint: endpoint.toString(),
          resultCount: results.length,
          results,
        };

        const fullText = formatResultsForAgent(query, type, market, results);
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

        return {
          content: [{ type: "text", text: outputText }],
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return {
          content: [{ type: "text", text: `Web search failed: ${message}` }],
          details: {
            ...baseDetails,
            query,
            endpoint: endpoint.toString(),
            resultCount: 0,
            error: message,
          },
          isError: true,
        };
      }
    },
  });
}
