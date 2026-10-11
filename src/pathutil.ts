/**
 * ブラウザでも動く純粋なパス操作。
 *
 * `node:path` の posix 実装と同じ結果になる範囲だけを実装しています。
 * コア（dsl / eval / compile）をブラウザへバンドルするために、
 * Node 依存を持ち込まないためのモジュールです。
 *
 * 末尾スラッシュは正規化で落とします（ファイルパスしか扱わないため）。
 */

/** 連続スラッシュ・`.`・`..` を解決する。先頭の `/` は保持する。 */
export function normalize(input: string): string {
  const absolute = input.startsWith("/");
  const out: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  const joined = out.join("/");
  if (absolute) return `/${joined}`;
  return joined === "" ? "." : joined;
}

/** `/a` と `b/c` を連結する。 */
export function join(...parts: string[]): string {
  const filtered = parts.filter((p) => p !== "");
  if (filtered.length === 0) return ".";
  return normalize(filtered.join("/"));
}

/**
 * `path.resolve` 相当。`parts` を後ろから積み上げ、
 * 絶対パスが現れたらそこで打ち切る。先頭が絶対でなければ `cwd` を前置する。
 */
export function resolve(...parts: string[]): string {
  const filtered = parts.filter((p) => p !== "");
  if (filtered.length === 0) return "/";
  let resolved = "";
  for (let i = filtered.length - 1; i >= 0; i--) {
    const part = filtered[i];
    resolved = resolved === "" ? part : `${part.replace(/\/+$/, "")}/${resolved}`;
    if (part.startsWith("/")) break;
  }
  if (!resolved.startsWith("/")) resolved = `/${resolved}`;
  return normalize(resolved);
}

/** 親ディレクトリ。`/a/b` → `/a`、`/a` → `/`、`a` → `.` */
export function dirname(input: string): string {
  const absolute = input.startsWith("/");
  const normalized = normalize(input);
  const idx = normalized.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return normalized.slice(0, idx);
}

/** 最後のセグメント。 */
export function basename(input: string): string {
  const normalized = normalize(input);
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** 絶対パスかどうか。 */
export function isAbsolute(input: string): boolean {
  return input.startsWith("/");
}
