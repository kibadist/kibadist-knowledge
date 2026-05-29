import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import type { Klass, LexicalNode } from 'lexical'

export const editorNodes: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
]
