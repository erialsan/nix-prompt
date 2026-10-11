/**
 * Web UI からコンパイラを叩くための薄いラッパ。
 *
 * ここは DOM に触らないので `bun test` からそのまま検証できます。
 * ブラウザではファイルシステムが無いため、ソースはメモリ上の仮想FS
 * （`VirtualFile[]`）として渡し、`import ./x.np` もこの中で解決します。
 */
import { CompileError, CompileFailure, compile, createContext, formatError } from "../../../src/compile";
import type { Context } from "../../../src/eval";
import { SyntaxError_ } from "../../../src/dsl";
import { MODELS } from "../../../src/models";
import * as pathutil from "../../../src/pathutil";

export const ENTRY_PATH = "/main.np";
/** プリミティブ定義の仮想ファイル名（エラー表示に出る） */
export const PRELUDE_LABEL = "<prelude>";

export type VirtualFile = {
  /** 仮想FS上のパス。先頭が `/` の絶対パスに正規化して扱う。 */
  path: string;
  source: string;
};

export type Diagnostic = {
  file: string;
  line: number | null;
  col: number | null;
  message: string;
  hint: string | null;
  /** CLI の `formatError` と同じ体裁（該当行とキャレット付き） */
  text: string;
};

export type CompileOutcome = {
  ok: boolean;
  /** 実際に使われたモデル id（失敗時は null） */
  model: string | null;
  positive: string;
  negative: string;
  notes: string[];
  diagnostics: Diagnostic[];
};

export type CompileFilesOptions = {
  /** エントリの仮想パス。既定は先頭ファイル。 */
  entry?: string;
  /** ファイル内の `model` より優先するモデル。 */
  model?: string | null;
};

/**
 * 仮想FS上のソースをコンパイルする。
 * 例外は投げず、失敗は `diagnostics` に正規化して返す。
 */
export function compileFiles(files: VirtualFile[], options: CompileFilesOptions = {}): CompileOutcome {
  const entry = pathutil.resolve("/", options.entry ?? files[0]?.path ?? ENTRY_PATH);
  const model = options.model ?? null;
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(pathutil.resolve("/", file.path), file.source);
  }
  const reader = (p: string): string => {
    const source = sources.get(p);
    if (source === undefined) throw new Error(`仮想FSに ${p} がありません`);
    return source;
  };
  const contextOptions = { cwd: "/", reader, sources } as const;
  const context = createContext(entry, contextOptions);

  try {
    const result = compile(entry, { ...contextOptions, model });
    return {
      ok: true,
      model: result.model.id,
      positive: result.positive,
      negative: result.negative,
      notes: result.notes,
      diagnostics: [],
    };
  } catch (e) {
    return {
      ok: false,
      model: null,
      positive: "",
      negative: "",
      notes: [],
      diagnostics: toDiagnostics(e, context, entry),
    };
  }
}

/** 例外を UI で扱いやすい診断リストへ変換する。 */
export function toDiagnostics(e: unknown, context: Context, entry: string): Diagnostic[] {
  if (e instanceof CompileFailure) {
    return e.errors.map((error) => ({
      file: error.file,
      line: error.pos?.line ?? null,
      col: error.pos?.col ?? null,
      message: error.message,
      hint: error.hint ?? null,
      text: formatError(error, e.ctx),
    }));
  }
  if (e instanceof CompileError) {
    return [
      {
        file: e.file,
        line: e.pos?.line ?? null,
        col: e.pos?.col ?? null,
        message: e.message,
        hint: e.hint ?? null,
        text: formatError(e, context),
      },
    ];
  }
  if (e instanceof SyntaxError_) {
    const file = e.file || entry;
    const source = context.sources.get(pathutil.resolve("/", file));
    const snippet = source ? caretSnippet(source, e.pos.line, e.pos.col) : "";
    return [
      {
        file,
        line: e.pos.line,
        col: e.pos.col,
        message: e.message,
        hint: null,
        text: `${file}:${e.pos.line}:${e.pos.col}: syntax error: ${e.message}${snippet}`,
      },
    ];
  }
  const message = e instanceof Error ? e.message : String(e);
  return [{ file: entry, line: null, col: null, message, hint: null, text: `${entry}: error: ${message}` }];
}

/** `formatError` と同じ体裁の「該当行 + キャレット」を作る。 */
export function caretSnippet(source: string, line: number, col: number): string {
  const text = source.split("\n")[line - 1] ?? "";
  return `\n  ${text}\n  ${" ".repeat(Math.max(0, col - 1))}^`;
}

/** 表示用のモデル名。未知なら id をそのまま返す。 */
export function modelLabel(id: string | null): string {
  if (!id) return "未指定";
  return MODELS[id]?.label ?? id;
}

/** 入力が `<prelude>` を指しているか（ユーザーのファイルではない）。 */
export function isPrelude(file: string): boolean {
  return file === PRELUDE_LABEL || pathutil.basename(file) === PRELUDE_LABEL;
}

/** 仮想FSのパスから表示名を作る（`/main.np` → `main.np`）。 */
export function displayPath(file: string): string {
  return isPrelude(file) ? PRELUDE_LABEL : pathutil.basename(file) === file ? file : pathutil.resolve("/", file);
}

/** 2 つのパスが同じ仮想ファイルを指すか。 */
export function sameFile(a: string, b: string): boolean {
  if (isPrelude(a) || isPrelude(b)) return isPrelude(a) && isPrelude(b);
  return pathutil.resolve("/", a) === pathutil.resolve("/", b);
}

export type OutputTab = "positive" | "negative" | "notes" | "json";

/** タブごとのコピー／ダウンロード用テキスト。 */
export function tabText(outcome: CompileOutcome, tab: OutputTab): string {
  switch (tab) {
    case "positive":
      return outcome.positive;
    case "negative":
      return outcome.negative;
    case "notes":
      return outcome.notes.map((n) => `- ${n}`).join("\n");
    case "json":
      return JSON.stringify(
        { model: outcome.model, positive: outcome.positive, negative: outcome.negative, notes: outcome.notes },
        null,
        2,
      );
  }
}

/** 診断だけを並べたテキスト（エラー時のダウンロード用）。 */
export function diagnosticsText(diagnostics: Diagnostic[]): string {
  return diagnostics.map((d) => d.text).join("\n\n");
}
