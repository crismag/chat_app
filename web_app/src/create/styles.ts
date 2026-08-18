import type { CreateStyle } from '@chat/shared'
import { CREATE_STYLES } from '@chat/shared'
import type { StudioDocument, StudioElement } from '@crismag/create-studio'

export interface ChatStudioStyleTokens {
  background: string
  panelFill: string
  panelStroke: string
  titleColor: string
  bodyColor: string
  mutedColor: string
  fontFamily: string
  titleWeight: number
  bodyWeight: number
  cornerRadius: number
  overlayFill: string
  overlayOpacity: number
}

export const CHAT_STUDIO_STYLE_TOKENS: Record<CreateStyle, ChatStudioStyleTokens> = {
  [CREATE_STYLES.CREAM_BOTANICAL]: {
    background: '#f6efe4',
    panelFill: '#fffaf2',
    panelStroke: '#d9cbb8',
    titleColor: '#2b241c',
    bodyColor: '#2b241c',
    mutedColor: '#7b5d3e',
    fontFamily: 'Georgia, serif',
    titleWeight: 600,
    bodyWeight: 400,
    cornerRadius: 32,
    overlayFill: '#6b4a2a',
    overlayOpacity: 0,
  },
  [CREATE_STYLES.MODERN_MINIMAL]: {
    background: '#f7f7f5',
    panelFill: '#ffffff',
    panelStroke: '#d8d5cf',
    titleColor: '#161616',
    bodyColor: '#1f1f1f',
    mutedColor: '#6b6b6b',
    fontFamily: 'Arial, sans-serif',
    titleWeight: 600,
    bodyWeight: 400,
    cornerRadius: 8,
    overlayFill: '#111111',
    overlayOpacity: 0,
  },
  [CREATE_STYLES.DARK_WORSHIP]: {
    background: '#16121c',
    panelFill: '#241c2c',
    panelStroke: '#4a3a58',
    titleColor: '#f4efe8',
    bodyColor: '#ebe4da',
    mutedColor: '#c4b4a0',
    fontFamily: 'Georgia, serif',
    titleWeight: 600,
    bodyWeight: 400,
    cornerRadius: 28,
    overlayFill: '#08060c',
    overlayOpacity: 0,
  },
  [CREATE_STYLES.WARM_PHOTOGRAPHIC]: {
    background: '#5c2e1c',
    panelFill: '#3d1f14',
    panelStroke: '#c9895c',
    titleColor: '#fff6ea',
    bodyColor: '#f6ead8',
    mutedColor: '#e2c4a2',
    fontFamily: 'Georgia, serif',
    titleWeight: 600,
    bodyWeight: 400,
    cornerRadius: 24,
    overlayFill: '#1a0c08',
    overlayOpacity: 0.32,
  },
  [CREATE_STYLES.JOURNAL_PAPER]: {
    background: '#efe4cf',
    panelFill: '#fbf3e3',
    panelStroke: '#cbb892',
    titleColor: '#3b2f22',
    bodyColor: '#3b2f22',
    mutedColor: '#7a6448',
    fontFamily: 'Georgia, serif',
    titleWeight: 600,
    bodyWeight: 400,
    cornerRadius: 6,
    overlayFill: '#8a6a3c',
    overlayOpacity: 0,
  },
}

function slotOf(element: StudioElement): string {
  return typeof element.metadata?.['semanticSlot'] === 'string' ? element.metadata['semanticSlot'] : ''
}

function textColor(slot: string, tokens: ChatStudioStyleTokens): string {
  if (slot.includes('.label') || slot.includes('page-label')) return tokens.mutedColor
  if (slot.includes('title') || slot.includes('reference')) return tokens.titleColor
  return tokens.bodyColor
}

function textWeight(slot: string, tokens: ChatStudioStyleTokens): number {
  if (slot.includes('.label') || slot.includes('title') || slot.includes('reference') || slot.includes('page-label')) {
    return tokens.titleWeight
  }
  return tokens.bodyWeight
}

/** Paint an existing composition with a style. Text and geometry stay put. */
export function applyChatStudioStyle(document: StudioDocument, style: CreateStyle): StudioDocument {
  const tokens = CHAT_STUDIO_STYLE_TOKENS[style]
  return {
    ...document,
    metadata: { ...document.metadata, style },
    pages: document.pages.map((page) => ({
      ...page,
      background: { kind: 'solid', color: tokens.background },
      elements: page.elements.map((element) => {
        const slot = slotOf(element)
        if (element.kind === 'rectangle' || element.kind === 'rounded-rectangle') {
          if (slot === 'style.overlay') {
            return { ...element, fill: tokens.overlayFill, opacity: tokens.overlayOpacity, isVisible: tokens.overlayOpacity > 0 }
          }
          return {
            ...element,
            fill: tokens.panelFill,
            stroke: tokens.panelStroke,
            ...(element.kind === 'rounded-rectangle' ? { cornerRadius: tokens.cornerRadius } : {}),
          }
        }
        if (element.kind === 'text') {
          return {
            ...element,
            fontFamily: tokens.fontFamily,
            fontWeight: textWeight(slot, tokens),
            color: textColor(slot, tokens),
          }
        }
        return element
      }),
    })),
  }
}
