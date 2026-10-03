import { describe, expect, test } from "bun:test";
import { createContext, evaluateFile, programEnv } from "../src/compile";
import { isAttrs, type Value } from "../src/values";

function run(src: string): Value {
  const file = "/virtual/test.np";
  const ctx = createContext(file);
  ctx.sources.set(file, src);
  const env = programEnv(ctx);
  return evaluateFile(file, ctx, env);
}

function attrs(v: Value) {
  if (!isAttrs(v)) throw new Error("属性集合ではありません");
  return v;
}

describe("DSL", () => {
  test("let と関数適用", () => {
    expect(run("let f = x: x + 1; in f 41")).toBe(42);
  });

  test("文字列補間", () => {
    expect(run(`let name = "miku"; in "hello \${name}!"`)).toBe("hello miku!");
  });

  test("パターン引数と既定値", () => {
    const v = attrs(run(`let f = { a, b ? 2, ... }: a + b; in { x = f { a = 1; }; y = f { a = 1; b = 10; }; }`));
    expect(v.x).toBe(3);
    expect(v.y).toBe(11);
  });

  test("再帰属性集合と相互参照", () => {
    const v = attrs(run(`rec { a = 1; b = a + 1; c = b * 2; }`));
    expect([v.a, v.b, v.c]).toEqual([1, 2, 4]);
  });

  test("inherit は現在のスコープから取り込む", () => {
    const v = attrs(run(`let x = 7; in { inherit x; y = x + 1; }`));
    expect(v.x).toBe(7);
    expect(v.y).toBe(8);
  });

  test("with は名前解決のフォールバックになる", () => {
    expect(run(`with { a = 3; }; a * 2`)).toBe(6);
  });

  test("組み込み関数 map / filter / concatStringsSep", () => {
    expect(run(`map (x: x * 2) [ 1 2 3 ]`)).toEqual([2, 4, 6]);
    expect(run(`filter (x: x > 1) [ 1 2 3 ]`)).toEqual([2, 3]);
    expect(run(`concatStringsSep ", " [ "a" "b" ]`)).toBe("a, b");
  });

  test("属性集合のマージと has-attr", () => {
    expect(run(`({ a = 1; } // { b = 2; }) ? b`)).toBe(true);
    expect(run(`{ a = 1; } ? z`)).toBe(false);
    expect(run(`{ a = 1; }.b or "none"`)).toBe("none");
  });

  test("未定義の名前はエラー", () => {
    expect(() => run("nope")).toThrow("未定義の名前");
  });

  test("無限再帰を検出する", () => {
    expect(() => run("let a = a; in a")).toThrow("無限再帰");
  });

  test("import で別ファイルの定義を読み込む", () => {
    const file = "/virtual/test.np";
    const ctx = createContext(file);
    ctx.sources.set(file, `let lib = import ./lib.np; in lib.greet "miku"`);
    ctx.sources.set("/virtual/lib.np", `{ greet = name: "hello " + name; }`);
    expect(evaluateFile(file, ctx, programEnv(ctx))).toBe("hello miku");
  });
});
