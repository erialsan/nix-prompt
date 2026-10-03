import { Lexer, Parser, SyntaxError_, type Node, type Pos } from "./dsl";
import { Builtin, Closure, Env, Thunk, deepEqual, force, isAttrs, isCallable, typeOf, show, type AttrSet, type Value } from "./values";

export class CompileError extends Error {
  constructor(
    message: string,
    public file: string,
    public pos: Pos | null,
    public hint?: string,
  ) {
    super(message);
    this.name = "CompileError";
  }
}

export class Context {
  pos = new WeakMap<object, { file: string; pos: Pos }>();
  sources = new Map<string, string>();
  file: string;

  constructor(public entryFile: string) {
    this.file = entryFile;
  }
}

export function formatError(err: CompileError, ctx: Context): string {
  const head = err.pos
    ? `${err.file}:${err.pos.line}:${err.pos.col}: error: ${err.message}`
    : `${err.file}: error: ${err.message}`;
  const src = ctx.sources.get(err.file);
  let snippet = "";
  if (src && err.pos) {
    const line = src.split("\n")[err.pos.line - 1] ?? "";
    const caret = " ".repeat(Math.max(0, err.pos.col - 1)) + "^";
    snippet = `\n  ${line}\n  ${caret}`;
  }
  return head + snippet + (err.hint ? `\n  hint: ${err.hint}` : "");
}

function fail(node: Node, ctx: Context, message: string, hint?: string): never {
  throw new CompileError(message, ctx.file, posOfNode(node), hint);
}

function posOfNode(node: Node): Pos | null {
  return node.pos ?? null;
}

export function evaluateFile(path: string, ctx: Context, env?: Env): Value {
  const file = path;
  const prevFile = ctx.file;
  const src = readSource(file, ctx);
  ctx.file = file;
  try {
    const ast = new Parser(src, file).parseProgram();
    const e = env ?? rootScope(ctx);
    return evalNode(ast, e, ctx);
  } finally {
    ctx.file = prevFile;
  }
}

function readSource(path: string, ctx: Context): string {
  if (ctx.sources.has(path)) return ctx.sources.get(path)!;
  let text: string;
  try {
    text = require("node:fs").readFileSync(path, "utf8");
  } catch (e) {
    throw new CompileError(`ファイルを読み込めません: ${path}`, ctx.file, null);
  }
  ctx.sources.set(path, text);
  return text;
}

function rootScope(ctx: Context): Env {
  const env = new Env(null);
  env.vars.set("__ctx", ctx as unknown as Value);
  return env;
}

export function evalNode(node: Node, env: Env, ctx: Context): Value {
  switch (node.t) {
    case "lit":
      return node.v;
    case "str": {
      let out = "";
      for (const p of node.parts) {
        if ("s" in p) out += p.s;
        else out += toStr(evalNode(p.e, env, ctx), p.e, ctx);
      }
      return out;
    }
    case "path":
      return node.value;
    case "ident": {
      const v = env.lookup(node.name);
      if (v === undefined) fail(node, ctx, `未定義の名前 '${node.name}'`);
      return v;
    }
    case "list": {
      const arr = node.items.map((it) => evalNode(it, env, ctx));
      ctx.pos.set(arr, { file: ctx.file, pos: node.pos });
      return arr;
    }
    case "attrs": {
      const obj: AttrSet = {};
      ctx.pos.set(obj, { file: ctx.file, pos: node.pos });
      const frame = env.child();
      const scope = node.rec ? frame : env;
      for (const entry of node.entries) {
        if (entry.kind === "inherit") {
          const from = entry.from ? evalNode(entry.from, env, ctx) : null;
          const value = from === null ? env.lookup(entry.name) : isAttrs(from) ? force(from[entry.name]) : undefined;
          if (value === undefined) {
            throw new CompileError(`inherit する名前 '${entry.name}' がスコープに存在しません`, ctx.file, node.pos);
          }
          frame.vars.set(entry.name, value);
        } else {
          frame.vars.set(entry.name, new Thunk(() => evalNode(entry.value, scope, ctx)));
        }
      }
      for (const entry of node.entries) obj[entry.name] = force(frame.vars.get(entry.name)!);
      return obj;
    }
    case "lambda":
      return new Closure(node.params, node.body, env, ctx.file);
    case "apply": {
      const fn = evalNode(node.fn, env, ctx);
      const arg = evalNode(node.arg, env, ctx);
      return callFunction(fn, arg, node, ctx);
    }
    case "select": {
      const obj = evalNode(node.obj, env, ctx);
      let cur: Value = force(obj);
      for (const key of node.path) {
        if (isAttrs(cur) && Object.prototype.hasOwnProperty.call(cur, key)) {
          cur = force(cur[key]);
        } else if (node.def) {
          return evalNode(node.def, env, ctx);
        } else {
          fail(node, ctx, `属性 '${node.path.join(".")}' が存在しません（${typeOf(cur)} の値に '${key}' を要求）`);
        }
      }
      return cur;
    }
    case "hasattr": {
      const obj = force(evalNode(node.obj, env, ctx));
      let cur: Value = obj;
      for (const key of node.path) {
        if (isAttrs(cur) && Object.prototype.hasOwnProperty.call(cur, key)) cur = force(cur[key]);
        else return false;
      }
      return true;
    }
    case "unop": {
      const v = evalNode(node.e, env, ctx);
      if (node.op === "!") return !truthy(v, node, ctx);
      if (typeof v !== "number") fail(node, ctx, `単項 '-' は数値にのみ適用できます（${typeOf(v)}）`);
      return -v;
    }
    case "binop":
      return evalBinop(node, env, ctx);
    case "if":
      return truthy(evalNode(node.cond, env, ctx), node.cond, ctx)
        ? evalNode(node.then, env, ctx)
        : evalNode(node.else, env, ctx);
    case "let": {
      const frame = env.child();
      for (const b of node.bindings) {
        frame.vars.set(b.name, new Thunk(() => evalNode(b.value, frame, ctx)));
      }
      return evalNode(node.body, frame, ctx);
    }
    case "with": {
      const scope = evalNode(node.scope, env, ctx);
      if (!isAttrs(scope)) fail(node, ctx, `with には属性集合が必要です（${typeOf(scope)}）`);
      return evalNode(node.body, env.child(scope), ctx);
    }
    case "assert": {
      const cond = evalNode(node.cond, env, ctx);
      if (!truthy(cond, node.cond, ctx)) {
        fail(node, ctx, "assert が失敗しました");
      }
      return evalNode(node.body, env, ctx);
    }
    case "import": {
      const resolved = resolvePath(ctx.file, node.path);
      const prev = ctx.file;
      ctx.file = resolved;
      try {
        const src = readSource(resolved, ctx);
        const ast = new Parser(src, resolved).parseProgram();
        return evalNode(ast, env, ctx);
      } finally {
        ctx.file = prev;
      }
    }
  }
}

function resolvePath(fromFile: string, p: string): string {
  const path = require("node:path");
  return path.resolve(path.dirname(fromFile), p);
}

function evalBinop(node: Node & { t: "binop" }, env: Env, ctx: Context): Value {
  const op = node.op;
  const l = evalNode(node.l, env, ctx);
  if (op === "&&") return truthy(l, node.l, ctx) ? truthy(evalNode(node.r, env, ctx), node.r, ctx) : false;
  if (op === "||") return truthy(l, node.l, ctx) ? true : truthy(evalNode(node.r, env, ctx), node.r, ctx);
  if (op === "->") return !truthy(l, node.l, ctx) || truthy(evalNode(node.r, env, ctx), node.r, ctx);
  const r = evalNode(node.r, env, ctx);
  switch (op) {
    case "+":
      if (typeof l === "string" && typeof r === "string") return l + r;
      if (typeof l === "number" && typeof r === "number") return l + r;
      fail(node, ctx, `'+' は数値同士または文字列同士にのみ適用できます（${typeOf(l)} と ${typeOf(r)}）`);
      break;
    case "-":
    case "*":
    case "/": {
      if (typeof l !== "number" || typeof r !== "number") {
        fail(node, ctx, `'${op}' は数値にのみ適用できます（${typeOf(l)} と ${typeOf(r)}）`);
      }
      if (op === "-") return l - r;
      if (op === "*") return l * r;
      if (r === 0) fail(node, ctx, "0 で除算しました");
      return l / r;
    }
    case "++":
      if (!Array.isArray(l) || !Array.isArray(r)) fail(node, ctx, `'++' はリスト同士にのみ適用できます`);
      return [...l, ...r];
    case "//": {
      if (!isAttrs(l) || !isAttrs(r)) fail(node, ctx, `'//' は属性集合同士にのみ適用できます`);
      return { ...l, ...r };
    }
    case "==":
      return deepEqual(l, r);
    case "!=":
      return !deepEqual(l, r);
    case "<":
    case ">":
    case "<=":
    case ">=": {
      const cmp = compare(l, r);
      if (cmp === null) fail(node, ctx, `'${op}' は数値または文字列にのみ適用できます`);
      if (op === "<") return cmp < 0;
      if (op === ">") return cmp > 0;
      if (op === "<=") return cmp <= 0;
      return cmp >= 0;
    }
  }
  fail(node, ctx, `未知の演算子 '${op}'`);
}

function compare(l: Value, r: Value): number | null {
  if (typeof l === "number" && typeof r === "number") return l - r;
  if (typeof l === "string" && typeof r === "string") return l < r ? -1 : l > r ? 1 : 0;
  return null;
}

function truthy(v: Value, node: Node, ctx: Context): boolean {
  if (typeof v === "boolean") return v;
  fail(node, ctx, `条件式には bool が必要です（${typeOf(v)}）`);
}

function toStr(v: Value, node: Node, ctx: Context): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null) return "";
  if (Array.isArray(v)) return v.map((x) => toStr(x, node, ctx)).join(" ");
  fail(node, ctx, `文字列に変換できません（${typeOf(v)}）`);
}

export function callFunction(fn: Value, arg: Value, node: Node, ctx: Context): Value {
  if (fn instanceof Builtin) {
    if (fn.name === "__posOf") {
      const at = isAttrs(force(arg)) ? ctx.pos.get(force(arg) as object) : undefined;
      return at ? { file: at.file, line: at.pos.line, col: at.pos.col } : null;
    }
    return fn.apply(force(arg));
  }
  if (!(fn instanceof Closure)) fail(node, ctx, `${typeOf(fn)} は関数ではありません`);
  const param = fn.params[0] as { kind: string; name?: string; entries?: { name: string; def: Node | null }[]; ellipsis?: boolean };
  const scope = fn.env.child();
  if (param.kind === "ident") {
    scope.vars.set(param.name!, arg);
  } else {
    if (!isAttrs(arg)) fail(node, ctx, `関数の引数に属性集合が必要です（${typeOf(arg)}）`);
    scope.vars.set("__args", arg);
    const known = new Set(param.entries!.map((e) => e.name));
    for (const e of param.entries!) {
      if (Object.prototype.hasOwnProperty.call(arg, e.name)) {
        scope.vars.set(e.name, arg[e.name]);
      } else if (e.def) {
        scope.vars.set(e.name, evalNode(e.def, scope, ctx));
      } else {
        const where = ctx.pos.get(arg);
        throw new CompileError(
          `必須引数 '${e.name}' がありません`,
          where?.file ?? ctx.file,
          where?.pos ?? node.pos,
          `この関数には { ${param.entries!.map((x) => x.name).join(", ")} } が必要です`,
        );
      }
    }
    if (!param.ellipsis) {
      for (const k of Object.keys(arg)) {
        if (!known.has(k) && !k.startsWith("__")) {
          const where = ctx.pos.get(arg);
          throw new CompileError(
            `未知の引数 '${k}' が渡されました`,
            where?.file ?? ctx.file,
            where?.pos ?? node.pos,
            `受け付ける引数: ${[...known].join(", ")}`,
          );
        }
      }
    }
  }
  const prev = ctx.file;
  ctx.file = fn.file;
  try {
    return evalNode(fn.body as Node, scope, ctx);
  } finally {
    ctx.file = prev;
  }
}

export function makeBuiltins(): AttrSet {
  const b: Record<string, Builtin> = {};
  const def = (name: string, arity: number, fn: (args: Value[]) => Value) => {
    b[name] = new Builtin(name, arity, fn);
  };
  const list = (v: Value, name: string): Value[] => {
    if (!Array.isArray(v)) throw new TypeError(`builtins.${name}: リストが必要です（${typeOf(v)}）`);
    return v;
  };
  const str = (v: Value, name: string): string => {
    if (typeof v !== "string") throw new TypeError(`builtins.${name}: 文字列が必要です（${typeOf(v)}）`);
    return v;
  };
  const num = (v: Value, name: string): number => {
    if (typeof v !== "number") throw new TypeError(`builtins.${name}: 数値が必要です（${typeOf(v)}）`);
    return v;
  };
  const set = (v: Value, name: string): AttrSet => {
    if (!isAttrs(v)) throw new TypeError(`builtins.${name}: 属性集合が必要です（${typeOf(v)}）`);
    return v;
  };
  const call = (f: Value, x: Value, name: string): Value => {
    if (f instanceof Builtin) return f.apply(x);
    if (!(f instanceof Closure)) throw new TypeError(`builtins.${name}: 関数が必要です（${typeOf(f)}）`);
    const ctx = (f.env.lookup("__ctx") as unknown) as Context;
    return callFunction(f, x, { t: "lit", v: null, pos: { line: 0, col: 0 } }, ctx);
  };

  def("toString", 1, ([v]) => valueToString(v));
  def("typeOf", 1, ([v]) => typeOf(v));
  def("isString", 1, ([v]) => typeof v === "string");
  def("isInt", 1, ([v]) => typeof v === "number" && Number.isInteger(v));
  def("isFloat", 1, ([v]) => typeof v === "number" && !Number.isInteger(v));
  def("isBool", 1, ([v]) => typeof v === "boolean");
  def("isList", 1, ([v]) => Array.isArray(v));
  def("isAttrs", 1, ([v]) => isAttrs(v));
  def("isFunction", 1, ([v]) => isCallable(v));
  def("isNull", 1, ([v]) => v === null);
  def("throw", 1, ([v]) => {
    throw new Error(valueToString(v));
  });
  def("length", 1, ([v]) => (Array.isArray(v) ? v.length : Object.keys(set(v, "length")).length));
  def("head", 1, ([v]) => {
    const l = list(v, "head");
    if (l.length === 0) throw new Error("builtins.head: 空リスト");
    return l[0];
  });
  def("tail", 1, ([v]) => list(v, "tail").slice(1));
  def("elem", 2, ([x, v]) => list(v, "elem").some((y) => deepEqual(x, y)));
  def("map", 2, ([f, v]) => list(v, "map").map((x) => call(f, x, "map")));
  def("filter", 2, ([f, v]) => list(v, "filter").filter((x) => call(f, x, "filter") === true));
  def("foldl'", 3, ([f, init, v]) => list(v, "foldl'").reduce((acc, x) => call(call(f, acc, "foldl'"), x, "foldl'"), init));
  def("all", 2, ([f, v]) => list(v, "all").every((x) => call(f, x, "all") === true));
  def("any", 2, ([f, v]) => list(v, "any").some((x) => call(f, x, "any") === true));
  def("genList", 2, ([f, n]) => Array.from({ length: num(n, "genList") }, (_, i) => call(f, i, "genList")));
  def("range", 2, ([a, z]) => {
    const from = num(a, "range");
    const to = num(z, "range");
    const out: number[] = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
  });
  def("sort", 2, ([f, v]) => {
    const l = [...list(v, "sort")];
    l.sort((x, y) => (call(call(f, x, "sort"), y, "sort") === true ? -1 : 1));
    return l;
  });
  def("unique", 1, ([v]) => {
    const out: Value[] = [];
    for (const x of list(v, "unique")) if (!out.some((y) => deepEqual(x, y))) out.push(x);
    return out;
  });
  def("concatLists", 1, ([v]) => list(v, "concatLists").flatMap((x) => list(x, "concatLists")));
  def("attrNames", 1, ([v]) => Object.keys(set(v, "attrNames")).filter((k) => !k.startsWith("__")).sort());
  def("attrValues", 1, ([v]) => {
    const s = set(v, "attrValues");
    return Object.keys(s).filter((k) => !k.startsWith("__")).sort().map((k) => s[k]);
  });
  def("hasAttr", 2, ([n, v]) => Object.prototype.hasOwnProperty.call(set(v, "hasAttr"), str(n, "hasAttr")));
  def("getAttr", 2, ([n, v]) => {
    const s = set(v, "getAttr");
    const key = str(n, "getAttr");
    if (!Object.prototype.hasOwnProperty.call(s, key)) throw new Error(`builtins.getAttr: 属性 '${key}' がありません`);
    return s[key];
  });
  def("removeAttrs", 2, ([v, names]) => {
    const out = { ...set(v, "removeAttrs") };
    for (const n of list(names, "removeAttrs")) delete out[str(n, "removeAttrs")];
    return out;
  });
  def("mapAttrs", 2, ([f, v]) => {
    const s = set(v, "mapAttrs");
    const out: AttrSet = {};
    for (const [k, val] of Object.entries(s)) {
      if (k.startsWith("__")) continue;
      out[k] = call(call(f, k, "mapAttrs"), val, "mapAttrs");
    }
    return out;
  });
  def("listToAttrs", 1, ([v]) => {
    const out: AttrSet = {};
    for (const item of list(v, "listToAttrs")) {
      const s = set(item, "listToAttrs");
      out[str(s.name, "listToAttrs")] = s.value;
    }
    return out;
  });
  def("concatStringsSep", 2, ([sep, v]) => list(v, "concatStringsSep").map((x) => valueToString(x)).join(str(sep, "concatStringsSep")));
  def("replaceStrings", 3, ([from, to, s]) => {
    const fs = list(from, "replaceStrings").map((x) => str(x, "replaceStrings"));
    const ts = list(to, "replaceStrings").map((x) => str(x, "replaceStrings"));
    let out = str(s, "replaceStrings");
    fs.forEach((f, i) => {
      out = out.split(f).join(ts[i] ?? "");
    });
    return out;
  });
  def("stringLength", 1, ([v]) => str(v, "stringLength").length);
  def("substring", 3, ([start, len, s]) => str(s, "substring").substr(num(start, "substring"), num(len, "substring")));
  def("toUpper", 1, ([v]) => str(v, "toUpper").toUpperCase());
  def("toLower", 1, ([v]) => str(v, "toLower").toLowerCase());
  def("trim", 1, ([v]) => str(v, "trim").trim());
  def("toJSON", 1, ([v]) => JSON.stringify(toPlain(v), null, 2));
  def("__posOf", 1, () => null);

  const builtinsSet: AttrSet = {};
  for (const [k, v] of Object.entries(b)) builtinsSet[k] = v;
  b["__builtinsSet"] = new Builtin("__builtinsSet", 1, () => builtinsSet);
  return { ...builtinsSet, builtins: builtinsSet };
}

export function valueToString(v: Value): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "";
  if (v === null) return "";
  if (Array.isArray(v)) return v.map(valueToString).join(" ");
  return show(v);
}

export function toPlain(v: Value): unknown {
  if (Array.isArray(v)) return v.map(toPlain);
  if (isAttrs(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k.startsWith("__")) continue;
      out[k] = toPlain(val);
    }
    return out;
  }
  if (isCallable(v)) return "<lambda>";
  return v;
}

export { Lexer, Parser, SyntaxError_ };
export type { Node, Pos };
