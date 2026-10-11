<script lang="ts">
  /** コンパイルエラーの一覧。クリックで該当行へジャンプする。 */
  import type { Diagnostic } from "./engine";

  type Props = {
    diagnostics: Diagnostic[];
    onJump?: (diagnostic: Diagnostic) => void;
  };

  let { diagnostics, onJump }: Props = $props();
</script>

<section class="panel diagnostics" aria-label="コンパイルエラー">
  <header class="panel-head">
    <span class="panel-title">
      <span class="badge danger">{diagnostics.length}</span> 件のエラー
    </span>
  </header>
  <ul class="diag-list">
    {#each diagnostics as diagnostic, i (i)}
      <li>
        <button
          type="button"
          class="diag"
          onclick={() => onJump?.(diagnostic)}
          disabled={diagnostic.line === null}
          title={diagnostic.line === null ? "位置情報がありません" : "クリックで該当行へ移動"}
        >
          <span class="diag-where">
            {diagnostic.file}{diagnostic.line !== null ? `:${diagnostic.line}:${diagnostic.col ?? 1}` : ""}
          </span>
          <span class="diag-message">{diagnostic.message}</span>
          {#if diagnostic.hint}
            <span class="diag-hint">hint: {diagnostic.hint}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</section>
