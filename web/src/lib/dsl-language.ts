/**
 * CodeMirror 用の nix-prompt DSL ハイライト。
 *
 * 字句解析器（src/dsl.ts）の規則に合わせた軽量トークナイザです。
 * `#` とブロックコメントがコメント、`//` は属性マージ演算子である点に注意。
 */
import { StreamLanguage, type StringStream } from "@codemirror/language";

const KEYWORDS = new Set(["let", "in", "rec", "with", "assert", "if", "then", "else", "inherit", "import", "or"]);
const ATOMS = new Set(["true", "false", "null"]);
const BUILTINS = new Set([
  "map",
  "filter",
  "foldl'",
  "length",
  "elem",
  "head",
  "tail",
  "all",
  "any",
  "genList",
  "range",
  "sort",
  "unique",
  "concatLists",
  "attrNames",
  "attrValues",
  "hasAttr",
  "getAttr",
  "removeAttrs",
  "mapAttrs",
  "listToAttrs",
  "concatStringsSep",
  "replaceStrings",
  "stringLength",
  "substring",
  "toUpper",
  "toLower",
  "trim",
  "toString",
  "toJSON",
  "throw",
  "typeOf",
  "isString",
  "isInt",
  "isFloat",
  "isBool",
  "isList",
  "isAttrs",
  "isFunction",
  "isNull",
  "character",
  "mkCharacter",
  "weighted",
  "builtins",
]);

type State = { blockComment: boolean };

/** 文字列を閉じ引用符まで消費する（`${...}` は中身も文字列として扱う）。 */
function readString(stream: StringStream): void {
  stream.next();
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === "\\") {
      stream.next();
      continue;
    }
    if (ch === '"') return;
  }
}

export const nixPromptLanguage = StreamLanguage.define<State>({
  name: "nix-prompt",
  startState: () => ({ blockComment: false }),
  token(stream, state) {
    if (state.blockComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.blockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (stream.eatSpace()) return null;

    const ch = stream.peek();
    if (ch === undefined) return null;

    if (ch === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockComment = true;
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.blockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (ch === '"') {
      readString(stream);
      return "string";
    }
    if (/[0-9]/.test(ch)) {
      stream.match(/^[0-9]+(\.[0-9]+)?/);
      return "number";
    }
    if (/[A-Za-z_]/.test(ch)) {
      const word = (stream.match(/^[A-Za-z_][A-Za-z0-9_'-]*/) as string | null) ?? "";
      if (KEYWORDS.has(word)) return "keyword";
      if (ATOMS.has(word)) return "atom";
      if (BUILTINS.has(word)) return "def";
      // `key = ...` の左辺は属性名として色を変える
      if (/^\s*=(?!=)/.test(stream.string.slice(stream.pos))) return "propertyName";
      return "variableName";
    }
    // `./x.np` `../x.np` `/x.np` のようなパス
    if (stream.match(/^\.\.?\/[A-Za-z0-9._/-]*/) || stream.match(/^\/[A-Za-z0-9._-][A-Za-z0-9._/-]*/)) {
      return "string";
    }
    if (stream.match(/^(\/\/|\+\+|&&|\|\||->|==|!=|<=|>=|\.\.\.)/)) return "operator";
    if (stream.match(/^[{}()[\];,:]/)) return "punctuation";
    if (stream.match(/^[=+\-*/<>!?.@]/)) return "operator";

    stream.next();
    return null;
  },
});
