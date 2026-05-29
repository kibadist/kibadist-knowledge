'use client'

import { TRANSFORMERS } from '@lexical/markdown'
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin'
import {
  type InitialConfigType,
  LexicalComposer,
} from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { $getRoot, type EditorState } from 'lexical'

import { editorNodes } from './editor-nodes'
import { isLexicalStateJSON } from './editor-state'
import { editorTheme } from './editor-theme'
import { CodeHighlightPlugin } from './plugins/code-highlight-plugin'
import { ToolbarPlugin } from './plugins/toolbar-plugin'

import './editor.css'

export interface RichTextEditorProps {
  /** Serialized Lexical editor state (JSON string) to start from. */
  initialJSON?: string | null
  /** Called on every change with the serialized state and whether it is empty. */
  onChange?: (serializedState: string, isEmpty: boolean) => void
  placeholder?: string
  autoFocus?: boolean
  namespace?: string
}

export function RichTextEditor({
  initialJSON,
  onChange,
  placeholder = 'Write something…',
  autoFocus = false,
  namespace = 'kibadist-editor',
}: RichTextEditorProps) {
  const initialConfig: InitialConfigType = {
    namespace,
    theme: editorTheme,
    nodes: [...editorNodes],
    editorState: isLexicalStateJSON(initialJSON) ? initialJSON : undefined,
    onError(error) {
      console.error(error)
      throw error
    },
  }

  function handleChange(editorState: EditorState) {
    if (!onChange) return
    editorState.read(() => {
      const text = $getRoot().getTextContent()
      onChange(JSON.stringify(editorState.toJSON()), text.trim().length === 0)
    })
  }

  return (
    <div className='kb-editor'>
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin />
        <div className='kb-editor-shell'>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className='kb-content'
                aria-placeholder={placeholder}
                placeholder={
                  <div className='kb-placeholder'>{placeholder}</div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <TabIndentationPlugin />
        <CodeHighlightPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        {autoFocus && <AutoFocusPlugin />}
        {onChange && <OnChangePlugin onChange={handleChange} />}
      </LexicalComposer>
    </div>
  )
}
