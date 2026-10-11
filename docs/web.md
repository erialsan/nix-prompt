# Web UI（ブラウザで使う）

コンパイラをそのままブラウザへ持っていき、**サーバー無し**でプロンプトを編集・コンパイルできる UI です。
GitHub Pages に、この説明書（`/docs/`）と同居する形で配信しています。

| URL | 内容 |
| --- | --- |
| <https://erialsan.github.io/nix-prompt/> | アプリ本体（`main` を push すると自動更新） |
| <https://erialsan.github.io/nix-prompt/docs/> | この説明書（Markdown から静的生成） |

ソースは `web/`（アプリ）、`web/docs/`（説明書のスタイル）、`scripts/build-docs.ts`（説明書の生成）です。

## 何ができるか

| 機能 | 説明 |
| --- | --- |
| テンプレートから開始 | `init anima` / `init illustrious` と同じテンプレートをエディタへ展開 |
| サンプル読込 | `examples/*.np`（正常系3件）と `examples/errors/*.np`（違反例5件）を内蔵 |
| リアルタイム出力 | 打鍵ごとにコンパイルし、positive / negative / notes / JSON を即時表示 |
| モデル切替 | 「ファイルの指定に従う」/ `anima` / `illustrious` を選ぶと、同じソースのまま出力順が変わる |
| エラー表示 | `ファイル:行:列` と hint を一覧表示。クリックで該当行へジャンプし、エディタ上でも行をハイライト |
| 仮想FS | ファイルを追加し、`import ./base.np` で参照できる（ブラウザ内のメモリ上で解決） |
| 保存・共有 | `.np` のダウンロード / 出力のコピー / ソースを丸ごと埋め込んだ共有URL / `localStorage` への自動保存 |
| ショートカット | `Mod-S` でソースをダウンロード、`Mod-F` で検索（CodeMirror 標準） |

**すべてブラウザ内で処理します。** 入力したプロンプトはどこにも送信されません。

## 開発

```bash
bun install

bun run web:dev       # 開発サーバー（HMR）
bun run web:build     # web/dist へ静的出力（アプリ + /docs/）
bun run web:preview   # 出力を確認（http://127.0.0.1:4173/）
bun run web:check     # Svelte + TS の型チェック
bun run web:smoke     # ビルド + ブラウザ無しの初期描画検証
bun run web:examples  # examples/*.np を UI 用に埋め込み直す
bun run web:docs      # 説明書だけを再生成
```

`web:build` は `base: "./"` で出力するため、`/nix-prompt/` のようなサブパス配信でもそのまま動きます。

実ブラウザで操作まで検証する場合（要 Chromium）:

```bash
bun run scripts/browser-check.ts --url http://127.0.0.1:4173/ --shot /tmp/app.png
bun run scripts/browser-check.ts --url https://erialsan.github.io/nix-prompt/
```

## GitHub Pages へのデプロイ

1. リポジトリの **Settings → Pages → Source** を **GitHub Actions** にする（最初の1回だけ）
2. `main` へ push する（`.github/workflows/deploy-pages.yml` が `web/**` などの変更で起動）

ワークフローはデプロイ前に `tsc --noEmit` / `bun test` / `web:check` / `web:smoke` を実行し、
どれかが失敗すると配信しません。成果物 `web/dist` には **アプリ（`/`）と説明書（`/docs/`）の両方**が入ります。

## 仕組み

```
ブラウザ
  └── web/src/lib/App.svelte      画面全体（状態・操作）
        ├── Editor.svelte         CodeMirror 6（.np 用ハイライト・エラー行）
        └── engine.ts             仮想FS + compile() のラッパ ← DOM に触らない
              └── src/compile.ts  ← CLI とまったく同じコンパイラ
```

ポイントは **コンパイラを再実装していない** ことです。CLI と同じ `src/` を import するため、
出力は CLI と一致します（`tests/engine.test.ts` で同一ソースの出力を突き合わせて検証しています）。

そのために、コアから Node 依存を2つだけ外へ出しました。

| モジュール | 役割 |
| --- | --- |
| `src/pathutil.ts` | `node:path` の posix 相当（純粋関数） |
| `src/io.ts` | ソース読み込みの抽象（`SourceReader`）と既定実装のレジストリ |
| `src/node-io.ts` | `node:fs` と `process.cwd()` を登録。**CLI とテストのみ** が import |

ブラウザ側は `compile(entry, { sources, reader, cwd: "/" })` にメモリ上のソースを渡します。
`import ./x.np` は仮想FSの中だけで解決されるので、ファイルシステムは不要です。

```
{
  model = "anima"; ...
}
   ↓ compile（ブラウザ内）
positive: masterpiece, best quality, safe, 1girl, ...
negative: worst quality, low quality, ...
```

説明書（`/docs/`）は `scripts/build-docs.ts` が `README.md` と `docs/*.md` を marked で HTML 化したものです
（Jekyll を使わないので CI に Ruby は不要）。見出しアンカーは GitHub と同じ規則で振るため、
既存の `docs/spec.md#tags-のカテゴリ` のようなリンクがそのまま動きます。

## 検証

| コマンド | 内容 |
| --- | --- |
| `bun test` | コア + `engine.ts`（仮想FS）+ `pathutil` の 66 テスト |
| `bunx tsc --noEmit` | コアの型チェック |
| `bun run web:check` | Svelte コンポーネントを含む型チェック |
| `bun run web:smoke` | バンドルに Node 依存が混ざっていないこと・`/docs/` の生成・SSR での初期描画を 17 項目で検証 |
| `bun run web:browser` | 実ブラウザで操作し、出力が CLI と一致することを 12 項目で検証（Chromium 必須） |

`web:smoke` はブラウザを起動しないので CI でも動きます。`web:browser` は次のことを確認します。

- 初期テンプレートの positive が `compile()` の結果と**文字列完全一致**（anima / illustrious）
- モデルを切り替えると人数タグが先頭へ移動して再コンパイルされる
- 共有URL（`#s=...`）からソースとモデルが復元される
- 違反例でエラー件数が CLI と一致し、エラー行がハイライトされ、クリックで該当行へ移動する
- リロードしても `localStorage` から復元される
- ブラウザのコンソールエラーが無い

## 制約

- 対応ブラウザは ES2022 + `CompressionStream` を前提とします（共有URLの圧縮。非対応でも無圧縮で動作）。
- 共有URLはソースを丸ごと含むため、長いプロンプトでは URL が長くなります。
- 画像生成そのものは行いません（プロンプトのコンパイルだけ）。
- 日本語の表示は閲覧環境のフォントに依存します（CJK フォントが無い Linux などでは □ になります）。
