import path from "node:path";
import { CompileError, Context, evaluateFile, formatError, makeBuiltins, type Pos } from "./eval";
import { Parser } from "./dsl";
import { PRELUDE_FILE, PRELUDE_SRC } from "./prelude";
import { Env, isAttrs, type AttrSet, type Value } from "./values";
import { getModel, modelIds } from "./models";
import type { Character, Gender, ModelDef, SectionKey, Spec, SrcRef, Tag } from "./spec";

export { CompileError, formatError, evaluateFile };
export type { Spec, Tag, Character, ModelDef, SectionKey };

const SPEC_FIELDS = [
  "model",
  "humans",
  "characters",
  "quality",
  "meta",
  "era",
  "rating",
  "artists",
  "series",
  "tags",
  "text",
  "negative",
  "allowMultipleSeries",
  "allowOther",
] as const;

export type CompileResult = {
  spec: Spec;
  model: ModelDef;
  positive: string;
  negative: string;
  notes: string[];
};

export class CompileFailure extends Error {
  constructor(
    public errors: CompileError[],
    public ctx: Context,
  ) {
    super("コンパイルに失敗しました");
    this.name = "CompileFailure";
  }
}

export function createContext(entryFile: string): Context {
  const ctx = new Context(path.resolve(entryFile));
  ctx.sources.set(PRELUDE_FILE, PRELUDE_SRC);
  return ctx;
}

export function programEnv(ctx: Context) {
  const env = new Env();
  const builtins = makeBuiltins();
  for (const [k, v] of Object.entries(builtins)) env.vars.set(k, v);
  env.vars.set("__ctx", ctx as unknown as Value);
  const root = evaluateFile(PRELUDE_FILE, ctx, env);
  if (!isAttrs(root)) throw new CompileError("prelude が属性集合を返しませんでした", PRELUDE_FILE, null);
  for (const [k, v] of Object.entries(root)) {
    if (!k.startsWith("__")) env.vars.set(k, v);
  }
  return env;
}

export function loadProgram(file: string, ctx: Context): Value {
  const env = programEnv(ctx);
  return evaluateFile(path.resolve(file), ctx, env);
}

function srcOf(v: Value, ctx: Context): SrcRef {
  if (!isAttrs(v)) return null;
  const at = ctx.pos.get(v as object);
  return at ? { file: at.file, line: at.pos.line, col: at.pos.col } : null;
}

function srcFromValue(v: Value): SrcRef {
  if (!isAttrs(v)) return null;
  const s = v["__src"];
  if (isAttrs(s) && typeof s.file === "string" && typeof s.line === "number" && typeof s.col === "number") {
    return { file: s.file, line: s.line, col: s.col };
  }
  return null;
}

function err(ctx: Context, message: string, src: SrcRef, hint?: string): CompileError {
  return new CompileError(message, src?.file ?? ctx.entryFile, src ? { line: src.line, col: src.col } : null, hint);
}

function expectString(v: Value, ctx: Context, field: string, src: SrcRef): string {
  if (typeof v === "string") return v;
  throw err(ctx, `'${field}' には文字列が必要です（${typeof v}）`, src);
}

function boolField(v: Value | undefined, def: boolean): boolean {
  return v === undefined ? def : v === true;
}

function toTags(v: Value, ctx: Context, field: string, src: SrcRef): Tag[] {
  const out: Tag[] = [];
  const items = Array.isArray(v) ? v : [v];
  for (const item of items) {
    const itemSrc = srcOf(item, ctx) ?? src;
    if (typeof item === "string") {
      out.push({ tag: item, weight: 1, src: itemSrc });
      continue;
    }
    if (isAttrs(item)) {
      const tag = item["tag"];
      const weight = item["weight"] ?? 1;
      if (typeof tag !== "string") {
        throw err(ctx, `'${field}' の要素に文字列の 'tag' が必要です`, itemSrc, `例: { tag = "chibi"; weight = 1.5; }`);
      }
      if (typeof weight !== "number") throw err(ctx, `'${field}' の 'weight' は数値が必要です`, itemSrc);
      const extra = Object.keys(item).filter((k) => !k.startsWith("__") && k !== "tag" && k !== "weight");
      if (extra.length > 0) throw err(ctx, `'${field}' の要素に未知のキー ${extra.join(", ")}`, itemSrc);
      out.push({ tag, weight, src: itemSrc });
      continue;
    }
    throw err(ctx, `'${field}' の要素は文字列か { tag; weight; } にしてください`, itemSrc);
  }
  return out;
}

export function extractSpec(value: Value, ctx: Context, modelOverride: string | null): { spec: Spec; errors: CompileError[] } {
  const errors: CompileError[] = [];
  const collect = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof CompileError) {
        errors.push(e);
        return fallback;
      }
      throw e;
    }
  };

  if (!isAttrs(value)) {
    throw err(ctx, `プロンプトファイルは属性集合 { ... } を返す必要があります（${typeof value}）`, null);
  }
  let body: AttrSet = value;
  if (isAttrs(value["prompt"])) body = { ...value, ...(value["prompt"] as AttrSet) };
  const src = srcOf(value, ctx);

  const unknown = Object.keys(body).filter((k) => !k.startsWith("__") && k !== "prompt" && !(SPEC_FIELDS as readonly string[]).includes(k));
  for (const k of unknown) {
    errors.push(
      err(ctx, `未知のフィールド '${k}' があります`, src, `使用できるフィールド: ${SPEC_FIELDS.join(", ")}`),
    );
  }

  const modelRaw = body["model"];
  const model = modelOverride ?? (typeof modelRaw === "string" ? modelRaw : null);

  const humansRaw = body["humans"];
  const humans = typeof humansRaw === "number" ? humansRaw : null;
  if (humansRaw !== undefined && humans === null) {
    errors.push(err(ctx, `'humans' には数値が必要です`, src));
  }
  if (humans !== null && (!Number.isInteger(humans) || humans < 0)) {
    errors.push(err(ctx, `'humans' は 0 以上の整数にしてください（${humans}）`, src));
  }

  const characters: Character[] = [];
  const charsRaw = body["characters"];
  if (charsRaw !== undefined) {
    if (!Array.isArray(charsRaw)) errors.push(err(ctx, `'characters' にはリストが必要です`, src));
    else
      charsRaw.forEach((c, i) => {
        const cSrc = srcFromValue(c) ?? srcOf(c, ctx) ?? src;
        if (!isAttrs(c)) {
          errors.push(err(ctx, `'characters[${i}]' は character { ... } で定義してください`, cSrc));
          return;
        }
        const genderRaw = c["gender"];
        let gender: Gender | null = null;
        if (typeof genderRaw === "string") {
          if (genderRaw === "girl" || genderRaw === "boy" || genderRaw === "other") gender = genderRaw;
          else errors.push(err(ctx, `'characters[${i}].gender' は girl / boy / other のいずれかです（${genderRaw}）`, cSrc));
        } else {
          errors.push(err(ctx, `'characters[${i}]' に gender がありません`, cSrc, `character { gender = "girl"; ... } の形で指定してください`));
        }
        const nameRaw = c["name"];
        const seriesRaw = c["series"];
        const textRaw = c["text"];
        const extra = Object.keys(c).filter(
          (k) => !k.startsWith("__") && !["gender", "name", "tags", "series", "text"].includes(k),
        );
        for (const k of extra) errors.push(err(ctx, `'characters[${i}]' に未知のキー '${k}'`, cSrc));
        characters.push({
          gender,
          name: typeof nameRaw === "string" ? nameRaw : null,
          series: typeof seriesRaw === "string" ? seriesRaw : null,
          text: typeof textRaw === "string" ? textRaw : null,
          tags: c["tags"] === undefined ? [] : collect(() => toTags(c["tags"] as Value, ctx, `characters[${i}].tags`, cSrc), []),
          src: cSrc,
        });
      });
  }

  const tagField = (key: string): Tag[] =>
    body[key] === undefined ? [] : collect(() => toTags(body[key] as Value, ctx, key, src), []);

  const textRaw = body["text"];
  let text: string[] = [];
  if (textRaw !== undefined) {
    const arr = Array.isArray(textRaw) ? textRaw : [textRaw];
    text = arr.map((t) => expectString(t, ctx, "text", src));
  }

  const spec: Spec = {
    model,
    humans,
    characters,
    quality: tagField("quality"),
    meta: tagField("meta"),
    era: tagField("era"),
    rating: typeof body["rating"] === "string" ? body["rating"] : null,
    artists: tagField("artists"),
    series: tagField("series"),
    tags: tagField("tags"),
    text,
    negative: tagField("negative"),
    allowMultipleSeries: boolField(body["allowMultipleSeries"], false),
    allowOther: boolField(body["allowOther"], false),
    src,
  };
  return { spec, errors };
}

const COUNT_RE = /^(\d+)\s*(girl|boy|other)s?$/;
const ALLOWED_UNDERSCORE = /^score_[0-9]$/;
const EMOTICON_UNDERSCORE = /^[^A-Za-z0-9]*_[^A-Za-z0-9]*$/;

export function validate(spec: Spec, model: ModelDef | undefined, ctx: Context): CompileError[] {
  const errors: CompileError[] = [];

  if (spec.model === null) {
    errors.push(err(ctx, "model が指定されていません", spec.src, `--model か、ファイル内の model = "..." で指定してください（利用可能: ${modelIds().join(", ")}）`));
  } else if (!model) {
    errors.push(err(ctx, `未知のモデル '${spec.model}'`, spec.src, `利用可能: ${modelIds().join(", ")}`));
  }

  const declared = spec.humans;
  const n = spec.characters.length;
  if (declared !== null && n > declared) {
    errors.push(
      err(ctx, `humans = ${declared} と宣言されていますが、${n} 人分の定義があります`, spec.src, "宣言した人数以下の定義にしてください"),
    );
  }
  if (declared !== null && n < declared) {
    errors.push(
      err(ctx, `humans = ${declared} と宣言されていますが、定義は ${n} 人分しかありません`, spec.src, "各人物に character { ... } を書いてください"),
    );
  }

  const tally: Record<string, number> = { girl: 0, boy: 0, other: 0 };
  spec.characters.forEach((c, i) => {
    if (c.gender) tally[c.gender]++;
    if (c.gender === "other" && !spec.allowOther) {
      errors.push(
        err(ctx, `'characters[${i}]' の gender = "other" は許可されていません`, c.src, "girl / boy を使うか、allowOther = true を指定してください"),
      );
    }
    if (c.tags.length === 0 && !(c.text && c.text.trim())) {
      errors.push(
        err(ctx, `'characters[${i}]' に特徴の定義がありません`, c.src, "tags か text で髪型・服装などを書いてください"),
      );
    }
  });

  const seriesSet = new Set<string>();
  for (const s of spec.series) seriesSet.add(s.tag);
  for (const c of spec.characters) if (c.series) seriesSet.add(c.series);
  if (seriesSet.size > 1 && !spec.allowMultipleSeries) {
    errors.push(
      err(ctx, `複数の作品が混在しています: ${[...seriesSet].join(", ")}`, spec.src, "1つのプロンプトには1作品だけにしてください（意図的な場合は allowMultipleSeries = true）"),
    );
  }

  for (const field of ["quality", "meta", "era", "artists", "series", "tags", "negative"] as const) {
    for (const t of spec[field] as Tag[]) checkTag(t, field, spec, errors, ctx);
  }
  spec.characters.forEach((c, i) => c.tags.forEach((t) => checkTag(t, `characters[${i}].tags`, spec, errors, ctx)));

  if (spec.rating !== null && model) {
    const normalized = model.ratingAliases[spec.rating] ?? spec.rating;
    if (!model.ratings.includes(normalized)) {
      errors.push(
        err(ctx, `'rating = "${spec.rating}"' は ${model.id} では使えません`, spec.src, `${model.id} のレーティング: ${model.ratings.join(", ")}`),
      );
    }
  }

  if (model) {
    const derivedCounts = countsOf(tally);
    const declaredCounts = new Set<string>();
    for (const t of [...spec.quality, ...spec.tags]) {
      const m = COUNT_RE.exec(t.tag.trim());
      if (m) declaredCounts.add(t.tag.trim().replace(/\s+/, " ").replace(/(\d+)\s+/, "$1"));
    }    for (const dc of declaredCounts) {
      if (!derivedCounts.includes(dc)) {
        errors.push(
          err(ctx, `人数タグ '${dc}' が宣言された人物構成と一致しません`, spec.src, `characters から導出される人数タグ: ${derivedCounts.join(", ") || "なし"}`),
        );
      }
    }
  }

  return errors;
}

function checkTag(t: Tag, field: string, spec: Spec, errors: CompileError[], ctx: Context): void {
  const raw = t.tag;
  if (raw.trim() === "") {
    errors.push(err(ctx, `'${field}' に空のタグがあります`, t.src));
    return;
  }
  const model = spec.model ? getModel(spec.model) : undefined;
  if (!model) return;
  if (model.rejectUnderscore && raw.includes("_")) {
    if (!ALLOWED_UNDERSCORE.test(raw.trim()) && !EMOTICON_UNDERSCORE.test(raw.trim())) {
      errors.push(
        err(ctx, `タグ '${raw}' にアンダースコアは使えません（${model.id}）`, t.src, `'${raw.replace(/_/g, " ")}' のようにスペースに置き換えてください`),
      );
    }
  }
}

export function countsOf(tally: Record<string, number>): string[] {
  const out: string[] = [];
  for (const g of ["girl", "boy", "other"] as const) {
    const n = tally[g] ?? 0;
    if (n > 0) out.push(`${n}${g}${n > 1 ? "s" : ""}`);
  }
  return out;
}

function formatWeight(w: number, model: ModelDef): string {
  const scaled = w * model.weightScale;
  const rounded = Math.round(scaled * 10) / 10;
  return String(rounded);
}

function renderTag(t: Tag, model: ModelDef, prefix = ""): string {
  let text = t.tag.trim().replace(/\s+/g, " ");
  if (model.escapeParens) {
    text = text.replace(/([()])/g, "\\$1");
  }
  const body = `${prefix}${text}`;
  if (Math.abs(t.weight - 1) < 1e-9) return body;
  return `(${body}:${formatWeight(t.weight, model)})`;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

export function emit(spec: Spec, model: ModelDef): { positive: string; negative: string; notes: string[] } {
  const notes: string[] = [];
  const tally: Record<string, number> = { girl: 0, boy: 0, other: 0 };
  for (const c of spec.characters) if (c.gender) tally[c.gender]++;

  const dropCounts = (t: Tag) => !COUNT_RE.test(t.tag.trim());

  const sections: Record<SectionKey, string[]> = {
    quality: spec.quality.filter(dropCounts).map((t) => renderTag(t, model)),
    meta: spec.meta.map((t) => renderTag(t, model)),
    era: spec.era.map((t) => renderTag(t, model)),
    rating: [],
    counts: countsOf(tally),
    characters: [],
    series: [],
    artists: spec.artists.map((t) => renderTag(t, model, model.artistPrefix)),
    tags: [],
    text: [],
  };

  if (spec.rating) {
    const normalized = model.ratingAliases[spec.rating] ?? spec.rating;
    if (normalized !== spec.rating) notes.push(`rating "${spec.rating}" を ${model.id} の "${normalized}" に正規化しました`);
    sections.rating = [normalized];
  }

  const seriesTags: string[] = [];
  const topSeries = spec.series.map((t) => renderTag(t, model));
  seriesTags.push(...topSeries);
  for (const c of spec.characters) {
    if (c.series && !seriesTags.includes(renderTag({ tag: c.series, weight: 1, src: c.src }, model))) {
      seriesTags.push(renderTag({ tag: c.series, weight: 1, src: c.src }, model));
    }
  }
  sections.series = seriesTags;

  const names = spec.characters.map((c) => c.name).filter((x): x is string => !!x);
  sections.characters = names.map((nm) => renderTag({ tag: nm, weight: 1, src: spec.src }, model));

  const charTags = spec.characters.flatMap((c) => c.tags);
  if (spec.characters.length <= 1) {
    sections.tags = [...spec.tags.filter(dropCounts).map((t) => renderTag(t, model)), ...charTags.map((t) => renderTag(t, model))];
  } else {
    sections.tags = spec.tags.filter(dropCounts).map((t) => renderTag(t, model));
    spec.characters.forEach((c, i) => {
      if (c.text && c.text.trim()) {
        sections.text.push(c.text.trim());
        return;
      }
      const label = `${ORDINALS[i] ?? `${i + 1}th`} ${c.gender ?? "person"}`;
      const parts = [c.name, ...c.tags.map((t) => stripWeight(t.tag))].filter((x): x is string => !!x);
      if (parts.length > 0) sections.text.push(`${label} is ${parts.join(" and ")}.`);
    });
  }

  const userText = spec.text.map((s) => s.trim()).filter((s) => s !== "");
  const allText = [...sections.text, ...userText];
  if (allText.length > 0) sections.text = allText;
  if (spec.characters.length > 1) notes.push("人数が2人以上のため、各人物の特徴を自然言語の文へ展開しました");

  const flat: string[] = [];
  for (const key of model.order) {
    for (const item of sections[key]) if (item !== "") flat.push(item);
  }

  const negativeItems = [...model.defaultNegative, ...spec.negative.map((t) => renderTag(t, model))];
  if (!model.negativeUsable && spec.negative.length > 0) notes.push(`${model.id} ではネガティブプロンプトが機能しません`);

  return {
    positive: flat.join(", "),
    negative: negativeItems.join(", "),
    notes,
  };
}

function stripWeight(tag: string): string {
  return tag.trim().replace(/\s+/g, " ");
}

export function compile(file: string, options: { model?: string | null } = {}): CompileResult {
  const ctx = createContext(file);
  const modelOverride = options.model ?? null;
  const value = loadProgram(file, ctx);
  const { spec, errors: extractErrors } = extractSpec(value, ctx, modelOverride);
  const model = spec.model ? getModel(spec.model) : undefined;
  const errors = [...extractErrors, ...validate(spec, model, ctx)];
  if (errors.length > 0) throw new CompileFailure(errors, ctx);
  const out = emit(spec, model!);
  return { spec, model: model!, positive: out.positive, negative: out.negative, notes: [...model!.notes, ...out.notes] };
}

export function parseFileOnly(src: string, file: string): void {
  new Parser(src, file).parseProgram();
}

export type { Pos };
