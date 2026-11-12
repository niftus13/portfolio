import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../../apps/webs/app/utils/markdown.js";

describe("Markdown preview", () => {
  const origin = "https://docs.example.test";

  it("renders supported formatting and safe links without rendering HTML or images", () => {
    const html = renderMarkdown(
      "# Heading\n\n**bold** and `code`\n\n- item\n\n[relative](/guide) [web](https://example.test/) [mail](mailto:a@example.test)\n\n<img src=x onerror=alert(1)> ![image](https://example.test/a.png)",
      origin,
    );
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>item</li>");
    expect(html).toContain('href="/guide"');
    expect(html).toContain('href="https://example.test/"');
    expect(html).toContain('href="mailto:a@example.test"');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("does not create links to unsafe schemes or a different network-path origin", () => {
    const html = renderMarkdown(
      "[script](javascript:alert(1)) [data](data:text/html,test) [external](//evil.example.test/path) [local](//docs.example.test/path)",
      origin,
    );
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('href="//evil.example.test');
    expect(html).toContain('href="//docs.example.test/path"');
  });
});
