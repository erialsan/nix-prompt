#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { CompileFailure, compile, createContext, formatError } from "./compile";
import { MODELS } from "./models";
import { templateFor, templateList } from "./templates";
import { CompileError, SyntaxError_ } from "./eval";

function usage(): string {
  return [
    "使い方:",
    "  nix-prompt <file.np> [options]   プロンプトをコンパイルして出力",
    "  nix-prompt init <model>         モデル別のテンプレートを出力",
    "",
    "options:",
    "  --model <id>    出力先モデルを指定（ファイル内の model より優先）",
    "  --json          JSONで出力",
    "  --positive      ポジティブのみ出力",
    "  --negative      ネガティブのみ出力",
    "  --notes         正規化のメモを表示",
    "  --out <file>    init のテンプレートをファイルに書き出す",
    "  --list-models   利用可能なモデル一覧",
    "  -h, --help      このヘルプ",
    "",
    `利用可能なモデル:\n${templateList()}`,
  ].join("\n");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help") || args.length === 0) {
    console.log(usage());
    return args.length === 0 ? 1 : 0;
  }
  if (args.includes("--list-models")) {
    for (const m of Object.values(MODELS)) console.log(`${m.id}\t${m.label}`);
    return 0;
  }

  if (args[0] === "init") {
    const model = args[1] && !args[1].startsWith("-") ? args[1] : null;
    if (!model) {
      console.error("モデルを指定してください（例: nix-prompt init anima）");
      console.error(`利用可能なモデル:\n${templateList()}`);
      return 1;
    }
    let source: string;
    try {
      source = templateFor(model);
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
    const outIdx = args.indexOf("--out");
    if (outIdx >= 0) {
      const out = args[outIdx + 1];
      if (!out) {
        console.error("--out には出力先パスが必要です");
        return 1;
      }
      if (fs.existsSync(out)) {
        console.error(`${out} は既に存在します`);
        return 1;
      }
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, source);
      console.log(`${out} に ${model} のテンプレートを書き出しました`);
      return 0;
    }
    process.stdout.write(source);
    return 0;
  }

  const VALUE_OPTIONS = new Set(["--model", "--out"]);
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_OPTIONS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    positionals.push(a);
  }

  const file = positionals[0];
  if (!file) {
    console.error("プロンプトファイルを指定してください");
    console.error(usage());
    return 1;
  }
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : null;
  if (modelIdx >= 0 && !model) {
    console.error("--model には値が必要です");
    return 1;
  }

  const json = args.includes("--json");
  const onlyPositive = args.includes("--positive");
  const onlyNegative = args.includes("--negative");
  const showNotes = args.includes("--notes");

  try {
    const result = compile(file, { model });
    if (json) {
      console.log(
        JSON.stringify({ model: result.model.id, positive: result.positive, negative: result.negative, notes: result.notes }, null, 2),
      );
      return 0;
    }
    if (!onlyNegative) console.log(`positive:\n${result.positive}\n`);
    if (!onlyPositive) console.log(`negative:\n${result.negative}`);
    if (showNotes) {
      console.log("\nnotes:");
      for (const note of result.notes) console.log(`  - ${note}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof CompileFailure) {
      for (const error of e.errors) console.error(formatError(error, e.ctx));
      return 1;
    }
    if (e instanceof CompileError) {
      console.error(formatError(e, createContext(file)));
      return 1;
    }
    if (e instanceof SyntaxError_) {
      console.error(`${e.file || file}:${e.pos.line}:${e.pos.col}: syntax error: ${e.message}`);
      return 1;
    }
    if (e instanceof Error) {
      console.error(`${file}: error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv));
}
