# DSL リファレンス

プロンプトファイル（`.np`）は**属性集合を返す式**です。実行前に prelude が読み込まれるので、`character` や `weighted` は最初から使えます。

```nix
# これがファイルの中身の最小形
{ model = "anima"; humans = 1; characters = [ (character { gender = "girl"; tags = [ "twintails" ]; }) ]; }
```

## 字句

| 種類 | 書き方 |
| --- | --- |
| コメント | `# 行末まで` / `/* ブロック */` |
| 識別子 | 英字か `_` で始まり、英数字 `_` `'` `-` が続く（`foldl'` も識別子） |
| 数値 | `42` `3.14`（`-1` は直前が値でないときだけ負数リテラル） |
| 文字列 | `"..."`、エスケープ `\n` `\t` `\r` `\"` `\\`、補間 `${式}` |
| パス | `./lib.np` `../lib.np`（`import` 用。`~/` と絶対パスは未対応） |

キーワード: `let` `in` `rec` `with` `assert` `if` `then` `else` `true` `false` `null` `inherit` `import` `or`

## 構文

### ラムダ

```nix
x: x + 1
{ a, b ? 2, ... }: a + b        # パターン引数（既定値つき）
```

`...` を付けると、引数全体の属性集合を `__args` で参照できます（prelude の `character` がこれを使ってエラー位置を記録しています）。`...` が無いときは、未知の引数を渡すとエラーになります。

### let（相互再帰・遅延評価）

```nix
let
  a = 1;
  b = a + 1;
in b            # => 2
```

### rec（自己参照できる属性集合）

```nix
rec { a = 1; b = a + 1; }       # => { a = 1; b = 2; }
{ a = 1; b = a; }               # rec 無しでは a を参照できず、外側の a を探すかエラー
```

### with（名前解決のフォールバック）

```nix
with { a = 3; }; a * 2          # => 6
let a = 10; in with { a = 3; }; a   # => 3（with が優先）
```

### assert

```nix
assert 1 < 2; "ok"              # 偽なら「assert が失敗しました」で停止
```

### if / 比較

```nix
if x == "girl" then "she" else "they"
```

### 関数適用と括弧

適用は空白で書きます。引数を式にしたいときは括弧でくくります。

```nix
character { gender = "girl"; tags = [ "twintails" ]; }
weighted 1.5 "aqua eyes"
```

### 属性選択と has-attr

```nix
{ a.b = 1; }.a.b                # セレクト
{ a = 1; }.b or "none"          # 既定値つき
{ a = 1; } ? a                  # => true
```

### inherit

```nix
let x = 1; in { inherit x; y = 2; }        # => { x = 1; y = 2; }
{ inherit (from) a b; }
```

### 文字列補間

```nix
let name = "miku"; in "hello ${name}!"      # => "hello miku!"
```

### import

```nix
let lib = import ./lib.np; in lib.miku { }
```

パスは**読み込み元ファイルからの相対**で解決されます。

## 演算子

強い順（上が強く、下が弱い）。同じ強さは左結合、`++` `//` `->` は右結合です。

| 強さ | 演算子 | 意味 |
| --- | --- | --- |
| 1 | `e.a` / `e ? a.b` | 属性選択 / has-attr |
| 2 | `f x` | 関数適用 |
| 3 | `!` `-`（単項） | 論理否定 / 符号反転 |
| 4 | `*` `/` | 数値 |
| 5 | `+` `-` | 数値、または文字列の連結（`+` のみ） |
| 6 | `++` | リストの連結 |
| 7 | `//` | 属性集合のマージ（右が優先） |
| 8 | `==` `!=` `<` `>` `<=` `>=` | 比較（`==` は構造比較） |
| 9 | `&&` `||` | 論理（短絡） |
| 10 | `->` | 含意 |

型の制約（違反するとコンパイルエラー）:

- `+` は数値同士か文字列同士のみ
- `-` `*` `/` は数値のみ（0除算はエラー）
- `++` はリスト同士、`//` は属性集合同士
- `<` `>` `<=` `>=` は数値か文字列のみ
- 条件（`if` `&&` `||` `!` `->` `assert`）は **bool のみ**。`0` や `""` を偽として扱いません

### リストの注意

Nix と同じく、**リストの要素には関数適用と二項演算子を書けません**。

```nix
tags = [ "a" (weighted 1.5 "b") "c" ];   # 正しい
tags = [ "a" weighted 1.5 "b" ];         # 誤り（"a" に weighted を適用しようとする）
sizes = [ (1 + 2) 4 ];                   # 正しい
```

## 値

| 型 | 例 |
| --- | --- |
| string | `"miku"` |
| int / float | `1` `1.5` |
| bool | `true` `false` |
| null | `null` |
| list | `[ 1 2 3 ]` |
| set | `{ a = 1; }` |
| lambda | `x: x` |

`typeOf` で判定でき、`isString` `isInt` `isFloat` `isBool` `isList` `isAttrs` `isFunction` `isNull` も使えます。

## 組み込み関数

`builtins.map` の形でも、`map` の形でも呼べます。すべてカリー化されているので部分適用もできます（`let f = map (x: x * 2); in f [ 1 2 ]`）。

| 名前 | 引数 | 説明 |
| --- | --- | --- |
| `toString` | 1 | 値を文字列へ |
| `typeOf` | 1 | 型名を返す |
| `isString` `isInt` `isFloat` `isBool` `isList` `isAttrs` `isFunction` `isNull` | 1 | 型判定（bool） |
| `throw` | 1 | メッセージ付きで評価を中断 |
| `toJSON` | 1 | pretty JSON 文字列 |
| `length` | 1 | リスト長または属性数 |
| `head` `tail` | 1 | リストの先頭 / 残り（`head` は空リストでエラー） |
| `elem` | 2 | `elem x list` |
| `map` `filter` | 2 | `map f list` / `filter f list` |
| `foldl'` | 3 | `foldl' f init list`（正格） |
| `all` `any` | 2 | `all f list` / `any f list` |
| `genList` | 2 | `genList (i: i * 2) 3` |
| `range` | 2 | `range 1 3` → `[ 1 2 3 ]` |
| `sort` | 2 | `sort (a: b: a < b) list` |
| `unique` | 1 | 重複除去（構造比較） |
| `concatLists` | 1 | リストのリストを平坦化 |
| `attrNames` `attrValues` | 1 | 属性名（ソート済） / 値 |
| `hasAttr` `getAttr` | 2 | `hasAttr "a" set` / `getAttr "a" set` |
| `removeAttrs` | 2 | `removeAttrs set [ "a" ]` |
| `mapAttrs` | 2 | `mapAttrs (k: v: ...) set` |
| `listToAttrs` | 1 | `[ { name = "a"; value = 1; } ]` → `{ a = 1; }` |
| `concatStringsSep` | 2 | `concatStringsSep ", " list` |
| `replaceStrings` | 3 | `replaceStrings [ "a" ] [ "b" ] s` |
| `stringLength` `substring` | 1 / 3 | `substring 開始 長さ 文字列` |
| `toUpper` `toLower` `trim` | 1 | 文字列整形 |

内部用に `__posOf`（値の定義位置を返す）があります。`__` で始まる名前は出力に混ざりません。

## prelude のプリミティブ

| 名前 | 説明 |
| --- | --- |
| `character { ... }` | 人物を定義する。`gender` は必須。`name` `tags` `series` `text` は任意 |
| `mkCharacter` | `character` の別名 |
| `weighted 1.5 "tag"` | `{ tag = "tag"; weight = 1.5; }` を作る糖衣 |

prelude は `<prelude>` という仮想ファイル名で読み込まれ、エラー位置に現れることがあります。通常のプロンプトエラーは自分のファイル位置を指します。

## エラー

| 状況 | メッセージ例 |
| --- | --- |
| 知らない名前 | `未定義の名前 'nope'` |
| 関数でない値の適用 | `string は関数ではありません` |
| 条件が bool でない | `条件式には bool が必要です（string）` |
| 型違いの演算 | `'+' は数値同士または文字列同士にのみ適用できます（string と int）` |
| 相互再帰の循環 | `無限再帰を検出しました` |
| assert 失敗 | `assert が失敗しました` |
| 構文ミス | `file.np:3:12: syntax error: ';' が必要（"}" を検出）` |

構文エラーは `ファイル:行:列: syntax error: ...`、それ以外のコンパイルエラーは該当行とキャレット付きで表示されます。

## 完全な例

```nix
let
  miku = character {
    name = "hatsune miku";
    gender = "girl";
    series = "vocaloid";
    tags = [ "twintails" (weighted 1.2 "aqua eyes") "neck ribbon" ];
  };
  other = gender: tags: character { inherit gender tags; };
in
{
  model = "anima";
  humans = 2;
  characters = [ miku (other "boy" [ "black hair" "glasses" ]) ];
  quality = [ "masterpiece" "best quality" ];
  rating = "safe";
  artists = [ "wlop" ];
  tags = [ "classroom" "sunlight" ];
  text = [ "the girl is singing and the boy is listening." ];
}
```
