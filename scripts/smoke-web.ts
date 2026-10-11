/**
 * Web UI のスモークテスト。
 *
 *   bun run web:smoke
 *
 * 1. `vite build` でクライアント用バンドルを作り、Node 依存が混ざっていないか確認
 * 2. SSR で App を描画し、初期テンプレートがコンパイルされて出力に出ているか確認
 *
 * ブラウザを起動しないので CI でも動きます。
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const distDir = path.join(root, "web", "dist");
const ssrDir = path.join(root, "web", "dist-ssr");

type Check = { label: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (label: string, ok: boolean, detail?: string) => checks.push({ label, ok, detail });

// ── 1. クライアントバンドル ────────────────────────────────────────
const bundlePath = fs.existsSync(distDir)
  ? path.join(distDir, "assets", fs.readdirSync(path.join(distDir, "assets")).find((f) => f.endsWith(".js")) ?? "")
  : "";
if (bundlePath === "" || !fs.existsSync(bundlePath)) {
  check("web/dist にバンドルがある", false, "先に bun run web:build を実行してください");
} else {
  const bundle = fs.readFileSync(bundlePath, "utf8");
  check("バンドルに node:fs / node:path が含まれない", !/node:(fs|path)/.test(bundle));
  check("バンドルに readFileSync が含まれない", !bundle.includes("readFileSync"));
  check("バンドルサイズが 2MB 未満", Buffer.byteLength(bundle) < 2 * 1024 * 1024, `${(Buffer.byteLength(bundle) / 1024).toFixed(0)} KB`);

  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  check("index.html が相対パスでアセットを参照する", /src="\.\/assets\//.test(html) && /href="\.\/assets\//.test(html));
}

// ── 2. SSR 描画 ───────────────────────────────────────────────────
const ssrEntry = path.join(ssrDir, "smoke-entry.js");
if (!fs.existsSync(ssrEntry)) {
  check("SSR ビルドが存在する", false, "bun run web:smoke 経由で実行してください");
} else {
  const { renderApp } = (await import(ssrEntry)) as { renderApp: () => { body: string } };
  const { body } = renderApp();
  check("初期表示でエラーが出ていない", body.includes('class="status ok"'));
  check("初期テンプレートがモデル選択に追従している", body.includes("anima"));
  check("コンパイル結果（positive）が描画されている", body.includes("masterpiece") && body.includes("1girl"));
  check(
    "anima の出力順（品質 → 人数）になっている",
    body.indexOf("masterpiece") >= 0 && body.indexOf("masterpiece") < body.indexOf("1girl"),
  );
  check("出力タブが 4 種類描画されている", ["positive", "negative", "notes", "JSON"].every((t) => body.includes(`>${t}`) || body.includes(t)));
  check("エディタ領域が描画されている", body.includes("editor-host"));
  check("ファイルタブが描画されている", body.includes("/main.np"));
}

// ── 結果 ──────────────────────────────────────────────────────────
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? "✓" : "✗"} ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
}
console.log(`\n${checks.length - failed} / ${checks.length} 項目が成功`);
process.exit(failed === 0 ? 0 : 1);
