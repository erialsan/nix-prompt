export type SrcRef = { file: string; line: number; col: number } | null;

export type Tag = { tag: string; weight: number; src: SrcRef };

export type Gender = "girl" | "boy" | "other";

export type Character = {
  gender: Gender | null;
  name: string | null;
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
  weightScale: number;
  escapeParens: boolean;
  rejectUnderscore: boolean;
  defaultNegative: string[];
  negativeUsable: boolean;
  notes: string[];
};
