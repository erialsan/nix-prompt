import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/**
 * Web UI は `web/` をルートに、リポジトリ直下の `src/`（コンパイラ本体）を
 * そのまま import して 1 枚の静的サイトにバンドルします。
 *
 * - `base: "./"` … GitHub Pages のプロジェクトページ（/nix-prompt/）でも
 *   ローカルの file 配信でも動くよう、アセットを相対パスで出力する。
 * - `server.fs.allow` … dev サーバーから `../src` と `../examples` を読むため。
 */
export default defineConfig({
  root: "web",
  base: "./",
  plugins: [svelte()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  server: {
    fs: { allow: [".."] },
  },
  preview: {
    port: 4173,
  },
});
