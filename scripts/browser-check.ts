/**
 * 実ブラウザで Web UI を操作し、**コンパイラの出力を CLI と突き合わせる**試験。
 *
 *   bun run scripts/browser-check.ts --url http://127.0.0.1:4173/
 *   bun run scripts/browser-check.ts --url https://erialsan.github.io/nix-prompt/ --shot /tmp/pages.png
 *
 * 追加依存はありません（Chromium の CDP を WebSocket で直接叩きます）。
 * 共有URL（#s=...）で任意のソースを読み込ませるので、打鍵の再現に依存せず
 * 「配信中のバンドルが正しくコンパイルするか」を検証できます。
 *
 * ブラウザのパスは --chromium か環境変数 CHROMIUM で指定します。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { templateFor } from "../src/templates";
import { ERROR_EXAMPLES, EXAMPLES, type ExampleEntry } from "../web/src/lib/examples.generated";
import { compileFiles } from "../web/src/lib/engine";
import { encodeShare } from "../web/src/lib/persist";

// ── 引数 ────────────────────────────────────────────────────────────
function arg(name: string, fallback = ""): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "") : fallback;
}

const baseUrl = arg("url", "http://127.0.0.1:4173/");
const chromiumBin = arg("chromium", process.env.CHROMIUM ?? "chromium");
const shotPath = arg("shot", "");
const port = Number(arg("port", String(9300 + Math.floor(Math.random() * 500))));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 結果 ────────────────────────────────────────────────────────────
const results: { ok: boolean; label: string; detail?: string }[] = [];
function check(label: string, ok: boolean, detail?: string) {
  results.push({ ok, label, detail });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// ── CDP クライアント ────────────────────────────────────────────────
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

class Cdp {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private consoleErrors: string[] = [];

  private constructor(private ws: WebSocket) {}

  static async connect(wsUrl: string): Promise<Cdp> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("DevTools へ接続できませんでした")), { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: { type?: string; args?: { value?: unknown; description?: string }[]; exceptionDetails?: { text?: string } };
        error?: { message: string };
        result?: unknown;
      };
      if (typeof message.id === "number") {
        const pending = cdp.pending.get(message.id);
        if (!pending) return;
        cdp.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        cdp.consoleErrors.push(message.params.args?.map((a) => String(a.value ?? a.description ?? "")).join(" ") ?? "");
      }
      if (message.method === "Runtime.exceptionThrown") {
        cdp.consoleErrors.push(`未捕捉例外: ${message.params?.exceptionDetails?.text ?? ""}`);
      }
    });
    return cdp;
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(`evaluate 失敗: ${result.exceptionDetails.text}`);
    return result.result?.value as T;
  }

  async waitFor(expression: string, label: string, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown = null;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) return;
      } catch (e) {
        last = e instanceof Error ? e.message : e;
      }
      await sleep(150);
    }
    throw new Error(`タイムアウト: ${label}（最後の値: ${JSON.stringify(last)}）`);
  }

  errors(): string[] {
    return this.consoleErrors;
  }

  close() {
    this.ws.close();
  }
}

async function waitForPageTarget(portNumber: number): Promise<string> {
  for (let i = 0; i < 150; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${portNumber}/json/list`)).json()) as {
        type: string;
        webSocketDebuggerUrl?: string;
      }[];
      const page = list.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl!;
    } catch {
      // まだ起動していない
    }
    await sleep(200);
  }
  throw new Error("DevTools のページターゲットを取得できませんでした");
}

function launchChromium(bin: string, portNumber: number, userDataDir: string): ChildProcess {
  return spawn(
    bin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--window-size=1440,900",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${portNumber}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

// ── 期待値（CLI と同じコンパイラでローカル計算） ─────────────────────
const renamed = (example: ExampleEntry) => `/${example.name.split("/").pop()}`;
const example = (name: string) => {
  const found = [...EXAMPLES, ...ERROR_EXAMPLES].find((entry) => entry.name === name);
  if (!found) throw new Error(`サンプルが見つかりません: ${name}`);
  return found;
};

const defaultSource = templateFor("anima");
const expectDefault = compileFiles([{ path: "/main.np", source: defaultSource }]);
const solo = example("solo.np");
const expectSoloIllustrious = compileFiles([{ path: renamed(solo), source: solo.source }], { model: "illustrious" });
const broken = example("errors/underscore.np");
const expectBroken = compileFiles([{ path: renamed(broken), source: broken.source }]);

const nonce = Date.now().toString(36);
const cacheBust = (label: string) => `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${label}-${nonce}`;

// ── 実行 ────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "np-chrome-"));
const proc = launchChromium(chromiumBin, port, userDataDir);

try {
  const wsUrl = await waitForPageTarget(port);
  const cdp = await Cdp.connect(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const goto = async (url: string, waitFor = "!!document.querySelector('.cm-content')") => {
    await cdp.send("Page.navigate", { url });
    await cdp.waitFor(waitFor, "画面の描画");
  };
  /** 出力タブに出ている positive の文字列 */
  const renderedPositive = () => cdp.evaluate<string>("document.querySelector('.output-text')?.textContent ?? ''");
  const statusText = () => cdp.evaluate<string>("document.querySelector('.status')?.textContent?.trim() ?? ''");

  console.log(`\n対象: ${baseUrl}\n`);

  // ── 1. 初期表示（テンプレート = anima） ──────────────────────────
  await goto(cacheBust("default"));
  await cdp.waitFor(`document.querySelector('.output-text')?.textContent?.includes('masterpiece')`, "初期コンパイル");
  const positiveDefault = (await renderedPositive()).trim();
  check(
    "初期表示の positive が CLI と完全一致（anima）",
    positiveDefault === expectDefault.positive,
    positiveDefault === expectDefault.positive ? `${positiveDefault.length} 文字` : `期待: ${expectDefault.positive.slice(0, 60)}… / 実際: ${positiveDefault.slice(0, 60)}…`,
  );
  check("コンパイルが成功している（エラー 0）", (await statusText()).startsWith("✓"), await statusText());

  // ── 2. モデル切替（打鍵なしで再コンパイルされるか） ──────────────
  await cdp.evaluate(`(() => {
    const select = document.querySelector('.head-actions select');
    select.value = 'illustrious';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await cdp.waitFor(`document.querySelector('.status')?.textContent?.includes('Illustrious')`, "モデル切替の再コンパイル");
  const positiveIllustrious = (await renderedPositive()).trim();
  const expectTemplateIllustrious = compileFiles([{ path: "/main.np", source: defaultSource }], { model: "illustrious" });
  check(
    "モデル切替後も CLI と完全一致（illustrious）",
    positiveIllustrious === expectTemplateIllustrious.positive,
    positiveIllustrious === expectTemplateIllustrious.positive ? "一致" : "不一致",
  );
  check("切替で人数タグが先頭に移動した", positiveIllustrious.startsWith("1girl"), positiveIllustrious.slice(0, 40));

  // ── 3. 共有URL から別ソースを復元してコンパイル ──────────────────
  const soloToken = await encodeShare({ files: [{ path: renamed(solo), source: solo.source }], model: "illustrious" });
  await goto(`${cacheBust("solo")}#s=${soloToken}`);
  await cdp.waitFor(`document.querySelector('.output-text')?.textContent?.includes('hatsune miku')`, "共有URLの復元");
  const positiveSolo = (await renderedPositive()).trim();
  check(
    "共有URLのソースが CLI と完全一致（solo.np / illustrious）",
    positiveSolo === expectSoloIllustrious.positive,
    positiveSolo === expectSoloIllustrious.positive ? "一致" : `期待: ${expectSoloIllustrious.positive.slice(0, 60)}…`,
  );
  check("共有URLのモデル指定が復元されている", (await statusText()).includes("Illustrious"), await statusText());

  // ── 4. 違反例: エラー表示・行ハイライト・行ジャンプ ──────────────
  const brokenToken = await encodeShare({ files: [{ path: renamed(broken), source: broken.source }], model: null });
  await goto(`${cacheBust("broken")}#s=${brokenToken}`);
  await cdp.waitFor(`!!document.querySelector('.diag')`, "エラー表示");
  const diagText = await cdp.evaluate<string>("document.querySelector('.diag')?.textContent?.replace(/\\s+/g, ' ') ?? ''");
  check("アンダースコア違反が表示される", diagText.includes("アンダースコア"), diagText.slice(0, 90));
  check(
    "エラー件数が CLI と一致する",
    (await cdp.evaluate<number>("document.querySelectorAll('.diag').length")) === expectBroken.diagnostics.length,
    `DOM ${await cdp.evaluate<number>("document.querySelectorAll('.diag').length")} 件 / CLI ${expectBroken.diagnostics.length} 件`,
  );
  check(
    "エラー行がエディタ上でハイライトされる",
    (await cdp.evaluate<number>("document.querySelectorAll('.cm-error-line').length")) > 0,
  );

  const located = /:(\d+):(\d+)/.exec(diagText);
  await cdp.evaluate("document.querySelector('.diag').click()");
  if (located) {
    await cdp.waitFor(
      `document.querySelector('.editor-foot')?.textContent?.includes('Ln ${located[1]}, Col ${located[2]}')`,
      "行ジャンプ",
    );
    check(`クリックで該当行へ移動する（Ln ${located[1]}, Col ${located[2]}）`, true);
  } else {
    check("クリックで該当行へ移動する", false, "診断から位置を読み取れませんでした");
  }

  // ── 5. localStorage からの復元（ハッシュ無しで開き直す） ─────────
  await goto(cacheBust("stored"));
  await cdp.waitFor(`!!document.querySelector('.diag')`, "localStorage からの復元");
  check(
    "リロードしても localStorage からソースが復元される",
    (await cdp.evaluate<string>("document.querySelector('.file-name')?.textContent?.trim() ?? ''")) === renamed(broken),
    await cdp.evaluate<string>("document.querySelector('.file-name')?.textContent?.trim() ?? ''"),
  );

  // ── 6. 実行時エラーが出ていないか ────────────────────────────────
  const errors = cdp.errors();
  check("ブラウザのコンソールエラーが無い", errors.length === 0, errors.slice(0, 2).join(" / "));

  // ── 7. スクリーンショット（既定テンプレートの表示に戻す） ────────
  if (shotPath) {
    const defaultToken = await encodeShare({ files: [{ path: "/main.np", source: defaultSource }], model: null });
    await goto(`${cacheBust("shot")}#s=${defaultToken}`);
    await cdp.waitFor(`document.querySelector('.output-text')?.textContent?.includes('masterpiece')`, "描画");
    await sleep(500);
    const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
    console.log(`\nスクリーンショット: ${shotPath}`);
  }

  cdp.close();
} finally {
  proc.kill("SIGKILL");
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 項目が成功`);
process.exit(failed.length === 0 ? 0 : 1);
