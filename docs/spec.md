# プロンプト仕様

プロンプトファイルは 1 つの属性集合で、次のフィールドを書けます。未知のフィールドはエラーになります（typo を黙って無視しないため）。

`prompt = { ... }` で包んでも構いません（包んだ場合は `model` などの外側のフィールドとマージされます）。

## フィールド一覧

| フィールド | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `model` | 文字列 | なし | 出力先モデル。`--model` が指定されていればそちらが優先 |
| `humans` | 整数 | なし | 宣言する人数。`characters` のうち `gender = "animal"` 以外の数と一致しないとエラー |
| `characters` | リスト | `[]` | `character { ... }` のリスト |
| `quality` | タグのリスト | `[]` | 品質タグ |
| `meta` | タグのリスト | `[]` | `highres` などのメタタグ |
| `era` | タグのリスト | `[]` | `year 2025` `newest` など |
| `rating` | 文字列 | なし | モデルごとの語彙へ正規化される |
| `artists` | タグのリスト | `[]` | モデルによって接頭辞が付く（Anima は `@`） |
| `series` | タグのリスト | `[]` | 作品。1プロンプト1作品 |
| `tags` | タグのリスト | `[]` | その他のタグ |
| `text` | 文字列のリスト | `[]` | 自然言語の文 |
| `negative` | タグのリスト | `[]` | モデル既定のネガティブに追加される |
| `allowMultipleSeries` | bool | `false` | 複数作品を許可する |
| `allowOther` | bool | `false` | `gender = "other"` を許可する |

### character

| フィールド | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `gender` | 文字列 | 必須 | `"girl"` `"boy"` `"other"` `"animal"` |
| `name` | 文字列 | `null` | キャラクター名 |
| `species` | 文字列 | `null` | `gender = "animal"` のとき必須。種（`"cat"` `"dragon"` など）で、タグとして出力する |
| `series` | 文字列 | `null` | 作品名（トップレベルの `series` と突き合わせて混在を検出） |
| `tags` | タグのリスト | `[]` | その人物の特徴 |
| `text` | 文字列 | `null` | その人物の自然言語。複数人のとき、自動生成の文の代わりに使われる |

## タグの書き方

3 通りあり、同じ意味です。

```nix
tags = [
  "twintails"                          # 文字列
  (weighted 1.2 "aqua eyes")           # 糖衣
  { tag = "neck ribbon"; weight = 1.5; }   # 属性集合
];
```

タグ名は前後の空白を落とし、連続する空白は 1 つにまとめてから出力します。

## 出力の組み立て方

出力は「セクション」の並び替えで作られます。どのフィールドがどのセクションに入るかは次のとおりです。

| セクション | 元 |
| --- | --- |
| 品質 | `quality` |
| メタ | `meta` |
| 年代 | `era` |
| レーティング | `rating`（正規化後） |
| 人数 | `characters` の `gender` から自動生成 |
| キャラクター | `characters[].name` |
| 作品 | `series` と `characters[].series`（重複除去） |
| アーティスト | `artists`（接頭辞つき） |
| その他のタグ | `tags` と、1人のときの `characters[].tags` |
| 自然言語 | 複数人のときの自動生成文と `text` |

セクションの**並び順はモデルごとに変わります**（[モデル](models.md)）。区切りはカンマ＋スペースです。

### 人数タグの自動生成

`characters` の `gender` を数えて `1girl` `2girls` `1boy` の形で生成します（`girl` → `boy` → `other` の順）。

`gender = "animal"` の被写体は人間ではないので、人数タグを生成しません。代わりに人数セクションへ `animal focus`（モデルごとの設定）と `species` のタグを足します。`humans` もこの被写体は数えません。

```nix
humans = 1;
characters = [
  (character { gender = "girl"; tags = [ "twintails" ]; })
  (character { gender = "animal"; species = "cat"; tags = [ "black fur" ]; })
];
# => 人数セクションは "1girl, animal focus, cat"
```

- `tags` や `quality` に人数タグを手書きした場合、**検証にだけ使われ、出力からは取り除かれます**（自動生成分と重複しないようにするため）。
- 手書きの人数タグが人物構成と食い違っていればエラーです。

```nix
humans = 2;
characters = [
  (character { gender = "girl"; tags = [ "twintails" ]; })
  (character { gender = "boy";  tags = [ "black hair" ]; })
];
# => 人数セクションは "1girl, 1boy"
```

### 複数人のときの自然言語展開

`characters` が 2 人以上のとき、その人物の `tags` はタグ列ではなく文になります。

```nix
(character { gender = "girl"; name = "hatsune miku"; tags = [ "twintails" "aqua eyes" ]; })
(character { gender = "boy"; tags = [ "black hair" ]; })
```

```
1st girl is hatsune miku and twintails and aqua eyes., 2nd boy is black hair.
```

- 順序語は `1st` `2nd` `3rd` …です。
- その人物に `text` を書いた場合は、自動生成の代わりにその文が使われます。
- 1 人のときは展開せず、その人物の `tags` がタグとして並びます。

Anima は複数人の描き分けに自然言語が効くため、この展開は既定で有効です。

## 重み

`weight` は**相対値**です。`1.0` が標準で、そのときは括弧を付けません。`1.0` 以外はモデルごとの倍率を掛けて出力します。

| ソース | anima（×7） | illustrious（×1.2） |
| --- | --- | --- |
| `weight = 1.0` | `aqua eyes` | `aqua eyes` |
| `weight = 1.5` | `(aqua eyes:10.5)` | `(aqua eyes:1.8)` |

モデルごとに「効きやすい数値帯」が違う（Anima は 1 よりずっと大きい値を使う）のを、ソース側は 1 つの書き方で済むようにしています。

## rating の正規化

`rating` はモデルの語彙へ寄せます。エイリアスがある場合は変換され、`--notes` に記録が出ます。

| ソース | anima | illustrious |
| --- | --- | --- |
| `safe` | `safe` | `general`（エイリアス） |
| `general` | `safe`（エイリアス） | `general` |
| `sensitive` | `sensitive` | `sensitive` |
| `nsfw` | `nsfw` | `nsfw` |
| `explicit` | `explicit` | エラー（語彙に無い） |

## 検証ルール

エラーは該当行とキャレット、修正ヒント付きで表示され、**出力は一切生成されません**。

| 条件 | メッセージ（要旨） |
| --- | --- |
| 宣言人数より定義が多い | `humans = 2 と宣言されていますが、3 人分の定義があります` |
| animal が混ざる人数不一致 | `humans = 2 と宣言されていますが、定義は 1 人分しかありません（animal は humans に数えません）` |
| 宣言人数より定義が少ない | `humans = 2 と宣言されていますが、定義は 1 人分しかありません` |
| 人物に `gender` が無い | `必須引数 'gender' がありません` |
| `gender` が girl/boy/other/animal 以外 | `'characters[0].gender' は girl / boy / other / animal のいずれかです（person）` |
| `gender = "animal"` なのに `species` が無い | `'characters[0]' の gender = "animal" には species が必要です` |
| `species` を animal 以外に指定 | `'characters[0]' の species は gender = "animal" のときだけ指定できます` |
| `gender = "other"`（既定では不可） | `'characters[0]' の gender = "other" は許可されていません` |
| 人物に `tags` も `text` も無い | `'characters[1]' に特徴の定義がありません` |
| 作品が 2 つ以上混在 | `複数の作品が混在しています: vocaloid, naruto` |
| アンダースコア入りタグ（Anima） | `タグ 'long_hair' にアンダースコアは使えません（anima）` |
| 手書きの人数タグが構成と不一致 | `人数タグ '2girls' が宣言された人物構成と一致しません` |
| `rating` がモデルの語彙に無い | `'rating = "explicit"' は illustrious では使えません` |
| 未知のフィールド | `未知のフィールド 'quallity' があります` |
| `model` が未指定 / 未知 | `model が指定されていません` / `未知のモデル 'nope'` |
| 空のタグ | `'tags' に空のタグがあります` |
| タグの要素が文字列でも属性集合でもない | `'tags' の要素は文字列か { tag; weight; } にしてください` |

アンダースコアの例外は `score_9`〜`score_1` と、英数字を含まない顔文字系（`@_@` `^_^` など）です。

## ルールを緩める

意図的に外したい場合だけ、明示的に許可します。

```nix
{ allowMultipleSeries = true; allowOther = true; ... }
```
