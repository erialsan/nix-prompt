import { MODELS, modelIds, type ModelDef } from "./models";

const SECTION_LABELS: Record<string, string> = {
  quality: "品質",
  meta: "メタ",
  era: "年代",
  rating: "レーティング",
  counts: "人数タグ(自動生成)",
  characters: "キャラクター",
  series: "作品",
  artists: "アーティスト",
  tags: "その他のタグ",
  text: "自然言語",
};

export function templateFor(modelId: string): string {
  const model = MODELS[modelId];
  if (!model) {
    throw new Error(`未知のモデル '${modelId}'（利用可能: ${modelIds().join(", ")}）`);
  }
  return render(model);
}

function render(model: ModelDef): string {
  const order = model.order.map((k: string) => SECTION_LABELS[k] ?? k).join(" → ");
  const rating = model.ratings[0];
  const artistLine = model.artistPrefix
    ? `artists = [ "artist name" ];  # 出力時に '${model.artistPrefix}' が自動で付きます`
    : `artists = [ "artist name" ];`;
  return `# ${model.label} 用テンプレート
# 出力順: ${order}
# rating に使える値: ${model.ratings.join(" / ")}
# タグはタグ名をスペース区切りで書きます（アンダースコアは${model.rejectUnderscore ? "エラーになります" : "使えます"}）
# gender に使える値: girl / boy / other（要 allowOther = true）/ animal（species に種を書く）
# tags は looks / outfit / pose / item / other に分けて書けます（この順で出力。リスト形式も可）
{
  model = "${model.id}";

  humans = 2;
  characters = [
    (character {
      gender = "girl";
      name = "character name";
      series = "series name";
      tags = {
        looks  = [ "twintails" (weighted 1.2 "aqua eyes") ];
        outfit = [ "neck ribbon" ];
        pose   = [ "singing" ];
      };
    })
    (character {
      gender = "boy";
      tags = [ "black hair" "school uniform" ];
    })
  ];

  quality = [ "masterpiece" "best quality" ];
  meta = [ "highres" ];
  era = [ "year 2025" ];
  rating = "${rating}";
  ${artistLine}
  tags = [ "classroom" "sunlight" ];
  text = [ ];
  negative = [ ];
}
`;
}

export function templateList(): string {
  return Object.values(MODELS)
    .map((m) => `  ${m.id}\t${m.label}`)
    .join("\n");
}
