'use client'

import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import {
  type InitialConfigType,
  LexicalComposer,
} from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { $isHeadingNode } from '@lexical/rich-text'
import { $getRoot } from 'lexical'
import { useEffect, useId } from 'react'

import { editorNodes } from '../editor/editor-nodes'
import { editorTheme } from '../editor/editor-theme'
import {
  looksLikeLexicalState,
  prepareMarkdown,
  type ReaderHeading,
} from './reader-content'

import '../editor/editor.css'

export interface ArticleBodyProps {
  /** Source content: Lexical state JSON, markdown, or plain text. */
  content: string
  /** Called once after mount with the document's headings (for the TOC). */
  onHeadings?: (headings: ReaderHeading[]) => void
}

/**
 * Read-only Lexical renderer for source/reference material (DET-209). Reuses the
 * shared node set and theme, but initializes its state from markdown/plain text
 * when the content isn't already a serialized Lexical document. Editing is off
 * by default — this is a reading surface, not an editor.
 */
export function ArticleBody({ content, onHeadings }: ArticleBodyProps) {
  const isLexical = looksLikeLexicalState(content)
  // Namespace heading ids per reader instance so two readers on one page can't
  // collide (the TOC resolves anchors via the global document.getElementById).
  const idPrefix = useId().replace(/:/g, '')

  const initialConfig: InitialConfigType = {
    namespace: 'kibadist-reader',
    theme: editorTheme,
    nodes: [...editorNodes],
    editable: false,
    // A string initializes from serialized state. The function form is already
    // invoked by Lexical inside an editor update (history-merge), so we build
    // nodes from markdown/plain text directly — no extra update wrapper.
    editorState: isLexical
      ? content
      : () => {
          $convertFromMarkdownString(prepareMarkdown(content), TRANSFORMERS)
        },
    onError(error) {
      console.error(error)
      throw error
    },
  }

  return (
    <div className='kb-reader-body'>
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={<ContentEditable className='kb-reader-content' />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        {onHeadings && (
          <HeadingAnchorsPlugin idPrefix={idPrefix} onHeadings={onHeadings} />
        )}
      </LexicalComposer>
    </div>
  )
}

/**
 * After the document renders, collect its top-level headings, assign each a
 * stable DOM id, and report them up so a table of contents can link to them.
 * Read-only content never changes, so this runs once per mount.
 */
function HeadingAnchorsPlugin({
  idPrefix,
  onHeadings,
}: {
  idPrefix: string
  onHeadings: (headings: ReaderHeading[]) => void
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const collected: ReaderHeading[] = []
    editor.getEditorState().read(() => {
      let index = 0
      for (const child of $getRoot().getChildren()) {
        if (!$isHeadingNode(child)) continue
        const text = child.getTextContent().trim()
        if (!text) continue
        const level = Number(child.getTag().slice(1))
        collected.push({
          id: `kb-reader-h-${idPrefix}-${index}`,
          text,
          level: Number.isNaN(level) ? 2 : level,
          nodeKey: child.getKey(),
        })
        index++
      }
    })

    // Assign the ids to the live DOM nodes so anchor scrolling works.
    for (const heading of collected) {
      const el = editor.getElementByKey(heading.nodeKey)
      if (el) el.id = heading.id
    }

    onHeadings(collected)
  }, [editor, idPrefix, onHeadings])

  return null
}
