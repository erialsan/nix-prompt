/**
 * examples/ 以下の .np を Web UI 用の TypeScript モジュールへ埋め込みます。
 *
 *   bun run web:examples
 *
 * 生成物: web/src/lib/examples.generated.ts
 * （Vite のルート外にあるファイルを ?raw で読むより、生成物をコミットする方が確実）
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const examplesDir = path.join(root, "examples");
const errorsDir = path.join(examplesDir, "errors");
const outFile = path.join(root, "web", "src", "lib", "examples.generated.ts");

type Entry = { name: string; title: string; source: string };

const TITLES: Record<string, string> = {
  "solo.np": "1人（タグ形式）",
  "two-people.np": "2人（自然言語へ展開）",
  "girl-and-cat.np": "girl + animal",
  "count-mismatch.np": "人数タグの不一致",
  "duplicate-character.np": "同一キャラクターの重複",
  "multiple-series.np": "複数作品の混在",
  "too-many.np": "人数オーバー",
  "underscore.np": "アンダースコア（Anima）",
};

function collect(dir: string, prefix: string): Entry[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".np"))
    .sort()
    .map((f) => {
      const rel = prefix ? `${prefix}/${f}` : f;
      return {
        name: rel,
        title: TITLES[f] ?? f.replace(/\.np$/, ""),
        source: fs.readFileSync(path.join(dir, f), "utf8"),
      };
    });
}

const examples = collect(examplesDir, "");
const errorExamples = collect(errorsDir, "errors");

const render = (name: string, entries: Entry[]) =>
  `export const ${name}: ExampleEntry[] = ${JSON.stringify(entries, null, 2)};\n`;

const header = `// このファイルは scripts/gen-examples.ts が生成します。手で編集しないでください。
// 再生成: bun run web:examples

export type ExampleEntry = {
  /** examples/ からの相対パス（表示名） */
  name: string;
  /** UI に出す短い説明 */
  title: string;
  /** プロンプトのソース */
  source: string;
};

`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, header + render("EXAMPLES", examples) + "\n" + render("ERROR_EXAMPLES", errorExamples));
console.log(
  `${path.relative(root, outFile)} を生成しました（正常系 ${examples.length} 件 / 違反例 ${errorExamples.length} 件）`,
);
