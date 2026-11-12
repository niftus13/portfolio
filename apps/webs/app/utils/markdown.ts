import MarkdownIt from "markdown-it";

export function renderMarkdown(content: string, origin: string): string {
  const parser = new MarkdownIt({ html: false, breaks: true, linkify: false });
  parser.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    if (!token) throw new Error("Missing Markdown image token");
    return parser.utils.escapeHtml(token.content);
  };
  parser.validateLink = (href) => {
    try {
      const target = new URL(href, origin);
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        return ["http:", "https:", "mailto:"].includes(target.protocol);
      }
      return target.origin === new URL(origin).origin;
    } catch {
      return false;
    }
  };
  return parser.render(content);
}
