/** パスからファイル内容を読み出す関数。失敗したら例外を投げてよい。 */
export type SourceReader = (path: string) => string;

/**
 * 既定のソース読み込み手段。
 *
 * コアは実行環境を知らないので、Node 側（CLI・テスト）は `node-io.ts` を
 * import してここに `node:fs` を登録し、ブラウザ側は `compile()` に
 * メモリ上のソースを渡す（または `setDefaultSourceReader` で仮想FSを登録する）。
 */
let defaultReader: SourceReader | null = null;
let defaultCwd = "/";

export function setDefaultSourceReader(reader: SourceReader | null): void {
  defaultReader = reader;
}

export function getDefaultSourceReader(): SourceReader | null {
  return defaultReader;
}

/** 相対パスを解決する基準ディレクトリ。ブラウザでは `/`。 */
export function setDefaultCwd(cwd: string): void {
  defaultCwd = cwd;
}

export function getDefaultCwd(): string {
  return defaultCwd;
}
