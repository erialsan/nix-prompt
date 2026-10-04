# nix-prompt 説明書

Nix 風の関数型・宣言的 DSL で画像生成プロンプトを書き、モデルごとに正しい順序へ正規化して出力するコンパイラの説明書です。

## 目次

| 文書 | 内容 |
| --- | --- |
| [チュートリアル](tutorial.md) | インストールから最初の1枚まで。エラーの直し方もここ |
| [DSL リファレンス](dsl.md) | 言語の文法・演算子・組み込み関数・プリミティブ |
| [プロンプト仕様](spec.md) | フィールド一覧、出力の組み立て方、検証ルール |
| [モデル](models.md) | モデル別の出力順と正規化、モデルの追加方法 |
| [CLI リファレンス](cli.md) | コマンドとオプション、出力形式 |
| [内部設計](design.md) | 構成と評価の流れ、拡張ポイント |

## 30秒でわかる全体像

```nix
{
  model = "anima";
  humans = 2;
  characters = [
    (character { gender = "girl"; name = "hatsune miku"; series = "vocaloid"; tags = { looks = [ "twintails" ]; }; })
    (character { gender = "boy"; tags = [ "black hair" "glasses" ]; })
  ];
  quality = [ "masterpiece" "best quality" ];
  rating = "safe";
  artists = [ "wlop" ];
  tags = [ "classroom" ];
}
```

```bash
$ bun run src/cli.ts miku.np
positive:
masterpiece, best quality, safe, 1girl, 1boy, hatsune miku, vocaloid, @wlop, classroom, 1st girl is hatsune miku and twintails., 2nd boy is black hair and glasses.
```

同じファイルを `--model illustrious` でコンパイルすると、**人数タグが先頭に移動**し、`@` が外れ、`safe` が `general` に変わります。ソースは書き換えません。
