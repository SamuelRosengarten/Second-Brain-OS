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
