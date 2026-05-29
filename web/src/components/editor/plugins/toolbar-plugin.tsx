'use client'

import { $createCodeNode } from '@lexical/code'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from '@lexical/list'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  type HeadingTagType,
} from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { $getNearestNodeOfType, mergeRegister } from '@lexical/utils'
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  type ElementNode,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type TextFormatType,
  UNDO_COMMAND,
} from 'lexical'
import { useCallback, useEffect, useState } from 'react'

type BlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'bullet'
  | 'number'
  | 'code'

const LOW_PRIORITY = 1

interface ToolbarButtonProps {
  active?: boolean
  disabled?: boolean
  label: string
  title: string
  onClick: () => void
}

function ToolbarButton({
  active,
  disabled,
  label,
  title,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      type='button'
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`kb-toolbar-btn${active ? ' is-active' : ''}`}
    >
      {label}
    </button>
  )
}

function Divider() {
  return <span className='kb-toolbar-divider' aria-hidden='true' />
}

export function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const [blockType, setBlockType] = useState<BlockType>('paragraph')
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [isLink, setIsLink] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const updateToolbar = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    setIsBold(selection.hasFormat('bold'))
    setIsItalic(selection.hasFormat('italic'))
    setIsUnderline(selection.hasFormat('underline'))
    setIsStrikethrough(selection.hasFormat('strikethrough'))
    setIsCode(selection.hasFormat('code'))

    const anchorNode = selection.anchor.getNode()
    const element =
      anchorNode.getKey() === 'root'
        ? anchorNode
        : anchorNode.getTopLevelElementOrThrow()
    const elementKey = element.getKey()
    const elementDOM = editor.getElementByKey(elementKey)

    const node = anchorNode
    const parent = node.getParent()
    setIsLink($isLinkNode(parent) || $isLinkNode(node))

    if (elementDOM === null) return

    if ($isListNode(element)) {
      const parentList = $getNearestNodeOfType(anchorNode, ListNode)
      const type = parentList ? parentList.getListType() : element.getListType()
      setBlockType(type === 'number' ? 'number' : 'bullet')
    } else if ($isHeadingNode(element)) {
      const tag = element.getTag()
      setBlockType(tag === 'h1' || tag === 'h2' || tag === 'h3' ? tag : 'h3')
    } else {
      const type = element.getType()
      if (type === 'quote') setBlockType('quote')
      else if (type === 'code') setBlockType('code')
      else setBlockType('paragraph')
    }
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => updateToolbar())
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar()
          return false
        },
        LOW_PRIORITY,
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload)
          return false
        },
        LOW_PRIORITY,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload)
          return false
        },
        LOW_PRIORITY,
      ),
    )
  }, [editor, updateToolbar])

  const formatText = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
  }

  const formatBlock = (creator: () => ElementNode) => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, creator)
      }
    })
  }

  const formatParagraph = () => formatBlock(() => $createParagraphNode())
  const formatHeading = (tag: HeadingTagType) =>
    formatBlock(() => $createHeadingNode(tag))
  const formatQuote = () => formatBlock(() => $createQuoteNode())
  const formatCode = () => formatBlock(() => $createCodeNode())

  const toggleBulletList = () => {
    editor.dispatchCommand(
      blockType === 'bullet'
        ? REMOVE_LIST_COMMAND
        : INSERT_UNORDERED_LIST_COMMAND,
      undefined,
    )
  }

  const toggleNumberList = () => {
    editor.dispatchCommand(
      blockType === 'number'
        ? REMOVE_LIST_COMMAND
        : INSERT_ORDERED_LIST_COMMAND,
      undefined,
    )
  }

  const toggleLink = () => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
      return
    }
    const url = window.prompt('Enter URL')
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
  }

  return (
    <div className='kb-toolbar' role='toolbar' aria-label='Formatting'>
      <ToolbarButton
        title='Undo'
        label='↶'
        disabled={!canUndo}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      />
      <ToolbarButton
        title='Redo'
        label='↷'
        disabled={!canRedo}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      />
      <Divider />
      <ToolbarButton
        title='Bold'
        label='B'
        active={isBold}
        onClick={() => formatText('bold')}
      />
      <ToolbarButton
        title='Italic'
        label='I'
        active={isItalic}
        onClick={() => formatText('italic')}
      />
      <ToolbarButton
        title='Underline'
        label='U'
        active={isUnderline}
        onClick={() => formatText('underline')}
      />
      <ToolbarButton
        title='Strikethrough'
        label='S'
        active={isStrikethrough}
        onClick={() => formatText('strikethrough')}
      />
      <ToolbarButton
        title='Inline code'
        label='</>'
        active={isCode}
        onClick={() => formatText('code')}
      />
      <Divider />
      <ToolbarButton
        title='Paragraph'
        label='¶'
        active={blockType === 'paragraph'}
        onClick={formatParagraph}
      />
      <ToolbarButton
        title='Heading 1'
        label='H1'
        active={blockType === 'h1'}
        onClick={() => formatHeading('h1')}
      />
      <ToolbarButton
        title='Heading 2'
        label='H2'
        active={blockType === 'h2'}
        onClick={() => formatHeading('h2')}
      />
      <ToolbarButton
        title='Heading 3'
        label='H3'
        active={blockType === 'h3'}
        onClick={() => formatHeading('h3')}
      />
      <ToolbarButton
        title='Quote'
        label='“'
        active={blockType === 'quote'}
        onClick={formatQuote}
      />
      <Divider />
      <ToolbarButton
        title='Bullet list'
        label='•'
        active={blockType === 'bullet'}
        onClick={toggleBulletList}
      />
      <ToolbarButton
        title='Numbered list'
        label='1.'
        active={blockType === 'number'}
        onClick={toggleNumberList}
      />
      <ToolbarButton
        title='Code block'
        label='{ }'
        active={blockType === 'code'}
        onClick={formatCode}
      />
      <Divider />
      <ToolbarButton
        title='Link'
        label='🔗'
        active={isLink}
        onClick={toggleLink}
      />
    </div>
  )
}
