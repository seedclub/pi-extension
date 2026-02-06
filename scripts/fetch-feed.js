#!/usr/bin/env node

/**
 * Fetch and parse an RSS/Atom/JSON feed into normalized JSON.
 *
 * Usage:
 *   ./scripts/fetch-feed.js <url> [--limit 10]
 *
 * Output: JSON to stdout with { title, link, items[] }
 * Each item: { title, link, pubDate, description, author, guid, categories }
 */

const url = process.argv[2];
const limitIdx = process.argv.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) || 10 : 10;

if (!url) {
  console.error("Usage: fetch-feed.js <url> [--limit 10]");
  console.error("");
  console.error("Fetch and parse an RSS/Atom/JSON feed into normalized JSON.");
  console.error("");
  console.error("Examples:");
  console.error("  fetch-feed.js https://stratechery.com/feed/");
  console.error("  fetch-feed.js https://reddit.com/r/startups/.rss --limit 5");
  console.error("  fetch-feed.js https://github.com/torvalds.atom");
  process.exit(1);
}

async function main() {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Seed-Network/1.0; +https://seed.club)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/xml, */*",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${response.statusText}`);
    process.exit(1);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const body = await response.text();

  let result;
  if (contentType.includes("json") || body.trimStart().startsWith("{")) {
    result = parseJsonFeed(body);
  } else if (body.includes("<feed") && body.includes("xmlns=\"http://www.w3.org/2005/Atom\"")) {
    result = parseAtom(body);
  } else {
    result = parseRss(body);
  }

  result.items = result.items.slice(0, limit);
  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// RSS 2.0 parser
// ---------------------------------------------------------------------------

function parseRss(xml) {
  const title = extractTag(xml, "channel", "title") || extractFirstTag(xml, "title") || "";
  const link = extractTag(xml, "channel", "link") || extractFirstTag(xml, "link") || "";

  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    items.push({
      title: cleanText(extractFirstTag(itemXml, "title")),
      link: cleanText(extractFirstTag(itemXml, "link")),
      pubDate: normalizeDate(extractFirstTag(itemXml, "pubDate") || extractFirstTag(itemXml, "dc:date")),
      description: truncate(stripHtml(cleanText(extractCdata(itemXml, "description") || extractFirstTag(itemXml, "description"))), 500),
      author: cleanText(extractFirstTag(itemXml, "dc:creator") || extractFirstTag(itemXml, "author")),
      guid: cleanText(extractFirstTag(itemXml, "guid")) || cleanText(extractFirstTag(itemXml, "link")),
      categories: extractAllTags(itemXml, "category").map(cleanText),
    });
  }

  return { title: cleanText(title), link: cleanText(link), items };
}

// ---------------------------------------------------------------------------
// Atom parser
// ---------------------------------------------------------------------------

function parseAtom(xml) {
  const title = extractFirstTag(xml, "title") || "";
  // Atom <link> uses href attribute
  const linkMatch = xml.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/);
  const link = linkMatch ? linkMatch[1] : (extractAtomLink(xml) || "");

  const items = [];
  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const entryLink = extractAtomLink(entryXml);
    items.push({
      title: cleanText(extractFirstTag(entryXml, "title")),
      link: entryLink,
      pubDate: normalizeDate(extractFirstTag(entryXml, "published") || extractFirstTag(entryXml, "updated")),
      description: truncate(stripHtml(cleanText(extractCdata(entryXml, "content") || extractFirstTag(entryXml, "summary") || extractFirstTag(entryXml, "content"))), 500),
      author: cleanText(extractFirstTag(entryXml, "name")),
      guid: cleanText(extractFirstTag(entryXml, "id")) || entryLink,
      categories: extractAtomCategories(entryXml),
    });
  }

  return { title: cleanText(title), link, items };
}

// ---------------------------------------------------------------------------
// JSON Feed parser (https://www.jsonfeed.org/version/1.1/)
// ---------------------------------------------------------------------------

function parseJsonFeed(text) {
  const feed = JSON.parse(text);
  return {
    title: feed.title || "",
    link: feed.home_page_url || feed.feed_url || "",
    items: (feed.items || []).map((item) => ({
      title: item.title || "",
      link: item.url || item.external_url || "",
      pubDate: normalizeDate(item.date_published || item.date_modified),
      description: truncate(stripHtml(item.content_text || item.content_html || item.summary || ""), 500),
      author: item.authors?.[0]?.name || item.author?.name || "",
      guid: item.id || item.url || "",
      categories: item.tags || [],
    })),
  };
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function extractFirstTag(xml, tag) {
  // Handle CDATA first
  const cdataResult = extractCdata(xml, tag);
  if (cdataResult) return cdataResult;

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractTag(xml, parent, tag) {
  const parentRegex = new RegExp(`<${parent}[\\s>]([\\s\\S]*?)<\\/${parent}>`, "i");
  const parentMatch = xml.match(parentRegex);
  if (!parentMatch) return null;
  return extractFirstTag(parentMatch[1], tag);
}

function extractCdata(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAllTags(xml, tag) {
  const results = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) results.push(text);
  }
  return results;
}

function extractAtomLink(xml) {
  // Prefer alternate link, fall back to any href
  const altMatch = xml.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/);
  if (altMatch) return altMatch[1];
  const hrefMatch = xml.match(/<link[^>]+href=["']([^"']+)["']/);
  return hrefMatch ? hrefMatch[1] : "";
}

function extractAtomCategories(xml) {
  const results = [];
  const regex = /<category[^>]+term=["']([^"']+)["'][^>]*\/?>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

function stripHtml(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || "";
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr.trim());
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
