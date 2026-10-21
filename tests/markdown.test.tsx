import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/components/markdown.tsx";

const html = (s: string) => renderToStaticMarkup(createElement(Markdown, { source: s }));

describe("safe Markdown rendering", () => {
  it("renders common structure", () => {
    const out = html("# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two\n\n1. a\n2. b\n\n> quote\n\n---");
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(out).toContain("<ol><li>a</li><li>b</li></ol>");
    expect(out).toContain("<blockquote>quote</blockquote>");
    expect(out).toContain("<hr/>");
  });

  it("never emits raw HTML from the source", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> **ok**');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("<strong>ok</strong>");
  });

  it("only links http(s)/mailto, with safe rel attributes", () => {
    const out = html("[good](https://example.com) [bad](javascript:alert(1)) [data](data:text/html,x)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:text");
  });

  it("keeps fenced code literal", () => {
    const out = html("```\n**not bold** <b>x</b>\n```");
    expect(out).toContain("<pre><code>**not bold** &lt;b&gt;x&lt;/b&gt;</code></pre>");
  });
});

describe("wiki links", () => {
  const withWiki = (s: string) => renderToStaticMarkup(createElement(Markdown, { source: s, wiki: (t: string) => (t === "Known note" ? "n1" : undefined) }));
  it("links known titles to the note and marks unknown ones, without touching other syntax", () => {
    const out = withWiki("See [[Known note]] and [[Missing one]], [site](https://example.com) and **bold**.");
    expect(out).toContain('<a class="wikilink" href="/knowledge/n1">Known note</a>');
    expect(out).toContain('<span class="wikilink-missing" title="No note with this title yet">Missing one</span>');
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>');
    expect(out).toContain("<strong>bold</strong>");
  });
  it("renders plain text when no resolver is given and never injects markup from a title", () => {
    expect(html("a [[<img src=x onerror=alert(1)>]] b")).not.toContain("<img");
  });
});

describe("numbered citations", () => {
  const cited = (s: string) => renderToStaticMarkup(createElement(Markdown, { source: s, cite: (n: number) => n <= 2 }));
  it("turns [n] into chips only for sources that exist, and never touches links", () => {
    const out = cited("Status lives on Request [1]. See also [2] and [7]. A [link](https://example.com).");
    expect(out).toContain('<a href="#src-1" class="cite" aria-label="Source 1">1</a>');
    expect(out).toContain('<a href="#src-2" class="cite" aria-label="Source 2">2</a>');
    expect(out).toContain("[7]"); // no source 7: stays plain text
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
  });
  it("leaves [n] alone when no resolver is given", () => {
    expect(html("See [1] here")).toContain("See [1] here");
  });
});
