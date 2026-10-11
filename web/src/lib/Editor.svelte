<script lang="ts">
  /**
   * CodeMirror 6 による .np エディタ。
   *
   * - 値は親が持ち、変更は onChange で通知する（一方向）
   * - エラー行のハイライトと、行・列へのジャンプを提供する
   */
  import { onMount } from "svelte";
  import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
  import {
    Decoration,
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    type DecorationSet,
  } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
  import { tags as t } from "@lezer/highlight";
  import { nixPromptLanguage } from "./dsl-language";

  type Props = {
    value: string;
    onChange?: (next: string) => void;
    onSave?: () => void;
    onCursor?: (line: number, col: number) => void;
    /** エラー行（1 始まり）。空配列で解除。 */
    errorLines?: number[];
  };

  let { value, onChange, onSave, onCursor, errorLines = [] }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let ready = $state(false);
  /** 親からの値反映中は onChange を発火させない */
  let applyingExternal = false;

  const setErrorLines = StateEffect.define<number[]>();

  const errorLineField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      let next = deco.map(tr.changes);
      for (const effect of tr.effects) {
        if (!effect.is(setErrorLines)) continue;
        const marks = [];
        for (const lineNo of effect.value) {
          if (lineNo < 1 || lineNo > tr.state.doc.lines) continue;
          const line = tr.state.doc.line(lineNo);
          marks.push(Decoration.line({ class: "cm-error-line" }).range(line.from));
        }
        next = Decoration.set(marks);
      }
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const theme = EditorView.theme(
    {
      "&": {
        color: "var(--fg)",
        backgroundColor: "transparent",
        fontSize: "13px",
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily: "var(--mono)",
        lineHeight: "1.6",
        overflow: "auto",
      },
      ".cm-content": { padding: "12px 0", caretColor: "var(--accent)" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--fg-faint)",
        border: "none",
        paddingRight: "4px",
      },
      ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.04)" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-dim)" },
      ".cm-error-line": { backgroundColor: "rgba(248,81,73,0.12)", boxShadow: "inset 2px 0 0 var(--danger)" },
      "&.cm-focused": { outline: "none" },
      ".cm-selectionBackground, ::selection": { backgroundColor: "rgba(88,166,255,0.25)" },
      ".cm-cursor": { borderLeftColor: "var(--accent)" },
      ".cm-panels": { backgroundColor: "var(--bg-2)", color: "var(--fg)" },
    },
    { dark: true },
  );

  const highlight = HighlightStyle.define([
    { tag: t.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
    { tag: t.keyword, color: "var(--syntax-keyword)" },
    { tag: t.atom, color: "var(--syntax-atom)" },
    { tag: t.bool, color: "var(--syntax-atom)" },
    { tag: t.number, color: "var(--syntax-number)" },
    { tag: t.string, color: "var(--syntax-string)" },
    { tag: t.propertyName, color: "var(--syntax-property)" },
    { tag: t.variableName, color: "var(--syntax-variable)" },
    { tag: t.definition(t.variableName), color: "var(--syntax-builtin)" },
    { tag: t.operator, color: "var(--syntax-operator)" },
    { tag: t.punctuation, color: "var(--syntax-punctuation)" },
    { tag: t.invalid, color: "var(--danger)" },
  ]);

  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    drawSelection(),
    history(),
    bracketMatching(),
    indentOnInput(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(highlight),
    nixPromptLanguage,
    errorLineField,
    EditorView.lineWrapping,
    theme,
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSave?.();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternal) {
        onChange?.(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        onCursor?.(line.number, head - line.from + 1);
      }
    }),
  ];

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    });
    ready = true;
    return () => {
      view?.destroy();
      view = null;
    };
  });

  // 親からの値変更（テンプレ読み込み・ファイル切替・URL 復元）を反映する
  $effect(() => {
    void ready;
    const next = value;
    if (!view) return;
    if (view.state.doc.toString() === next) return;
    applyingExternal = true;
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    } finally {
      applyingExternal = false;
    }
  });

  // エラー行のハイライトを反映する
  $effect(() => {
    void ready;
    const lines = errorLines;
    view?.dispatch({ effects: setErrorLines.of(lines) });
  });

  /** 指定した行・列へカーソルを移動する。 */
  export function focusAt(line: number, col: number): void {
    if (!view) return;
    const doc = view.state.doc;
    const target = doc.line(Math.min(Math.max(1, line), doc.lines));
    const pos = Math.min(target.from + Math.max(0, col - 1), target.to);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  /** 現在のカーソル位置。 */
  export function cursor(): { line: number; col: number } {
    if (!view) return { line: 1, col: 1 };
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return { line: line.number, col: head - line.from + 1 };
  }
</script>

<div class="editor-host" bind:this={host}></div>

<style>
  .editor-host {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
</style>
