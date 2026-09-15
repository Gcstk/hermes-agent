const COMPOSER_WIDTH = 420
const COMPOSER_HEIGHT_ESTIMATE = 380
const SELECTION_TOOLBAR_WIDTH = 268
const SELECTION_TOOLBAR_HEIGHT = 42
const VIEWPORT_GUTTER = 16
const ANCHOR_GAP = 12

export interface SelectionRectangle {
  left: number
  right: number
  top: number
  bottom: number
}

interface ViewportRectangle {
  width: number
  height: number
  scrollX: number
  scrollY: number
}

interface ComposerPosition {
  left: number
  top: number
}

export function placeSelectionToolbar(
  selection: SelectionRectangle,
  viewport: ViewportRectangle,
): ComposerPosition {
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_GUTTER * 2)
  const toolbarWidth = Math.min(SELECTION_TOOLBAR_WIDTH, availableWidth)
  const maximumLeft = Math.max(VIEWPORT_GUTTER, viewport.width - toolbarWidth - VIEWPORT_GUTTER)
  const centeredLeft = selection.left + (selection.right - selection.left - toolbarWidth) / 2
  const left = Math.min(maximumLeft, Math.max(VIEWPORT_GUTTER, centeredLeft))
  const above = selection.top - ANCHOR_GAP - SELECTION_TOOLBAR_HEIGHT
  const top = above >= VIEWPORT_GUTTER
    ? above
    : Math.min(
      Math.max(VIEWPORT_GUTTER, viewport.height - SELECTION_TOOLBAR_HEIGHT - VIEWPORT_GUTTER),
      selection.bottom + ANCHOR_GAP,
    )

  return {
    left: left + viewport.scrollX,
    top: top + viewport.scrollY,
  }
}

export function placeAnnotationComposer(
  selection: SelectionRectangle,
  viewport: ViewportRectangle,
): ComposerPosition {
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_GUTTER * 2)
  const composerWidth = Math.min(COMPOSER_WIDTH, availableWidth)
  const maximumLeft = Math.max(VIEWPORT_GUTTER, viewport.width - composerWidth - VIEWPORT_GUTTER)

  let left: number
  if (selection.right + ANCHOR_GAP + composerWidth <= viewport.width - VIEWPORT_GUTTER) {
    left = selection.right + ANCHOR_GAP
  } else if (selection.left - ANCHOR_GAP - composerWidth >= VIEWPORT_GUTTER) {
    left = selection.left - ANCHOR_GAP - composerWidth
  } else {
    left = Math.min(maximumLeft, Math.max(VIEWPORT_GUTTER, selection.left))
  }

  const below = selection.bottom + ANCHOR_GAP
  const top = below + COMPOSER_HEIGHT_ESTIMATE <= viewport.height - VIEWPORT_GUTTER
    ? below
    : Math.max(VIEWPORT_GUTTER, selection.top - ANCHOR_GAP - COMPOSER_HEIGHT_ESTIMATE)

  return {
    left: left + viewport.scrollX,
    top: top + viewport.scrollY,
  }
}
