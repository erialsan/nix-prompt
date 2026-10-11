/**
 * Node / Bun 実行時のみ使う I/O 実装。
 *
 * このモジュールを import した時点で既定の読み込み手段として
 * `node:fs` と `process.cwd()` が登録されます。
 * ブラウザのバンドルには含めないでください（CLI とテストだけが import します）。
 */
import fs from "node:fs";
import process from "node:process";
import { setDefaultCwd, setDefaultSourceReader, type SourceReader } from "./io";

export const nodeReader: SourceReader = (path: string) => fs.readFileSync(path, "utf8");

setDefaultSourceReader(nodeReader);
setDefaultCwd(process.cwd());
