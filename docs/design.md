# 内部設計

## 構成

```
src/dsl.ts       字句解析と構文解析（Nix 風の式言語）
src/eval.ts      評価器、組み込み関数、エラー型、位置情報
src/values.ts    値の型（Closure / Builtin / Thunk / AttrSet）
src/prelude.ts   DSL 側のプリミティブ（character, weighted）
src/spec.ts      正規化済みプロンプトの型（Spec, Tag, Character, ModelDef）
src/models.ts    モデル別の順序と正規化ルール
src/compile.ts   仕様の取り出し・検証・出力
src/templates.ts init テンプレート
src/cli.ts       CLI
```

## 評価の流れ

```
.np ファイル
   │  1. 字句解析・構文解析        src/dsl.ts
   ▼
AST
   │  2. 評価（prelude を読み込んだ環境で）  src/eval.ts
   ▼
DSL の値（属性集合）
   │  3. 仕様の取り出し            extractSpec    src/compile.ts
   ▼
Spec（正規化前の構造体）
   │  4. 検証                      validate
   ▼
エラー一覧（あれば出力せず停止）
   │  5. 出力                      emit
   ▼
positive / negative 文字列
```

検証と出力を分けているのは、「1 つでも違反があれば出力しない」を確実にするためです。エラーが 0 件のときだけ `emit` を呼びます。

## 位置情報

エラーに `ファイル:行:列` とキャレットを付けるため、評価器は**オブジェクトを作った場所**を `WeakMap`（`Context.pos`）に記録します。値そのものは汚しません。

`character { ... }` のように prelude の関数を通すと、返ってくる属性集合の位置は prelude 側になってしまいます。そこで prelude は `__posOf __args` で**呼び出し側**の位置を `__src` に埋め込み、`extractSpec` はそれを優先して使います。そのため人物のエラーはユーザーのファイルの該当行を指します。

`__` で始まる属性は組み込み関数（`attrNames` など）と出力から除外されます。

## 遅延評価

`let` と `rec` の束縛はサンク（`Thunk`）で持ち、参照されたときに評価します。相互再帰が書けるのはこのためです。循環参照はサンクの再入で検出して `無限再帰を検出しました` にします。

`rec` の無い属性集合は、Nix と同じく要素同士を参照できません。評価は外側のスコープで行い、束縛は新しいフレームに置くので、属性集合のキーが外側の名前を隠すこともありません。

## なぜ DSL を自作したか

- プロンプトは「宣言」であって手続きではない。関数・`let`・`import` で共通化できると、同じ人物を何度も書かずに済む
- モデルごとの差（順序、語彙、記法）をソースに漏らさず、バックエンドに閉じ込めたかった
- 検証を「書く前」ではなく「コンパイル時」に強制したかった
- Nix をそのまま使う手もあったが、nix コマンドへの依存を作らず、エラーメッセージを自分の言葉で書けるようにした

## 拡張ポイント

| やりたいこと | 触る場所 |
| --- | --- |
| モデルを足す | `src/models.ts` の `MODELS`（[モデル](models.md#モデルを追加する)） |
| DSL のプリミティブを足す | `src/prelude.ts`（DSL で書ける） |
| 組み込み関数を足す | `src/eval.ts` の `makeBuiltins` |
| 文法を変える | `src/dsl.ts` |
| 検証ルールを足す | `src/compile.ts` の `validate` |
| 出力の組み立てを変える | `src/compile.ts` の `emit` |
| テンプレートを変える | `src/templates.ts` |

## テスト

```bash
bun test              # 32 件
bunx tsc --noEmit     # 型チェック
```

- `tests/dsl.test.ts` — 言語の基本（let、パターン引数、rec、with、組み込み、import、無限再帰）
- `tests/compile.test.ts` — モデルごとの順序と正規化、複数人の展開、違反系のエラー
- `tests/template.test.ts` — `init` テンプレートがそのままコンパイルできること

モデルを追加したら、`tests/template.test.ts` が自動でそのテンプレートもコンパイルするので、`order` の書き間違いはすぐ露見します。
