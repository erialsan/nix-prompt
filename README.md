# nix-prompt

Nix 風の**関数型・宣言的**な DSL で画像生成プロンプトを書き、**モデルごとに正しい順序へ正規化して**出力するコンパイラです。

まず Anima を対象に作っています（ルール出典: <https://wikiwiki.jp/sd_toshiaki/Anima#prompt> ）が、バックエンドは差し替え可能です。

## 何を解決するか

| 問題 | このコンパイラの扱い |
| --- | --- |
| モデルごとにタグの並び順が違う（あるモデルは品質が先頭、あるモデルは人数が先頭） | 同じソースから `--model` で順序を切り替えて出力する |
| 宣言した人数と人物定義の数が合わない / 人数より多く書いてしまう | コンパイルエラー（`humans` と `characters` を突き合わせる） |
| 人物ごとの定義を書き忘れる | コンパイルエラー（各人物に `tags` か `text` を要求） |
| 複数の作品が混在する | コンパイルエラー（`series` の重複を検出） |
| Anima のアンダースコア禁止 / アーティストの `@` / レーティング語彙の違い / 重みのスケール | バックエンドが自動で正規化（アンダースコアはエラーとして検出） |
| 人数タグ（`1girl, 1boy`）を手で書いて構成とズレる | 人物定義から自動生成し、手書きタグとは突き合わせてエラーにする |

## ドキュメント

- **[説明書（目次）](docs/README.md)**
- [チュートリアル](docs/tutorial.md) — 導入とエラーの直し方
- [DSL リファレンス](docs/dsl.md) — 文法・演算子・組み込み関数
- [プロンプト仕様](docs/spec.md) — フィールドと検証ルール
- [モデル](docs/models.md) — モデル別の振る舞いと追加方法
- [CLI リファレンス](docs/cli.md) — コマンドと出力形式
- [内部設計](docs/design.md) — 構成と拡張ポイント

## 使い方

```bash
bun run src/cli.ts init anima          # モデル別テンプレートを出力
bun run src/cli.ts init anima --out my.np
bun run src/cli.ts my.np               # ファイル内の model で出力
bun run src/cli.ts my.np --model illustrious
bun run src/cli.ts my.np --json --notes
```

出力例（`examples/two-people.np`）:

```
positive:
masterpiece, best quality, safe, 1girl, 1boy, hatsune miku, vocaloid, @wlop, classroom, sunlight,
1st girl is hatsune miku and twintails and aqua eyes and neck ribbon.,
2nd boy is black hair and glasses and school uniform., the girl is singing and the boy is listening.

negative:
worst quality, low quality, score_1, ..., watermark, patreon logo
```

同じソースを `--model illustrious` にすると、**人数タグが先頭**に移動し、`@` が外れ、`safe` が `general` に正規化されます。

```bash
bun test        # テスト
bunx tsc --noEmit   # 型チェック
```

## DSL

Nix 風の式言語です。プロンプトファイルは「属性集合を返す式」です。

- `let ... in ...` / `rec { ... }` / `with ...; ...` / `assert ...;`
- ラムダ `x: e`、パターン引数 `{ a, b ? 既定値, ... }: e`（`...` を付けると `__args` で引数全体を参照できる）
- 関数適用（空白）、属性選択 `a.b or 既定値`、`a ? b`、文字列補間 `"${x}"`、`import ./path.np`
- 演算子 `//`（属性マージ）`++`（リスト連結）`+ - * / == != < > <= >= && || !`
- リストは Nix と同じく要素に関数適用を書けません（`[ (f x) ]` と括弧でくくります）
- 組み込み: `map filter foldl' length elem head tail all any genList range sort unique concatLists attrNames attrValues hasAttr getAttr removeAttrs mapAttrs listToAttrs concatStringsSep replaceStrings substring toUpper toLower trim toString toJSON throw`
- プリミティブ: `character { ... }`、`weighted 1.5 "tag"`（重みは相対値。1.0 で括弧なし）

## 仕様フィールド

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `model` | 文字列 | 出力先モデル（`--model` が優先） |
| `humans` | 整数 | 宣言する人数。`characters` の数と一致しないとエラー |
| `characters` | リスト | `character { gender, name?, series?, tags?, text? }` |
| `quality` `meta` `era` | タグのリスト | 品質・メタ・年代タグ |
| `rating` | 文字列 | モデルごとの語彙へ正規化（Anima: `safe/sensitive/nsfw/explicit`） |
| `artists` | タグのリスト | Anima では出力時に `@` が付く |
| `series` | タグのリスト | 作品。1プロンプト1作品のみ |
| `tags` | タグのリスト | その他のタグ。人数タグを書くと構成と突き合わせる |
| `text` | 文字列のリスト | 自然言語 |
| `negative` | タグのリスト | モデル既定のネガティブに追加される |
| `allowMultipleSeries` `allowOther` | bool | 明示的にルールを緩める |

タグは文字列か `{ tag = "chibi"; weight = 1.5; }` で書けます。`weighted 1.5 "chibi"` は糖衣です。

## 出力順（バックエンド）

| モデル | 順序 |
| --- | --- |
| `anima` | 品質 → メタ → 年代 → レーティング → 人数 → キャラ → 作品 → アーティスト → タグ → 自然言語 |
| `illustrious` | 人数 → キャラ → 作品 → アーティスト → 品質 → メタ → 年代 → レーティング → タグ → 自然言語 |

Anima ではアーティストに `@`、括弧のエスケープ、アンダースコアの禁止、重みを約7倍にスケールします。

## 検証ルール

- `humans` と `characters` の人数一致（超過・不足の両方）
- 各人物に `gender`（`girl`/`boy`/`other`）と、`tags`/`text` のいずれかの定義
- `series` が2つ以上混在していないこと
- 手書きの人数タグと人物構成の一致
- `rating` がモデルの語彙にあること
- Anima: タグのアンダースコア禁止（`score_1` などの例外を除く）
- 未知のフィールド・未知のモデル

エラーは `ファイル:行:列` と該当行・キャレット付きで表示されます。

## モデルの追加

`src/models.ts` の `MODELS` に定義を足すだけです（`order`・`ratings`・`artistPrefix`・`weightScale` など）。`init` のテンプレートと CLI の一覧は自動で追従します。

## 構成

```
src/dsl.ts       字句解析・構文解析
src/eval.ts      評価器と組み込み関数
src/prelude.ts   DSL 側のプリミティブ（character など）
src/spec.ts      正規化済みプロンプトの型
src/models.ts    モデル別の順序と正規化ルール
src/compile.ts   取り出し・検証・出力
src/templates.ts init テンプレート
src/cli.ts       CLI
examples/        サンプルと違反例
tests/           bun test
```
