<script lang="ts">
  /**
   * nix-prompt Web UI。
   *
   * すべてブラウザ内で完結します（サーバーなし）。
   * コンパイラ本体はリポジトリ直下の `src/` をそのまま import しています。
   */
  import { onMount, tick } from "svelte";
  import { MODELS, modelIds } from "../../../src/models";
  import { templateFor } from "../../../src/templates";
  import Diagnostics from "./Diagnostics.svelte";
  import Editor from "./Editor.svelte";
  import FileTabs from "./FileTabs.svelte";
  import OutputPanel from "./OutputPanel.svelte";
  import { copyText, downloadText, pickTextFile, safeFilename } from "./dom";
  import {
    compileFiles,
    diagnosticsText,
    modelLabel,
    sameFile,
    type CompileOutcome,
    type Diagnostic,
  } from "./engine";
  import { ERROR_EXAMPLES, EXAMPLES, type ExampleEntry } from "./examples.generated";
  import {
    clearWorkspace,
    decodeShare,
    encodeShare,
    loadWorkspace,
    readShareToken,
    saveWorkspace,
    shareUrl,
  } from "./persist";

  type FileEntry = { path: string; source: string };
  type EditorApi = { focusAt: (line: number, col: number) => void };

  const DEFAULT_PATH = "/main.np";
  const defaultFile = (): FileEntry => ({ path: DEFAULT_PATH, source: templateFor("anima") });

  let files = $state<FileEntry[]>([defaultFile()]);
  let activeIndex = $state(0);
  let modelOverride = $state<string | null>(null);
  let toast = $state("");
  let booted = $state(false);
  let editor: EditorApi | null = null;
  let cursorLine = $state(1);
  let cursorCol = $state(1);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const outcome: CompileOutcome = $derived(
    compileFiles(files, { entry: files[0]?.path ?? DEFAULT_PATH, model: modelOverride }),
  );
  const activeFile = $derived(files[activeIndex] ?? files[0]);
  const errorLines = $derived(
    outcome.diagnostics
      .filter((d) => d.line !== null && sameFile(d.file, activeFile?.path ?? DEFAULT_PATH))
      .map((d) => d.line as number),
  );
  const modelChoices = $derived(modelIds());

  function notify(message: string) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = "";
    }, 3200);
  }

  // ── ソースの差し替え ────────────────────────────────────────────
  function replaceAll(source: string, path = DEFAULT_PATH) {
    files = [{ path, source }];
    activeIndex = 0;
  }

  function loadTemplate(id: string) {
    replaceAll(templateFor(id));
    notify(`${id} のテンプレートを読み込みました`);
  }

  function loadExample(example: ExampleEntry) {
    replaceAll(example.source, `/${example.name.split("/").pop()}`);
    notify(`サンプル ${example.name} を読み込みました`);
  }

  function updateActiveSource(next: string) {
    const index = activeIndex;
    files = files.map((file, i) => (i === index ? { ...file, source: next } : file));
  }

  // ── 仮想FS のファイル操作 ──────────────────────────────────────
  function addFile() {
    const used = new Set(files.map((f) => f.path));
    let n = files.length + 1;
    let path = `/file${n}.np`;
    while (used.has(path)) path = `/file${++n}.np`;
    files = [...files, { path, source: `{ model = "anima"; }\n` }];
    activeIndex = files.length - 1;
  }

  function renameFile(index: number) {
    const current = files[index];
    const input = window.prompt("ファイル名（`import ./名前.np` で参照できます）", current.path);
    if (input === null) return;
    const path = input.trim().startsWith("/") ? input.trim() : `/${input.trim()}`;
    if (path === "/") {
      notify("ファイル名を入力してください");
      return;
    }
    if (files.some((file, i) => i !== index && file.path === path)) {
      notify(`同名のファイルがあります: ${path}`);
      return;
    }
    files = files.map((file, i) => (i === index ? { ...file, path } : file));
  }

  function removeFile(index: number) {
    if (files.length <= 1) {
      notify("最後の1つは削除できません");
      return;
    }
    files = files.filter((_, i) => i !== index);
    activeIndex = Math.min(activeIndex, files.length - 1);
  }

  async function importFile() {
    const picked = await pickTextFile();
    if (!picked) return;
    const path = `/${picked.name.replace(/^.*[\\/]/, "")}`;
    files = [...files.filter((file) => file.path !== path), { path, source: picked.text }];
    activeIndex = files.length - 1;
    notify(`${path} を読み込みました`);
  }

  // ── エラーからのジャンプ ────────────────────────────────────────
  async function jumpTo(diagnostic: Diagnostic) {
    if (diagnostic.line === null) return;
    const index = files.findIndex((file) => sameFile(file.path, diagnostic.file));
    if (index >= 0 && index !== activeIndex) activeIndex = index;
    await tick();
    editor?.focusAt(diagnostic.line, diagnostic.col ?? 1);
  }

  // ── 保存・共有・リセット ────────────────────────────────────────
  function downloadSource() {
    downloadText(safeFilename(activeFile?.path ?? "prompt.np", "prompt.np"), activeFile?.source ?? "");
  }

  function downloadOutput() {
    if (!outcome.ok) {
      downloadText("errors.txt", diagnosticsText(outcome.diagnostics));
      return;
    }
    downloadText("prompt.txt", `positive:\n${outcome.positive}\n\nnegative:\n${outcome.negative}\n`);
  }

  async function copyOutput() {
    if (!outcome.ok) return;
    const ok = await copyText(`positive:\n${outcome.positive}\n\nnegative:\n${outcome.negative}`);
    notify(ok ? "positive / negative をコピーしました" : "コピーできませんでした");
  }

  async function share() {
    const token = await encodeShare({ files: $state.snapshot(files) as FileEntry[], model: modelOverride });
    history.replaceState(null, "", shareUrl(token));
    const ok = await copyText(shareUrl(token));
    notify(ok ? "共有URLをコピーしました（ソースを丸ごと埋め込み）" : "共有URLをアドレスバーに設定しました");
  }

  function reset() {
    clearWorkspace();
    files = [defaultFile()];
    activeIndex = 0;
    modelOverride = null;
    history.replaceState(null, "", location.pathname + location.search);
    notify("初期状態に戻しました");
  }

  onMount(async () => {
    const token = readShareToken(location.hash);
    if (token) {
      const shared = await decodeShare(token);
      if (shared) {
        files = shared.files;
        modelOverride = shared.model;
        booted = true;
        notify("共有されたプロンプトを復元しました");
        return;
      }
      notify("共有URLを読み取れませんでした");
    }
    const stored = loadWorkspace();
    if (stored) {
      files = stored.files;
      modelOverride = stored.model;
    }
    booted = true;
  });

  $effect(() => {
    if (!booted) return;
    saveWorkspace({ files: $state.snapshot(files) as FileEntry[], model: modelOverride });
  });
</script>

<svelte:head>
  <title>nix-prompt — プロンプトコンパイラ</title>
</svelte:head>

<header class="app-head">
  <div class="brand">
    <h1>nix-prompt</h1>
    <p class="tagline">Nix 風の宣言的 DSL で書いて、モデルごとの順序へ正規化する。</p>
  </div>
  <div class="head-actions">
    <label class="field">
      <span>モデル</span>
      <select value={modelOverride ?? ""} onchange={(e) => (modelOverride = e.currentTarget.value || null)}>
        <option value="">ファイルの指定に従う</option>
        {#each modelChoices as id (id)}
          <option value={id}>{id} — {MODELS[id]?.label ?? id}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>テンプレート</span>
      <select value="" onchange={(e) => e.currentTarget.value && loadTemplate(e.currentTarget.value)}>
        <option value="">読み込む…</option>
        {#each modelChoices as id (id)}
          <option value={id}>init {id}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>サンプル</span>
      <select value="" onchange={(e) => {
        const value = e.currentTarget.value;
        if (!value) return;
        const found =
          EXAMPLES.find((x) => x.name === value) ?? ERROR_EXAMPLES.find((x) => x.name === value);
        if (found) loadExample(found);
      }}>
        <option value="">読み込む…</option>
        <optgroup label="正常系">
          {#each EXAMPLES as example (example.name)}
            <option value={example.name}>{example.title}</option>
          {/each}
        </optgroup>
        <optgroup label="違反例（エラーの出方を確認）">
          {#each ERROR_EXAMPLES as example (example.name)}
            <option value={example.name}>{example.title}</option>
          {/each}
        </optgroup>
      </select>
    </label>
    <button type="button" class="ghost" onclick={share}>共有URL</button>
    <button type="button" class="ghost" onclick={reset}>リセット</button>
  </div>
</header>

<main class="layout">
  <section class="panel editor-panel">
    <header class="panel-head">
      <span class="panel-title">
        ソース
        <span class="muted">{activeFile?.path}</span>
      </span>
      <div class="panel-actions">
        <span class="status" class:ok={outcome.ok} class:ng={!outcome.ok}>
          {outcome.ok ? `✓ ${modelLabel(outcome.model)}` : `✕ ${outcome.diagnostics.length} 件のエラー`}
        </span>
        <button type="button" class="ghost" onclick={downloadSource}>ダウンロード</button>
      </div>
    </header>
    <FileTabs
      {files}
      {activeIndex}
      onSelect={(i) => (activeIndex = i)}
      onAdd={addFile}
      onRename={renameFile}
      onDelete={removeFile}
      onImport={importFile}
    />
    <div class="editor-slot">
      <Editor
        bind:this={editor}
        value={activeFile?.source ?? ""}
        onChange={updateActiveSource}
        onSave={downloadSource}
        onCursor={(line, col) => {
          cursorLine = line;
          cursorCol = col;
        }}
        {errorLines}
      />
    </div>
    <footer class="editor-foot">
      <span>Ln {cursorLine}, Col {cursorCol}</span>
      <span>{((activeFile?.source ?? "").length / 1024).toFixed(1)} KB</span>
      <span class="muted">`import ./file.np` で仮想FS内の他ファイルを参照できます</span>
    </footer>
  </section>

  <section class="right">
    {#if outcome.diagnostics.length > 0}
      <Diagnostics diagnostics={outcome.diagnostics} onJump={jumpTo} />
    {/if}
    <OutputPanel {outcome} onNotify={notify} />
    <div class="panel-actions wide">
      <button type="button" class="ghost" onclick={copyOutput} disabled={!outcome.ok}>positive / negative をコピー</button>
      <button type="button" class="ghost" onclick={downloadOutput}>出力を保存</button>
    </div>
  </section>
</main>

{#if toast}
  <div class="toast" role="status">{toast}</div>
{/if}

<footer class="app-foot">
  <span>すべてブラウザ内で処理しています（送信なし）</span>
  <a href="https://github.com/erialsan/nix-prompt" target="_blank" rel="noreferrer">GitHub / ドキュメント</a>
</footer>
