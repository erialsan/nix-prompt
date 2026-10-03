import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { CompileError, CompileFailure, compile } from "../src/compile";

const root = path.resolve(import.meta.dir, "..");
const ex = (p: string) => path.join(root, "examples", p);

function errorMessages(file: string, model?: string): string[] {
  const withHint = (e: CompileError) => e.message + (e.hint ? ` | ${e.hint}` : "");
  try {
    compile(file, { model });
  } catch (e) {
    if (e instanceof CompileFailure) return e.errors.map(withHint);
    if (e instanceof CompileError) return [withHint(e)];
    throw e;
  }
  throw new Error("エラーになるはずがコンパイルに成功しました");
}

describe("モデルごとの順序", () => {
  test("anima は品質タグを先頭に置く", () => {
    const { positive } = compile(ex("solo.np"));
    expect(positive.startsWith("masterpiece")).toBe(true);
    expect(positive).toContain("sensitive");
    expect(positive.indexOf("masterpiece")).toBeLessThan(positive.indexOf("1girl"));
  });

  test("illustrious は人数タグを先頭に置く", () => {
    const { positive } = compile(ex("solo.np"), { model: "illustrious" });
    expect(positive.startsWith("1girl")).toBe(true);
    expect(positive.indexOf("1girl")).toBeLessThan(positive.indexOf("masterpiece"));
  });

  test("同じソースから全セクションを同じ内容で出力する", () => {
    const anima = compile(ex("solo.np"));
    const ill = compile(ex("solo.np"), { model: "illustrious" });
    for (const token of ["hatsune miku", "vocaloid", "stage lights", "holding microphone"]) {
      expect(anima.positive).toContain(token);
      expect(ill.positive).toContain(token);
    }
  });
});

describe("モデルごとの正規化", () => {
  test("anima はアーティストに @ を付ける", () => {
    expect(compile(ex("solo.np")).positive).toContain("@wlop");
  });

  test("illustrious は @ を付けない", () => {
    expect(compile(ex("solo.np"), { model: "illustrious" }).positive).toContain("wlop");
    expect(compile(ex("solo.np"), { model: "illustrious" }).positive).not.toContain("@wlop");
  });

  test("重みは相対値で書き、モデルごとにスケールする", () => {
    expect(compile(ex("solo.np")).positive).toContain("(aqua eyes:10.5)");
    expect(compile(ex("solo.np"), { model: "illustrious" }).positive).toContain("(aqua eyes:1.8)");
  });

  test("レーティングをモデルごとの語彙に正規化する", () => {
    expect(compile(ex("solo.np"), { model: "illustrious" }).positive).toContain("sensitive");
    const r = compile(ex("two-people.np"), { model: "illustrious" });
    expect(r.positive).toContain("general");
  });

  test("作品名の括弧を anima 向けにエスケープする", () => {
    const errs = errorMessages(ex("errors/multiple-series.np"));
    expect(errs.some((m) => m.includes("複数の作品"))).toBe(true);
  });
});

describe("人物の展開", () => {
  test("2人のときは人数タグを作り、特徴を自然言語に展開する", () => {
    const { positive } = compile(ex("two-people.np"));
    expect(positive).toContain("1girl, 1boy");
    expect(positive).toContain("1st girl is hatsune miku and twintails and aqua eyes and neck ribbon.");
    expect(positive).toContain("2nd boy is black hair and glasses and school uniform.");
  });

  test("1人のときは人数タグと一緒にタグとして並べる", () => {
    const { positive } = compile(ex("solo.np"));
    expect(positive).toContain("1girl,");
    expect(positive).toContain("hatsune miku");
    expect(positive).toContain("neck ribbon");
    expect(positive).not.toContain("1st girl is");
  });

  test("ネガティブはモデル既定とユーザー指定を合成する", () => {
    const { negative } = compile(ex("solo.np"));
    expect(negative).toContain("worst quality");
    expect(negative).toContain("extra arms");
  });
});

describe("コンパイラが弾くもの", () => {
  test("宣言した人数より多い定義", () => {
    const errs = errorMessages(ex("errors/too-many.np"));
    expect(errs.some((m) => m.includes("humans = 2") && m.includes("3 人分"))).toBe(true);
  });

  test("複数作品の混在", () => {
    expect(errorMessages(ex("errors/multiple-series.np")).some((m) => m.includes("複数の作品が混在"))).toBe(true);
  });

  test("アンダースコア入りタグ（anima）", () => {
    const errs = errorMessages(ex("errors/underscore.np"));
    expect(errs.some((m) => m.includes("long_hair") && m.includes("アンダースコア"))).toBe(true);
    expect(errs.some((m) => m.includes("long hair"))).toBe(true);
  });

  test("人数タグと人物構成の不一致", () => {
    expect(errorMessages(ex("errors/count-mismatch.np")).some((m) => m.includes("2girls"))).toBe(true);
  });

  test("未知のモデル", () => {
    expect(errorMessages(ex("solo.np"), "unknown-model").some((m) => m.includes("未知のモデル"))).toBe(true);
  });

  test("gender のない人物", () => {
    const file = path.join(root, "examples", "errors", "no-gender.np");
    fs.writeFileSync(
      file,
      `{ model = "anima"; humans = 1; characters = [ (character { tags = [ "twintails" ]; }) ]; }\n`,
    );
    try {
      expect(errorMessages(file).some((m) => m.includes("必須引数 'gender'"))).toBe(true);
    } finally {
      fs.unlinkSync(file);
    }
  });
});
