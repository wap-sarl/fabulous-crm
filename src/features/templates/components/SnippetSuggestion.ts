import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { matchSnippets, snippetHtml } from '../lib/snippets';

export type SnippetItem = { _id: string; name: string; shortcut: string; text: string };

/** What the menu shows and where; null when nothing is typed after the slash. */
export type SnippetMenuState = {
  items: SnippetItem[];
  rect: DOMRect | null;
  command: (item: SnippetItem) => void;
} | null;

export type SnippetMenuHandlers = {
  onState: (state: SnippetMenuState) => void;
  /** The menu's keyboard handling, told from the editor; returns true when the key was consumed. */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

/** A slash opens the menu of snippets; the chosen one replaces what was typed. The items come from a getter: the list is loaded by the editor's page. */
export function snippetSuggestion(
  getItems: () => SnippetItem[],
  handlers: SnippetMenuHandlers,
): Extension {
  return Extension.create({
    name: 'snippetSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<SnippetItem>({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          items: ({ query }) => matchSnippets(getItems(), query),
          command: ({ editor, range, props }) => insertSnippet(editor, range, props),
          render: () => ({
            onStart: (props) => handlers.onState(stateOf(props)),
            onUpdate: (props) => handlers.onState(stateOf(props)),
            onKeyDown: ({ event }) => {
              if (event.key === 'Escape') {
                handlers.onState(null);
                return true;
              }
              return handlers.onKeyDown(event);
            },
            onExit: () => handlers.onState(null),
          }),
        }),
      ];
    },
  });
}

function stateOf(props: SuggestionProps<SnippetItem>): SnippetMenuState {
  return {
    items: props.items,
    rect: props.clientRect?.() ?? null,
    command: (item) => props.command(item),
  };
}

function insertSnippet(editor: Editor, range: Range, item: SnippetItem): void {
  editor.chain().focus().deleteRange(range).insertContent(snippetHtml(item.text)).run();
}
