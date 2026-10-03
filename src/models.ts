import type { ModelDef } from "./spec";

export type { ModelDef };

export const MODELS: Record<string, ModelDef> = {
  anima: {
    id: "anima",
    label: "Anima (Base/Aesthetic/Turbo)",
    order: ["quality", "meta", "era", "rating", "counts", "characters", "series", "artists", "tags", "text"],
    ratings: ["safe", "sensitive", "nsfw", "explicit"],
    ratingAliases: { general: "safe", questionable: "sensitive" },
    artistPrefix: "@",
    animalFocus: "animal focus",
    weightScale: 7,
    escapeParens: true,
    rejectUnderscore: true,
    negativeUsable: true,
    defaultNegative: [
      "worst quality",
      "low quality",
      "score_1",
      "score_2",
      "score_3",
      "6 fingers",
      "6 toes",
      "ai-generated",
      "bad eyes",
      "bad pupils",
      "bad iris",
      "bad hands",
      "bad fingers",
      "watermark",
      "patreon logo",
    ],
    notes: [
      "アーティストタグには '@' を付与して出力します。",
      "タグ内のアンダースコアは禁止のため検出時にエラーにします。",
      "作品名などの '()' は自動でエスケープします。",
      "重み付けは相対値で書き、このモデルでは 1.0 を基準に約7倍へスケールします。",
    ],
  },
  illustrious: {
    id: "illustrious",
    label: "Illustrious / SDXL系 (人物を先頭に置く)",
    order: ["counts", "characters", "series", "artists", "quality", "meta", "era", "rating", "tags", "text"],
    ratings: ["general", "sensitive", "questionable", "nsfw"],
    ratingAliases: { safe: "general" },
    artistPrefix: "",
    animalFocus: "animal focus",
    weightScale: 1.2,
    escapeParens: false,
    rejectUnderscore: false,
    negativeUsable: true,
    defaultNegative: ["worst quality", "low quality", "bad anatomy", "jpeg artifacts", "watermark"],
    notes: [
      "人数タグを先頭に置くモデル向けの並びです。",
      "重み付けは相対値で書き、このモデルでは 1.0 を基準に約1.2倍へスケールします。",
    ],
  },
};

export function getModel(id: string): ModelDef | undefined {
  return MODELS[id];
}

export function modelIds(): string[] {
  return Object.keys(MODELS);
}
