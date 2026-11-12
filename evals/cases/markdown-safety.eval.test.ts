import { expect, it } from "vitest";

import { renderMarkdown } from "../../apps/webs/app/utils/markdown.js";

it("keeps representative unsafe Markdown inputs non-executable", () => {
  const cases = [
    "[unsafe](javascript:alert(1))",
    "[unsafe](jav&#x61;script:alert(1))",
    "[unsafe](data:text/html,test)",
    "[unsafe](//outside.example.test/path)",
    "<script>alert(1)</script>",
    "![unsafe](https://outside.example.test/image.png)",
  ];
  for (const input of cases) {
    const result = renderMarkdown(input, "https://docs.example.test");
    expect(result).not.toMatch(/<(?:a|script|img)(?:\s|>)/i);
  }
});
