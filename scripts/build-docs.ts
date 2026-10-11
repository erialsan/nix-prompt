/**
 * Markdown のドキュメントを `web/dist/docs/` へ HTML 化します。
 *
 *   bun run web:docs
 *
 * GitHub Pages を「アプリ（/）」と「ドキュメント（/docs/）」の同一サイトにするため、
 * Jekyll を使わず marked で静的にレンダリングします（Ruby 不要・依存は marked のみ）。
 * 見出しアンカーは GitHub と同じ規則で振るので、`docs/spec.md#tags-のカテゴリ` の
 * ような既存リンクがそのまま動きます。
 */
import fs from "node:fs";
import path from "node:path";
import { marked, type Tokens } from "marked";

const root = path.resolve(import.meta.dir, "..");
const docsSourceDir = path.join(root, "docs");
const outDir = path.join(root, "web", "dist", "docs");
const repoUrl = "https://github.com/erialsan/nix-prompt";

/** サイドバーの並び順。`README.md` はリポジトリ直下の README。 */
const PAGES: { source: string; out: string; label: string }[] = [
  { source: "README.md", out: "readme.html", label: "概要（README）" },
  { source: "docs/README.md", out: "index.html", label: "説明書（目次）" },
  { source: "docs/tutorial.md", out: "tutorial.html", label: "チュートリアル" },
  { source: "docs/dsl.md", out: "dsl.html", label: "DSL リファレンス" },
  { source: "docs/spec.md", out: "spec.html", label: "プロンプト仕様" },
  { source: "docs/models.md", out: "models.html", label: "モデル" },
  { source: "docs/cli.md", out: "cli.html", label: "CLI リファレンス" },
  { source: "docs/web.md", out: "web.html", label: "Web UI" },
  { source: "docs/design.md", out: "design.html", label: "内部設計" },
];

// ── アンカー（GitHub 互換の slug） ──────────────────────────────────
const slugCounts = new Map<string, number>();

function slugify(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
  const seen = slugCounts.get(base) ?? 0;
  slugCounts.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

// ── リンクの書き換え（すべて /docs/ 配下に出力する前提） ─────────────
function rewriteLink(href: string): string {
  if (/^(https?:|mailto:|#|\/)/.test(href)) return href;
  const [pathPart, ...anchor] = href.split("#");
  const hash = anchor.length > 0 ? `#${anchor.join("#")}` : "";
  if (pathPart === "") return href;
  let target = pathPart.replace(/^\.\//, "").replace(/^docs\//, "");
  if (target === "README.md") target = "index.html";
  else target = target.replace(/\.md$/, ".html");
  return `${target}${hash}`;
}

type TocEntry = { depth: number; id: string; text: string };

function renderMarkdown(markdown: string): { html: string; toc: TocEntry[] } {
  slugCounts.clear();
  const toc: TocEntry[] = [];

  marked.use({
    gfm: true,
    renderer: {
      heading(token: Tokens.Heading): string {
        const inner = this.parser.parseInline(token.tokens);
        const id = slugify(inner);
        if (token.depth === 2 || token.depth === 3) toc.push({ depth: token.depth, id, text: inner });
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },
      link(token: Tokens.Link): string {
        const href = rewriteLink(token.href);
        const external = /^https?:/.test(href);
        const title = token.title ? ` title="${token.title}"` : "";
        const attrs = external ? ' target="_blank" rel="noreferrer"' : "";
        return `<a href="${href}"${title}${attrs}>${this.parser.parseInline(token.tokens)}</a>`;
      },
    },
  });

  return { html: marked.parse(markdown, { async: false }), toc };
}

// ── テンプレート ────────────────────────────────────────────────────
function pageTemplate(options: {
  title: string;
  body: string;
  toc: TocEntry[];
  currentOut: string;
}): string {
  const nav = PAGES.map((page) => {
    const current = page.out === options.currentOut ? ' class="current"' : "";
    return `        <li${current}><a href="${page.out}">${page.label}</a></li>`;
  }).join("\n");

  const toc = options.toc
    .map((entry) => `        <li class="d${entry.depth}"><a href="#${entry.id}">${entry.text}</a></li>`)
    .join("\n");

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${options.title} — nix-prompt</title>
    <meta name="color-scheme" content="dark" />
    <link rel="stylesheet" href="site.css" />
  </head>
  <body>
    <header class="site-head">
      <a class="brand" href="../">nix-prompt</a>
      <span class="sub">Nix 風の関数型 DSL でプロンプトをコンパイル</span>
      <nav>
        <a href="../">アプリを開く</a>
        <a href="${repoUrl}" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
    </header>
    <div class="layout">
      <aside class="side">
        <h2>ドキュメント</h2>
        <ol>
${nav}
        </ol>
${toc ? `        <h2>このページ</h2>\n        <div class="toc">\n          <ul>\n${toc}\n          </ul>\n        </div>` : ""}
      </aside>
      <main>
${options.body}
      </main>
    </div>
    <footer class="site-foot">
      このページは <code>scripts/build-docs.ts</code> が Markdown から生成しています。
    </footer>
  </body>
</html>
`;
}

// ── 実行 ────────────────────────────────────────────────────────────
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(root, "web", "docs", "site.css"), path.join(outDir, "site.css"));

let generated = 0;
for (const page of PAGES) {
  const sourcePath = path.join(root, page.source);
  if (!fs.existsSync(sourcePath)) {
    console.warn(`skip: ${page.source} がありません`);
    continue;
  }
  const markdown = fs.readFileSync(sourcePath, "utf8");
  const { html, toc } = renderMarkdown(markdown);
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? page.label;
  const output = pageTemplate({ title, body: html, toc, currentOut: page.out });
  fs.writeFileSync(path.join(outDir, page.out), output);
  generated++;
}

console.log(`web/dist/docs/ に ${generated} ページを生成しました`);
