# CLI リファレンス

```bash
bun run src/cli.ts <file.np> [options]
bun run src/cli.ts init <model> [--out <file>]
```

`package.json` の `bin` に入っているので、リンクすれば `nix-prompt` としても使えます。

```bash
bun link
nix-prompt examples/solo.np
```

## サブコマンド

### コンパイル（既定）

```bash
bun run src/cli.ts examples/two-people.np
bun run src/cli.ts examples/two-people.np --model illustrious
```

| オプション | 説明 |
| --- | --- |
| `--model <id>` | 出力先モデル。ファイル内の `model` より優先 |
| `--json` | JSON で出力 |
| `--positive` | ポジティブだけ出力 |
| `--negative` | ネガティブだけ出力 |
| `--notes` | 適用した正規化の説明を表示 |
| `--list-models` | 利用可能なモデルの一覧 |
| `-h` `--help` | ヘルプ |

### init

```bash
bun run src/cli.ts init anima                 # 標準出力へ
bun run src/cli.ts init illustrious --out my.np
```

| オプション | 説明 |
| --- | --- |
| `--out <file>` | ファイルへ書き出す。**既存ファイルがある場合は上書きせずエラー**にする。親ディレクトリは自動作成 |

テンプレートはそのままコンパイルが通る内容です（テストで固定しています）。

## 出力形式

### テキスト（既定）

```
positive:
masterpiece, best quality, safe, 1girl, 1boy, ...

negative:
worst quality, low quality, ...
```

`--notes` を付けると末尾に説明が付きます。

```
notes:
  - アーティストタグには '@' を付与して出力します。
  - タグ内のアンダースコアは禁止のため検出時にエラーにします。
  - 作品名などの '()' は自動でエスケープします。
  - 重み付けは相対値で書き、このモデルでは 1.0 を基準に約7倍へスケールします。
  - 人数が2人以上のため、各人物の特徴を自然言語の文へ展開しました
```

### JSON

```bash
bun run src/cli.ts examples/solo.np --json
```

```json
{
  "model": "anima",
  "positive": "masterpiece, highres, year 2025, sensitive, 1girl, ...",
  "negative": "worst quality, low quality, ...",
  "notes": ["アーティストタグには '@' を付与して出力します。", "..."]
}
```

## 終了コード

| コード | 意味 |
| --- | --- |
| `0` | 成功（`--help` を含む） |
| `1` | コンパイルエラー、引数不足、未知のモデルなど |

エラーは標準エラー出力に出ます。コンパイルエラーは `ファイル:行:列: error: 説明` の形式で、該当行とキャレット、修正ヒントが付きます。

```bash
$ bun run src/cli.ts examples/errors/count-mismatch.np
examples/errors/count-mismatch.np:1:1: error: 人数タグ '2girls' が宣言された人物構成と一致しません
  {
  ^
  hint: characters から導出される人数タグ: 1girl, 1boy
```

複数の違反がある場合はすべて表示されます。1 つでも違反があれば出力は生成しません。

## プログラムから使う

`src/index.ts` から API も使えます。

```ts
import { compile } from "./src/compile";

const r = compile("miku.np", { model: "illustrious" });
console.log(r.positive);
```

| 関数 | 説明 |
| --- | --- |
| `compile(file, { model })` | 評価・検証・出力まで行い `{ spec, model, positive, negative, notes }` を返す。違反があれば `CompileFailure`（`errors` と `ctx` を持つ）を投げる |
| `extractSpec(value, ctx, model)` | 評価済みの値から仕様を取り出す |
| `validate(spec, model, ctx)` | 検証だけを行う（`CompileError[]` を返す） |
| `emit(spec, model)` | 出力だけを行う |
| `evaluateFile(path, ctx, env)` | DSL を評価する |
| `MODELS` / `getModel` / `modelIds` | モデル定義 |
| `templateFor(modelId)` | テンプレート文字列 |
