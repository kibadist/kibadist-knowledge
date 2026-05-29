import { BadRequestException } from '@nestjs/common'

import { MAX_RAW_TEXT_CHARS } from './inbox.constants'

/**
 * Extracts raw text from an uploaded PDF buffer using `unpdf` (pure-JS, no
 * native deps — safe in the slim Docker runtime). The text is stored verbatim
 * as raw material; nothing is summarized or interpreted (DET-187).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  // Imported lazily so the (sizeable) pdf.js bundle only loads when a PDF is
  // actually uploaded, not on every server boot.
  const { extractText, getDocumentProxy } = await import('unpdf')
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    // mergePages:true returns the whole document as a single string.
    const { text } = await extractText(pdf, { mergePages: true })
    // Preserve line/paragraph breaks (collapse only spaces/tabs) so the
    // structured extractor (DET-210) can segment paragraphs; the prior
    // whitespace-collapse destroyed all structure.
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_RAW_TEXT_CHARS)
  } catch {
    throw new BadRequestException('Could not read PDF')
  }
}
