/**
 * Nix風DSLの字句解析と構文解析。
 * 対応: let/in, rec {}, with, assert, if/then/else, ラムダ(識別子・パターン),
 * 関数適用, 属性選択(.a.b or c), e ? a, 文字列補間, import ./path。
 */

export type Pos = { line: number; col: number };
export type StrPart = { s: string } | { e: Node };
export type Param =
  | { kind: "ident"; name: string }
  | { kind: "pattern"; entries: { name: string; def: Node | null }[]; ellipsis: boolean };
export type Entry =
  | { kind: "assign"; name: string; value: Node }
  | { kind: "inherit"; name: string; from: Node | null };
export type Bind = { name: string; value: Node };

export type Node =
  | { t: "lit"; v: string | number | boolean | null; pos: Pos }
  | { t: "str"; parts: StrPart[]; pos: Pos }
  | { t: "ident"; name: string; pos: Pos }
  | { t: "path"; value: string; pos: Pos }
  | { t: "list"; items: Node[]; pos: Pos }
  | { t: "attrs"; rec: boolean; entries: Entry[]; pos: Pos }
  | { t: "lambda"; params: Param[]; body: Node; pos: Pos }
  | { t: "apply"; fn: Node; arg: Node; pos: Pos }
  | { t: "select"; obj: Node; path: string[]; def: Node | null; pos: Pos }
  | { t: "hasattr"; obj: Node; path: string[]; pos: Pos }
  | { t: "binop"; op: string; l: Node; r: Node; pos: Pos }
  | { t: "unop"; op: string; e: Node; pos: Pos }
  | { t: "let"; bindings: Bind[]; body: Node; pos: Pos }
  | { t: "if"; cond: Node; then: Node; else: Node; pos: Pos }
  | { t: "with"; scope: Node; body: Node; pos: Pos }
  | { t: "assert"; cond: Node; body: Node; pos: Pos }
  | { t: "import"; path: string; pos: Pos };

export class SyntaxError_ extends Error {
  constructor(message: string, public pos: Pos, public file: string) {
    super(message);
    this.name = "SyntaxError";
  }
}

type Tok = {
  type: "ident" | "int" | "float" | "str" | "punct" | "path" | "eof";
  value?: string | number;
  parts?: StrPart[];
  pos: Pos;
};

const KEYWORDS = new Set([
  "let", "in", "rec", "with", "assert", "if", "then", "else",
  "true", "false", "null", "inherit", "import", "or",
]);

const PUNCTS = [
  "...", "//", "++", "&&", "||", "->", "==", "!=", "<=", ">=",
  "{", "}", "[", "]", "(", ")", "=", ";", ",", ":", ".", "?", "!", "+", "-", "*", "/", "<", ">", "@",
];

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_'-]/;

export class Lexer {
  private i = 0;
  private line: number;
  private col: number;
  constructor(private src: string, base?: Pos) {
    this.line = base ? base.line : 1;
    this.col = base ? base.col : 1;
  }

  private pos(): Pos {
    return { line: this.line, col: this.col };
  }

  private advance(n = 1): string {
    let out = "";
    for (let k = 0; k < n; k++) {
      const c = this.src[this.i++];
      out += c;
      if (c === "\n") {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
    }
    return out;
  }

  private skipTrivia(): void {
    for (;;) {
      const c = this.src[this.i];
      if (c === undefined) return;
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        this.advance();
        continue;
      }
      if (c === "#") {
        while (this.i < this.src.length && this.src[this.i] !== "\n") this.advance();
        continue;
      }
      if (c === "/" && this.src[this.i + 1] === "*") {
        this.advance(2);
        while (this.i < this.src.length && !(this.src[this.i] === "*" && this.src[this.i + 1] === "/")) this.advance();
        if (this.i >= this.src.length) throw new SyntaxError_("閉じられていないブロックコメント", this.pos(), "");
        this.advance(2);
        continue;
      }
      return;
    }
  }

  tokenize(file: string): Tok[] {
    const toks: Tok[] = [];
    for (;;) {
      this.skipTrivia();
      if (this.i >= this.src.length) {
        toks.push({ type: "eof", pos: this.pos() });
        return toks;
      }
      const start = this.pos();
      const c = this.src[this.i];

      if (c === '"') {
        toks.push(this.readString(file));
        continue;
      }
      if (c === "." && (this.src[this.i + 1] === "/" || (this.src[this.i + 1] === "." && this.src[this.i + 2] === "/"))) {
        let s = "";
        while (this.i < this.src.length && !/[\s,;)\]}]/.test(this.src[this.i])) s += this.advance();
        toks.push({ type: "path", value: s, pos: start });
        continue;
      }
      if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(this.src[this.i + 1] ?? "") && !this.prevIsValue(toks))) {
        let s = "";
        if (c === "-") s += this.advance();
        while (/[0-9]/.test(this.src[this.i] ?? "")) s += this.advance();
        let isFloat = false;
        if (this.src[this.i] === "." && /[0-9]/.test(this.src[this.i + 1] ?? "")) {
          isFloat = true;
          s += this.advance();
          while (/[0-9]/.test(this.src[this.i] ?? "")) s += this.advance();
        }
        toks.push({ type: isFloat ? "float" : "int", value: Number(s), pos: start });
        continue;
      }
      if (IDENT_START.test(c)) {
        let s = "";
        while (this.i < this.src.length && IDENT_CHAR.test(this.src[this.i])) s += this.advance();
        toks.push({ type: "ident", value: s, pos: start });
        continue;
      }
      const p = PUNCTS.find((p) => this.src.startsWith(p, this.i));
      if (p) {
        this.advance(p.length);
        toks.push({ type: "punct", value: p, pos: start });
        continue;
      }
      throw new SyntaxError_(`不正な文字 ${JSON.stringify(c)}`, start, file);
    }
  }

  private prevIsValue(toks: Tok[]): boolean {
    const prev = toks[toks.length - 1];
    if (!prev) return false;
    if (prev.type === "int" || prev.type === "float" || prev.type === "str" || prev.type === "path") return true;
    if (prev.type === "ident") return !KEYWORDS.has(String(prev.value));
    if (prev.type === "punct") return prev.value === ")" || prev.value === "]" || prev.value === "}";
    return false;
  }

  private readString(file: string): Tok {
    const start = this.pos();
    this.advance();
    const parts: StrPart[] = [];
    let buf = "";
    for (;;) {
      if (this.i >= this.src.length) throw new SyntaxError_("閉じられていない文字列", start, file);
      const c = this.src[this.i];
      if (c === '"') {
        this.advance();
        break;
      }
      if (c === "\\") {
        this.advance();
        const e = this.advance();
        buf += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
        continue;
      }
      if (c === "$" && this.src[this.i + 1] === "{") {
        if (buf) parts.push({ s: buf });
        buf = "";
        this.advance(2);
        const innerStart = this.pos();
        const inner = this.readBalanced(file, start);
        parts.push({ e: new Parser(inner, file, innerStart).parseExpression() });
        continue;
      }
      buf += this.advance();
    }
    if (buf) parts.push({ s: buf });
    return { type: "str", parts, pos: start };
  }

    private readBalanced(file: string, strStart: Pos): string {
    let depth = 1;
    let out = "";
    for (;;) {
      if (this.i >= this.src.length) throw new SyntaxError_("閉じられていない ${...}", strStart, file);
      const c = this.src[this.i];
      if (c === '"') {
        out += '"';
        this.advance();
        while (this.i < this.src.length && this.src[this.i] !== '"') {
          if (this.src[this.i] === "\\") {
            out += this.advance();
          }
          if (this.i < this.src.length) out += this.advance();
        }
        if (this.i >= this.src.length) throw new SyntaxError_("閉じられていない文字列", strStart, file);
        out += this.advance();
        continue;
      }
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth === 0) {
          this.advance();
          return out;
        }
      }
      out += this.advance();
    }
  }
}

const PRECEDENCE: Record<string, number> = {
  "->": 1,
  "||": 2,
  "&&": 3,
  "==": 4, "!=": 4,
  "<": 5, ">": 5, "<=": 5, ">=": 5,
  "//": 6,
  "++": 7,
  "+": 8, "-": 8,
  "*": 9, "/": 9,
};
const RIGHT_ASSOC = new Set(["->", "//", "++"]);

export class Parser {
  private toks: Tok[];
  private i = 0;

  constructor(src: string, private file: string, base?: Pos) {
    this.toks = new Lexer(src, base).tokenize(file);
  }

  private peek(k = 0): Tok {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private isPunct(v: string, k = 0): boolean {
    const t = this.peek(k);
    return t.type === "punct" && t.value === v;
  }
  private isKw(v: string, k = 0): boolean {
    const t = this.peek(k);
    return t.type === "ident" && t.value === v;
  }
  private eatPunct(v: string): void {
    if (!this.isPunct(v)) this.fail(`'${v}' が必要`);
    this.next();
  }
  private fail(msg: string): never {
    throw new SyntaxError_(`${msg}（${this.describe(this.peek())} を検出）`, this.peek().pos, this.file);
  }
  private describe(t: Tok): string {
    if (t.type === "eof") return "入力終端";
    if (t.type === "str") return "文字列";
    return JSON.stringify(t.value);
  }

  parseProgram(): Node {
    const e = this.parseExpression();
    if (this.peek().type !== "eof") this.fail("式の後に余分なトークンがあります");
    return e;
  }

  parseExpression(): Node {
    const t = this.peek();
    if (t.type === "ident") {
      const kw = String(t.value);
      if (kw === "let") return this.parseLet();
      if (kw === "if") return this.parseIf();
      if (kw === "with") return this.parseWith();
      if (kw === "assert") return this.parseAssert();
      if (kw === "import") {
        this.next();
        const p = this.peek();
        if (p.type !== "path") this.fail("import の後にパスが必要");
        this.next();
        return { t: "import", path: String(p.value), pos: t.pos };
      }
    }
    if (this.looksLikeLambda()) return this.parseLambda();
    return this.parseBinop(1);
  }

  private looksLikeLambda(): boolean {
    const t = this.peek();
    if (t.type === "ident" && this.isPunct(":", 1) && !KEYWORDS.has(String(t.value))) {
      const after = this.peek(2);
      return after.type !== "eof";
    }
    if (t.type === "punct" && t.value === "{") {
      const end = this.matchBrace(this.i);
      if (end < 0) return false;
      return this.toks[end].type === "punct" && this.toks[end].value === ":";
    }
    return false;
  }

  private matchBrace(start: number): number {
    let depth = 0;
    for (let k = start; k < this.toks.length; k++) {
      const t = this.toks[k];
      if (t.type === "punct" && t.value === "{") depth++;
      else if (t.type === "punct" && t.value === "}") {
        depth--;
        if (depth === 0) return k + 1;
      }
    }
    return -1;
  }

  private parseLambda(): Node {
    const pos = this.peek().pos;
    const params: Param[] = [];
    if (this.peek().type === "ident") {
      params.push({ kind: "ident", name: String(this.next().value) });
    } else {
      this.eatPunct("{");
      const entries: { name: string; def: Node | null }[] = [];
      let ellipsis = false;
      while (!this.isPunct("}")) {
        if (this.isPunct("...")) {
          this.next();
          ellipsis = true;
        } else {
          const name = this.next();
          if (name.type !== "ident") this.fail("仮引数名が必要");
          let def: Node | null = null;
          if (this.isPunct("?")) {
            this.next();
            def = this.parseExpression();
          }
          entries.push({ name: String(name.value), def });
        }
        if (this.isPunct(",")) this.next();
        else break;
      }
      this.eatPunct("}");
      params.push({ kind: "pattern", entries, ellipsis });
    }
    this.eatPunct(":");
    const body = this.parseExpression();
    return { t: "lambda", params, body, pos };
  }

  private parseLet(): Node {
    const pos = this.next().pos;
    const bindings: Bind[] = [];
    while (!this.isKw("in")) {
      const name = this.next();
      if (name.type !== "ident") this.fail("束縛名が必要");
      this.eatPunct("=");
      bindings.push({ name: String(name.value), value: this.parseExpression() });
      if (this.isPunct(";")) this.next();
      else break;
    }
    if (!this.isKw("in")) this.fail("let には in が必要");
    this.next();
    const body = this.parseExpression();
    return { t: "let", bindings, body, pos };
  }

  private parseIf(): Node {
    const pos = this.next().pos;
    const cond = this.parseExpression();
    if (!this.isKw("then")) this.fail("if には then が必要");
    this.next();
    const then = this.parseExpression();
    if (!this.isKw("else")) this.fail("if には else が必要");
    this.next();
    const els = this.parseExpression();
    return { t: "if", cond, then, else: els, pos };
  }

  private parseWith(): Node {
    const pos = this.next().pos;
    const scope = this.parseExpression();
    this.eatPunct(";");
    const body = this.parseExpression();
    return { t: "with", scope, body, pos };
  }

  private parseAssert(): Node {
    const pos = this.next().pos;
    const cond = this.parseExpression();
    this.eatPunct(";");
    const body = this.parseExpression();
    return { t: "assert", cond, body, pos };
  }

  private parseBinop(minPrec: number): Node {
    let left = this.parseUnary();
    for (;;) {
      if (this.isPunct("?")) {
        const pos = this.next().pos;
        const path = this.parseAttrPath();
        left = { t: "hasattr", obj: left, path, pos };
        continue;
      }
      const t = this.peek();
      if (t.type !== "punct") break;
      const op = String(t.value);
      const prec = PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const nextMin = RIGHT_ASSOC.has(op) ? prec : prec + 1;
      const right = this.parseBinop(nextMin);
      left = { t: "binop", op, l: left, r: right, pos: t.pos };
    }
    return left;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.type === "punct" && (t.value === "!" || t.value === "-")) {
      this.next();
      return { t: "unop", op: String(t.value), e: this.parseUnary(), pos: t.pos };
    }
    return this.parseApplication();
  }

  private startsAtom(t: Tok): boolean {
    if (t.type === "int" || t.type === "float" || t.type === "str" || t.type === "path") return true;
    if (t.type === "ident") return !KEYWORDS.has(String(t.value));
    if (t.type === "punct") return t.value === "(" || t.value === "[" || t.value === "{";
    return false;
  }

  private parseApplication(): Node {
    let fn = this.parsePostfix();
    while (this.startsAtom(this.peek())) {
      const pos = this.peek().pos;
      const arg = this.parsePostfix();
      fn = { t: "apply", fn, arg, pos };
    }
    return fn;
  }

  private parsePostfix(): Node {
    let e = this.parseAtom();
    for (;;) {
      if (this.isPunct(".")) {
        const pos = this.next().pos;
        const name = this.next();
        if (name.type !== "ident" && name.type !== "str") this.fail("属性名が必要");
        const path = [name.type === "str" ? plainStr(name) : String(name.value)];
        while (this.isPunct(".")) {
          this.next();
          const n2 = this.next();
          if (n2.type !== "ident" && n2.type !== "str") this.fail("属性名が必要");
          path.push(n2.type === "str" ? plainStr(n2) : String(n2.value));
        }
        let def: Node | null = null;
        if (this.isKw("or")) {
          this.next();
          def = this.parseExpression();
        }
        e = { t: "select", obj: e, path, def, pos };
        continue;
      }
      break;
    }
    return e;
  }

  private parseAttrPath(): string[] {
    const path: string[] = [];
    for (;;) {
      const t = this.next();
      if (t.type !== "ident" && t.type !== "str") this.fail("属性名が必要");
      path.push(t.type === "str" ? plainStr(t) : String(t.value));
      if (this.isPunct(".")) {
        this.next();
        continue;
      }
      break;
    }
    return path;
  }

  private parseAtom(): Node {
    const t = this.next();
    const pos = t.pos;
    if (t.type === "int" || t.type === "float") return { t: "lit", v: t.value as number, pos };
    if (t.type === "path") return { t: "path", value: String(t.value), pos };
    if (t.type === "str") return { t: "str", parts: t.parts!, pos };
    if (t.type === "ident") {
      const kw = String(t.value);
      if (kw === "true") return { t: "lit", v: true, pos };
      if (kw === "false") return { t: "lit", v: false, pos };
      if (kw === "null") return { t: "lit", v: null, pos };
      if (kw === "rec" && this.isPunct("{")) return this.parseAttrs(pos, true);
      return { t: "ident", name: kw, pos };
    }
    if (t.type === "punct") {
      if (t.value === "(") {
        const e = this.parseExpression();
        this.eatPunct(")");
        return e;
      }
      if (t.value === "[") return this.parseList(pos);
      if (t.value === "{") {
        this.i--;
        return this.parseAttrs(pos, false);
      }
    }
    throw new SyntaxError_(`式を解析できません（${this.describe(t)} を検出）`, pos, this.file);
  }

  private parseList(pos: Pos): Node {
    const items: Node[] = [];
    while (!this.isPunct("]")) {
      if (this.peek().type === "eof") this.fail("閉じられていないリスト");
      items.push(this.parsePostfix());
    }
    this.eatPunct("]");
    return { t: "list", items, pos };
  }

  private parseAttrs(pos: Pos, rec: boolean): Node {
    this.eatPunct("{");
    const entries: Entry[] = [];
    while (!this.isPunct("}")) {
      if (this.peek().type === "eof") this.fail("閉じられていない属性集合");
      if (this.isKw("inherit")) {
        this.next();
        let from: Node | null = null;
        if (this.isPunct("(")) {
          this.next();
          from = this.parseExpression();
          this.eatPunct(")");
        }
        while (!this.isPunct(";")) {
          const n = this.next();
          if (n.type !== "ident") this.fail("inherit する名前が必要");
          entries.push({ kind: "inherit", name: String(n.value), from });
        }
        this.eatPunct(";");
        continue;
      }
      const nameTok = this.next();
      let name: string;
      if (nameTok.type === "ident") name = String(nameTok.value);
      else if (nameTok.type === "str") name = plainStr(nameTok);
      else this.fail("属性名が必要");
      this.eatPunct("=");
      const value = this.parseExpression();
      this.eatPunct(";");
      entries.push({ kind: "assign", name, value });
    }
    this.eatPunct("}");
    return { t: "attrs", rec, entries, pos };
  }
}

function plainStr(t: Tok): string {
  const parts = t.parts ?? [];
  if (parts.some((p) => "e" in p)) throw new SyntaxError_("属性名に補間は使えません", t.pos, "");
  return parts.map((p) => ("s" in p ? p.s : "")).join("");
}
