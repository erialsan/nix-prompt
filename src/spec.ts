export type SrcRef = { file: string; line: number; col: number } | null;

export type Tag = { tag: string; weight: number; src: SrcRef };

/** 被写体の種類。animal は人間以外で、人数タグを出さず species と animal focus で表す。 */
export type Gender = "girl" | "boy" | "other" | "animal";

export type Character = {
  gender: Gender | null;
  name: string | null;
  /** gender = "animal" のときの種（"cat" など）。タグとして出力する。 */
  species: string | null;
  tags: Tag[];
  series: string | null;
  text: string | null;
  src: SrcRef;
};

export type Spec = {
  model: string | null;
  humans: number | null;
  characters: Character[];
  quality: Tag[];
  meta: Tag[];
  era: Tag[];
  rating: string | null;
  artists: Tag[];
  series: Tag[];
  tags: Tag[];
  text: string[];
  negative: Tag[];
  allowMultipleSeries: boolean;
  allowOther: boolean;
  src: SrcRef;
};

export type SectionKey =
  | "quality"
  | "meta"
  | "era"
  | "rating"
  | "counts"
  | "characters"
  | "series"
  | "artists"
  | "tags"
  | "text";

export type ModelDef = {
  id: string;
  label: string;
  order: SectionKey[];
  ratings: string[];
  ratingAliases: Record<string, string>;
  artistPrefix: string;
  /** 動物の被写体がいるときに人数セクションへ足すタグ。null なら出さない。 */
  animalFocus: string | null;
  weightScale: number;
  escapeParens: boolean;
  rejectUnderscore: boolean;
  defaultNegative: string[];
  negativeUsable: boolean;
  notes: string[];
};
