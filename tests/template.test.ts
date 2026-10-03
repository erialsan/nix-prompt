import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compile } from "../src/compile";
import { modelIds } from "../src/models";
import { templateFor } from "../src/templates";

function withTempFile(name: string, content: string, fn: (file: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nix-prompt-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  try {
    fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("init テンプレート", () => {
  for (const id of modelIds()) {
    test(`${id} のテンプレートはそのままコンパイルできる`, () => {
      withTempFile(`${id}.np`, templateFor(id), (file) => {
        const result = compile(file);
        expect(result.model.id).toBe(id);
        expect(result.positive.length).toBeGreaterThan(0);
        expect(result.positive).toContain("1girl, 1boy");
      });
    });
  }

  test("テンプレートはモデルの出力順を反映する", () => {
    withTempFile("anima.np", templateFor("anima"), (file) => {
      expect(compile(file).positive.startsWith("masterpiece")).toBe(true);
    });
    withTempFile("illustrious.np", templateFor("illustrious"), (file) => {
      expect(compile(file).positive.startsWith("1girl, 1boy")).toBe(true);
    });
  });

  test("未知のモデルはエラー", () => {
    expect(() => templateFor("nope")).toThrow("未知のモデル");
  });
});
