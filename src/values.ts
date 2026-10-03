export class Closure {
  constructor(
    public params: unknown[],
    public body: unknown,
    public env: Env,
    public file: string,
  ) {}
}

export class Builtin {
  readonly acc: Value[];
  constructor(
    public name: string,
    public arity: number,
    public fn: (args: Value[]) => Value,
    acc: Value[] = [],
  ) {
    this.acc = acc;
  }
  apply(arg: Value): Value {
    const acc = [...this.acc, arg];
    if (acc.length >= this.arity) return this.fn(acc);
    return new Builtin(this.name, this.arity, this.fn, acc);
  }
}

export class Thunk {
  private done = false;
  private running = false;
  private value: Value = null;
  constructor(private fn: () => Value) {}
  get(): Value {
    if (this.done) return this.value;
    if (this.running) throw new Error("無限再帰を検出しました");
    this.running = true;
    try {
      this.value = this.fn();
      this.done = true;
      return this.value;
    } finally {
      this.running = false;
    }
  }
}

export interface AttrSet {
  [key: string]: Value;
}

export type Value = string | number | boolean | null | Value[] | AttrSet | Closure | Builtin | Thunk;

export class Env {
  vars = new Map<string, Value>();
  constructor(
    public parent: Env | null = null,
    public withScope: AttrSet | null = null,
  ) {}

  child(withScope: AttrSet | null = null): Env {
    return new Env(this, withScope);
  }

  lookup(name: string): Value | undefined {
    for (let e: Env | null = this; e !== null; e = e.parent) {
      if (e.vars.has(name)) return force(e.vars.get(name)!);
      if (e.withScope && Object.prototype.hasOwnProperty.call(e.withScope, name)) {
        return force(e.withScope[name]);
      }
    }
    return undefined;
  }
}

export function force(v: Value): Value {
  return v instanceof Thunk ? v.get() : v;
}

export function isAttrs(v: Value): v is AttrSet {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Closure) &&
    !(v instanceof Builtin) &&
    !(v instanceof Thunk)
  );
}

export function isCallable(v: Value): v is Closure | Builtin {
  return v instanceof Closure || v instanceof Builtin;
}

export function typeOf(v: Value): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  if (isAttrs(v)) return "set";
  if (isCallable(v)) return "lambda";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "bool";
  return "unknown";
}

export function show(v: Value): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return "[ " + v.map(show).join(" ") + " ]";
  if (isCallable(v)) return "<lambda>";
  const entries = Object.entries(v)
    .filter(([k]) => !k.startsWith("__"))
    .map(([k, val]) => `${k} = ${show(val)};`);
  return "{ " + entries.join(" ") + " }";
}

export function deepEqual(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isAttrs(a) && isAttrs(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}
