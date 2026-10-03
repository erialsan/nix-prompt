# チュートリアル

## 1. 準備

必要なのは [Bun](https://bun.sh) 1.4 以降だけです。

```bash
cd nix-prompt
bun install          # 型チェック用の devDependency のみ（実行に依存は不要）
bun test             # 動くことを確認
```

## 2. テンプレートから始める

```bash
bun run src/cli.ts init anima
```

出力順・使えるレーティング・アンダースコアの可否がモデルごとに変わった雛形が出ます。ファイルに書き出すときは `--out` を使います（既存ファイルは上書きしません）。

```bash
bun run src/cli.ts init anima --out my.np
# my.np に anima のテンプレートを書き出しました
```

## 3. 編集する

雛形の中心は `humans` と `characters` です。

```nix
{
  model = "anima";

  humans = 2;                       # 宣言する人数
  characters = [
    (character {                    # 1人目
      gender = "girl";
      name = "hatsune miku";
      series = "vocaloid";
      tags = [ "twintails" (weighted 1.2 "aqua eyes") ];
    })
    (character {                    # 2人目
      gender = "boy";
      tags = [ "black hair" "school uniform" ];
    })
  ];

  quality = [ "masterpiece" "best quality" ];
  rating = "safe";
  artists = [ "wlop" ];
  tags = [ "classroom" "sunlight" ];
}
```

- `humans` と `characters` の数は**一致しないとエラー**になります。
- 各人物には `tags` か `text` が要ります（誰の特徴か分からないまま人数だけ増やすのを防ぐため）。
- `weighted 1.2 "tag"` は重み付きタグです。相対値で書き、モデルごとの流儀へ自動でスケールします（[プロンプト仕様](spec.md#重み)）。

## 4. コンパイルする

```bash
bun run src/cli.ts my.np
```

```
positive:
masterpiece, best quality, safe, 1girl, 1boy, hatsune miku, vocaloid, @wlop, classroom, sunlight, 1st girl is hatsune miku and twintails and aqua eyes., 2nd boy is black hair and school uniform.

negative:
worst quality, low quality, score_1, score_2, score_3, 6 fingers, 6 toes, ai-generated, bad eyes, bad pupils, bad iris, bad hands, bad fingers, watermark, patreon logo
```

ポイント:

- 人数タグ `1girl, 1boy` は `characters` から自動生成されます（手で書く必要はありません）。
- 2人以上のときは、人物ごとの特徴が「1st girl is ...」の自然言語へ展開されます（Anima は複数人の描き分けに自然言語が効くため）。
- アーティストには `@` が付き、ネガティブはモデル既定＋`negative` の合成になります。

自然言語を自分で書きたい場合は `text = [ "the girl is singing and the boy is listening." ];` を足します。人物ごとに書くなら `character` の中の `text` がそのまま使われます。

## 5. モデルを変える

ソースはそのまま、出力先だけ切り替えます。

```bash
bun run src/cli.ts my.np --model illustrious --notes
```

```
positive:
1girl, 1boy, hatsune miku, vocaloid, wlop, masterpiece, best quality, general, classroom, sunlight, 1st girl is hatsune miku and twintails and aqua eyes., 2nd boy is black hair and school uniform.

notes:
  - 人数タグを先頭に置くモデル向けの並びです。
  - 重み付けは相対値で書き、このモデルでは 1.0 を基準に約1.2倍へスケールします。
  - rating "safe" を illustrious の "general" に正規化しました
  - 人数が2人以上のため、各人物の特徴を自然言語の文へ展開しました
```

`rating = "safe"` は Illustrious では `general` に正規化され、`@` は外れ、重みの倍率も変わります。利用できるモデルは `--list-models` で確認できます。

## 6. エラーを直す

このコンパイラの主目的は「壊れたプロンプトを出力しない」ことなので、違反は全部止めます。`examples/errors/` に再現用の例があります。

### 人数より多く定義した

```bash
$ bun run src/cli.ts examples/errors/too-many.np
examples/errors/too-many.np:1:1: error: humans = 2 と宣言されていますが、3 人分の定義があります
  {
  ^
  hint: 宣言した人数以下の定義にしてください
```

### 複数の作品を混ぜた

```bash
$ bun run src/cli.ts examples/errors/multiple-series.np
examples/errors/multiple-series.np:1:1: error: 複数の作品が混在しています: vocaloid, naruto
  {
  ^
  hint: 1つのプロンプトには1作品だけにしてください（意図的な場合は allowMultipleSeries = true）
```

### Anima でアンダースコアを使った

```bash
$ bun run src/cli.ts examples/errors/underscore.np
examples/errors/underscore.np:5:16: error: タグ 'long_hair' にアンダースコアは使えません（anima）
      (character { gender = "girl"; tags = [ "long_hair" "looking_at_viewer" ]; })
                 ^
  hint: 'long hair' のようにスペースに置き換えてください
```

### その他

- 人数タグの手書きが人物構成とズレている（`2girls` など）
- `rating` がそのモデルの語彙に無い
- 未知のフィールド、未知のモデル
- 人物に `gender` が無い／特徴が無い

一覧は [プロンプト仕様の検証ルール](spec.md#検証ルール) にあります。

## 7. 関数でまとめる

DSL は関数型なので、よく使う人物を関数にできます。

```nix
let
  girl = args: character (args // { gender = "girl"; });
  schoolgirl = tags: girl { tags = tags; series = "original"; };
in
{
  model = "anima";
  humans = 1;
  characters = [ (schoolgirl [ "sailor uniform" "black hair" ]) ];
  rating = "safe";
}
```

`//` は属性集合のマージです。共通の雛形を別ファイルに置いて `import` することもできます。

```nix
let lib = import ./lib/characters.np; in
{ characters = [ (lib.miku { }) ]; }
```

## 8. 次に読む

- 文法や組み込み関数をもっと知りたい → [DSL リファレンス](dsl.md)
- 書けるフィールドを全部知りたい → [プロンプト仕様](spec.md)
- 自分のモデルを足したい → [モデル](models.md)
