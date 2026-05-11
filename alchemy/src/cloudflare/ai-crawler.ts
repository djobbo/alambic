import type { AiSearchWebCrawlerSource } from "./ai-search.ts";

/**
 * Parse a URL and extract the domain and path
 */
function parseUrl(url: string): { domain: string; path: string } {
  // Handle URLs with or without protocol
  let normalized = url;
  if (!normalized.includes("://")) {
    normalized = `https://${normalized}`;
  }

  const parsed = new URL(normalized);
  return {
    domain: parsed.hostname,
    path: parsed.pathname,
  };
}

/**
 * Convert a path to a glob pattern for path filtering
 */
function pathToGlobPattern(path: string): string {
  // Remove leading slash for pattern
  const cleanPath = path.replace(/^\//, "");

  if (!cleanPath || cleanPath === "/") {
    // Root path - no filtering needed
    return "**";
  }

  // Create a pattern that matches this path and its children
  return `**/${cleanPath}**`;
}

/**
 * Builds an AiSearchWebCrawlerSource configuration from URLs.
 *
 * This is a convenience helper that parses URLs and extracts the domain
 * and path filters for use with AiSearch.
 *
 * @example
 * // Crawl an entire domain
 * const search = await AiSearch("docs-search", {
 *   source: AiCrawler(["https://docs.example.com"]),
 * });
 *
 * @example
 * // Crawl specific paths on a domain
 * const search = await AiSearch("blog-search", {
 *   source: AiCrawler([
 *     "https://example.com/blog",
 *     "https://example.com/news",
 *   ]),
 * });
 *
 * @param urls - URLs to crawl. All URLs must be from the same domain.
 * @returns An AiSearchWebCrawlerSource configuration object
 */
export function AiCrawler(urls: string[]): AiSearchWebCrawlerSource {
  if (!urls || urls.length === 0) {
    throw new Error("AiCrawler requires at least one URL");
  }

  // Parse all URLs
  const parsed = urls.map(parseUrl);

  // Verify all URLs are from the same domain
  const domains = new Set(parsed.map((p) => p.domain));
  if (domains.size > 1) {
    throw new Error(
      `All URLs must be from the same domain. Found: ${[...domains].join(", ")}`,
    );
  }

  const domain = parsed[0].domain;

  // Build include paths from URL paths
  // Only add path filters if we have specific paths (not just root)
  const paths = parsed.map((p) => p.path).filter((p) => p && p !== "/");
  const includePaths =
    paths.length > 0 ? paths.map(pathToGlobPattern) : undefined;

  return {
    type: "web-crawler",
    domain,
    includePaths,
  };
}
