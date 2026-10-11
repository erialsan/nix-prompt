import { describe, expect, test } from "bun:test";
import path from "node:path";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "../src/pathutil";

describe("pathutil", () => {
  /** 正規化済みの絶対パス（node:path と完全に一致する範囲） */
  const normalizedCases = ["/", "/a", "/a/b", "/a/b/c.np"];
  /** node:path の dirname は正規化しないので、`.` `..` `//` は resolve だけで比較する */
  const unnormalizedCases = ["/a/./b", "/a/b/../c.np", "/a/../b", "//a//b"];

  test("resolve は絶対パス入力で node:path.posix.resolve と一致する", () => {
    for (const input of [...normalizedCases, ...unnormalizedCases]) {
      expect(resolve(input)).toBe(path.posix.resolve(input));
    }
  });

  test("dirname / basename は node:path.posix と一致する", () => {
    for (const input of normalizedCases) {
      expect(dirname(input)).toBe(path.posix.dirname(input));
      expect(basename(input)).toBe(path.posix.basename(input));
    }
  });

  test("dirname は引数を正規化してから親を返す（node は正規化しない点が違う）", () => {
    // node:path.posix.dirname("/a/../b") === "/a/.." / dirname("//a//b") === "//a"
    expect(dirname("/a/../b")).toBe("/");
    expect(dirname("//a//b")).toBe("/a");
    expect(dirname("/a/./b")).toBe("/a");
    expect(dirname("/a/b/../c.np")).toBe("/a");
    // 正規化済みのパスしか渡さない前提では node と一致する
    expect(dirname("/a/b/c.np")).toBe("/a/b");
    expect(dirname("/a")).toBe("/");
    expect(dirname("c.np")).toBe(".");
  });

  test("join は node:path.posix.join と一致する", () => {
    expect(join("a", "b")).toBe(path.posix.join("a", "b"));
    expect(join("/a", "..", "b")).toBe(path.posix.join("/a", "..", "b"));
    expect(join("/a/", "/b")).toBe(path.posix.join("/a/", "/b"));
  });

  test("相対パスは与えた cwd で解決する（ブラウザでは / が基準）", () => {
    expect(resolve("/base", "sub/x.np")).toBe("/base/sub/x.np");
    expect(resolve("/", "./main.np")).toBe("/main.np");
    // import の解決は「親ディレクトリ + 相対パス」で行う（eval.ts と同じ）
    expect(resolve(dirname("/main.np"), "./sub.np")).toBe("/sub.np");
    expect(resolve(dirname("/virtual/dir/a.np"), "../b.np")).toBe("/virtual/b.np");
  });

  test("後ろの絶対パスが前の指定を打ち消す（node と同じ）", () => {
    expect(resolve("/ignored", "/kept")).toBe("/kept");
  });

  test("末尾スラッシュは落とす（ファイルパスしか扱わないため）", () => {
    expect(normalize("/a/b/")).toBe("/a/b");
    expect(normalize("a/b/")).toBe("a/b");
  });

  test("isAbsolute", () => {
    expect(isAbsolute("/a")).toBe(true);
    expect(isAbsolute("./a")).toBe(false);
  });
});
