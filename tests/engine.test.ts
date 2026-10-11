import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../src/node-io";
import { compile } from "../src/compile";
import { compileFiles, sameFile, tabText, type VirtualFile } from "../web/src/lib/engine";

const SOLO = `{
  model = "anima";
  humans = 1;
  characters = [ (character { gender = "girl"; tags = [ "twintails" ]; }) ];
  quality = [ "masterpiece" ];
  rating = "safe";
}
`;

describe("engine（ブラウザと同じメモリ経路）", () => {
  test("ファイルシステム無しでコンパイルできる", () => {
    const outcome = compileFiles([{ path: "/main.np", source: SOLO }]);
    expect(outcome.ok).toBe(true);
    expect(outcome.model).toBe("anima");
    expect(outcome.positive.startsWith("masterpiece")).toBe(true);
    expect(outcome.positive).toContain("1girl");
    expect(outcome.diagnostics).toEqual([]);
  });

  test("CLI 経路（compile + fs）と同じ出力になる", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "np-engine-"));
    const file = path.join(dir, "main.np");
    fs.writeFileSync(file, SOLO);
    try {
      const viaCli = compile(file);
      const viaWeb = compileFiles([{ path: "/main.np", source: SOLO }]);
      expect(viaWeb.positive).toBe(viaCli.positive);
      expect(viaWeb.negative).toBe(viaCli.negative);
      expect(viaWeb.notes).toEqual(viaCli.notes);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("モデルの上書き（--model 相当）が効く", () => {
    const anima = compileFiles([{ path: "/main.np", source: SOLO }]);
    const illustrious = compileFiles([{ path: "/main.np", source: SOLO }], { model: "illustrious" });
    expect(anima.positive.indexOf("masterpiece")).toBeLessThan(anima.positive.indexOf("1girl"));
    expect(illustrious.positive.startsWith("1girl")).toBe(true);
    expect(illustrious.model).toBe("illustrious");
  });

  test("import ./x.np を仮想FSで解決する", () => {
    const files: VirtualFile[] = [
      {
        path: "/main.np",
        source: `let base = import ./base.np; in {
  model = "anima";
  humans = 1;
  characters = [ (character { gender = "girl"; tags = base.looks; }) ];
  rating = "safe";
}
`,
      },
      { path: "/base.np", source: `{ looks = [ "twintails" ]; }\n` },
    ];
    const outcome = compileFiles(files);
    expect(outcome.ok).toBe(true);
    expect(outcome.positive).toContain("twintails");
  });

  test("仮想FSに無い import は読み込みエラーとして報告する", () => {
    const outcome = compileFiles([
      { path: "/main.np", source: `{ model = "anima"; humans = 0; characters = [ ]; tags = import ./missing.np; }\n` },
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics[0]?.message).toContain("ファイルを読み込めません");
  });

  test("検証エラーは行・列とキャレット付きで返る", () => {
    const source = `{
  model = "anima";
  humans = 2;
  characters = [ (character { gender = "girl"; tags = [ "twintails" ]; }) ];
}
`;
    const outcome = compileFiles([{ path: "/main.np", source }]);
    expect(outcome.ok).toBe(false);
    const diagnostic = outcome.diagnostics.find((d) => d.message.includes("定義は 1 人分しかありません"));
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.line).toBeGreaterThan(0);
    expect(diagnostic?.text).toContain("^");
  });

  test("構文エラーは該当ファイルと位置を返す", () => {
    const files: VirtualFile[] = [
      { path: "/main.np", source: `{ model = "anima"; humans = 0; characters = [ ]; tags = import ./bad.np; }\n` },
      { path: "/bad.np", source: `{ broken = ; }\n` },
    ];
    const outcome = compileFiles(files);
    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics[0]?.file).toBe("/bad.np");
    expect(outcome.diagnostics[0]?.line).toBe(1);
    expect(outcome.diagnostics[0]?.text).toContain("syntax error");
  });

  test("エントリが先頭でなくても entry 指定で解決する", () => {
    const files: VirtualFile[] = [
      { path: "/other.np", source: `{ looks = [ "black hair" ]; }\n` },
      { path: "/main.np", source: SOLO },
    ];
    const outcome = compileFiles(files, { entry: "/main.np" });
    expect(outcome.ok).toBe(true);
    expect(outcome.positive).toContain("twintails");
  });

  test("relative なパスや ./ 付きパスも同じファイルとして扱う", () => {
    expect(sameFile("main.np", "/main.np")).toBe(true);
    expect(sameFile("./main.np", "main.np")).toBe(true);
    expect(sameFile("<prelude>", "main.np")).toBe(false);
    const outcome = compileFiles([{ path: "main.np", source: SOLO }], { entry: "./main.np" });
    expect(outcome.ok).toBe(true);
  });

  test("tabText は JSON タブで pretty print する", () => {
    const outcome = compileFiles([{ path: "/main.np", source: SOLO }]);
    const json = tabText(outcome, "json");
    expect(JSON.parse(json).model).toBe("anima");
    expect(tabText(outcome, "positive")).toBe(outcome.positive);
  });
});
