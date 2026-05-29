'use client'

import {
  type InitialConfigType,
  LexicalComposer,
} from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'

import { editorNodes } from './editor-nodes'
import { isLexicalStateJSON } from './editor-state'
import { editorTheme } from './editor-theme'

import './editor.css'

export interface RichTextViewerProps {
  /** Serialized Lexical state, or a legacy plain-text string. */
  value: string
}

/**
 * Renders saved note content read-only. Legacy notes whose `body` is plain
 * text (not Lexical JSON) fall back to preformatted text.
 */
export function RichTextViewer({ value }: RichTextViewerProps) {
  if (!isLexicalStateJSON(value)) {
    return <p className='whitespace-pre-wrap'>{value}</p>
  }

  const initialConfig: InitialConfigType = {
    namespace: 'kibadist-viewer',
    theme: editorTheme,
    nodes: [...editorNodes],
    editable: false,
    editorState: value,
    onError(error) {
      console.error(error)
      throw error
    },
  }

  return (
    <div className='kb-viewer'>
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={<ContentEditable className='kb-viewer-content' />}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </LexicalComposer>
    </div>
  )
}
