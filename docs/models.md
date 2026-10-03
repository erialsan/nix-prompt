# モデル

「同じソースから、モデルごとに正しい順序へ正規化して出す」のがこのコンパイラの役割です。モデルごとの差はすべて `src/models.ts` の `ModelDef` に集約されています。

## 収録モデル

| id | 対象 | セクションの順序 |
| --- | --- | --- |
| `anima` | Anima Base / Aesthetic / Turbo | 品質 → メタ → 年代 → レーティング → 人数 → キャラ → 作品 → アーティスト → タグ → 自然言語 |
| `illustrious` | Illustrious など SDXL 系（人数を先頭に置く） | 人数 → キャラ → 作品 → アーティスト → 品質 → メタ → 年代 → レーティング → タグ → 自然言語 |

```bash
bun run src/cli.ts --list-models
```

## 正規化の差

| 項目 | anima | illustrious |
| --- | --- | --- |
| `rating` の語彙 | `safe` `sensitive` `nsfw` `explicit` | `general` `sensitive` `questionable` `nsfw` |
| エイリアス | `general` → `safe`, `questionable` → `sensitive` | `safe` → `general` |
| アーティストの接頭辞 | `@` | なし |
| 重みの倍率 | ×7 | ×1.2 |
| タグのアンダースコア | **エラー**（`score_1` と顔文字系は例外） | 許可 |
| 作品名などの `()` | `\(` `\)` へ自動エスケープ | そのまま |
| 既定のネガティブ | 公式推奨の一式（`worst quality, low quality, score_1, ... , watermark, patreon logo`） | `worst quality, low quality, bad anatomy, jpeg artifacts, watermark` |
| ネガティブの使用 | 可 | 可 |
| 動物の被写体 | `animal focus` を人数セクションへ付与 | `animal focus` を人数セクションへ付与 |

`--notes` を付けると、そのときに適用された正規化の説明が出ます。

## Anima 固有のルール（出典）

<https://wikiwiki.jp/sd_toshiaki/Anima#prompt> の記述に基づきます。

- タグにアンダースコアを入れてはいけない（`long_hair` ではなく `long hair`）→ コンパイルエラーで検出
- アーティストタグは先頭に `@` が必要 → 自動付与
- 重み付けは 1 前後ではなく、より大きい数値が好まれる → 相対値を約 7 倍にスケール
- レーティングは `safe` / `sensitive` / `nsfw` / `explicit`
- 出力順は 品質 → 人数 → キャラ → 作品 → アーティスト → その他
- 作品名などの `()` はエスケープが必須 → 自動エスケープ
- 複数人の描き分けは自然言語が有効 → 2 人以上で特徴を文へ展開

## モデルを追加する

`src/models.ts` の `MODELS` に 1 エントリ足すだけです。`--list-models`、`init <model>` のテンプレート、CLI の検証は自動で追従します。

```ts
export const MODELS: Record<string, ModelDef> = {
  anima: { /* ... */ },

  mymodel: {
    id: "mymodel",
    label: "My Model",
    order: ["counts", "characters", "quality", "tags", "text"],
    ratings: ["general", "sensitive", "nsfw"],
    ratingAliases: { safe: "general" },
    artistPrefix: "",
    animalFocus: "animal focus",
    weightScale: 1.1,
    escapeParens: false,
    rejectUnderscore: false,
    defaultNegative: ["worst quality"],
    negativeUsable: true,
    notes: ["このモデル向けの並びです。"],
  },
};
```

### ModelDef のフィールド

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | 文字列 | モデル名（`model = "..."` と `--model` で使う値） |
| `label` | 文字列 | 一覧やテンプレートの見出しに出る説明 |
| `order` | `SectionKey[]` | 出力するセクションの順序 |
| `ratings` | 文字列[] | このモデルで使えるレーティング |
| `ratingAliases` | マップ | 他モデルの語彙からの読み替え |
| `artistPrefix` | 文字列 | アーティストタグの接頭辞（`"@"` など） |
| `animalFocus` | 文字列 \| null | 動物の被写体がいるとき人数セクションへ足すタグ（例 `"animal focus"`）。`null` なら出さない |
| `weightScale` | 数値 | 相対値に掛ける倍率 |
| `escapeParens` | bool | `()` をエスケープするか |
| `rejectUnderscore` | bool | タグ内のアンダースコアをエラーにするか |
| `defaultNegative` | 文字列[] | 既定のネガティブ |
| `negativeUsable` | bool | ネガティブが効くモデルか（`false` なら注意を出す） |
| `notes` | 文字列[] | `--notes` で表示する説明 |

`order` に使える `SectionKey` は次のとおりです。

`quality` `meta` `era` `rating` `counts` `characters` `series` `artists` `tags` `text`

セクションの中身は [プロンプト仕様の「出力の組み立て方」](spec.md#出力の組み立て方) を参照してください。
