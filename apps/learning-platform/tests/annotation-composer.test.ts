import { describe, expect, it } from 'vitest'

import { placeAnnotationComposer, placeSelectionToolbar } from '@/lib/annotation-composer'

describe('placeAnnotationComposer', () => {
  it('places the composer on the left when the selection is close to the right rail', () => {
    const position = placeAnnotationComposer(
      { left: 1260, right: 1320, top: 240, bottom: 264 },
      { width: 1440, height: 900, scrollX: 0, scrollY: 320 },
    )

    expect(position).toEqual({ left: 828, top: 596 })
    expect(position.left + 420).toBeLessThanOrEqual(1440 - 16)
  })

  it('keeps the composer inside a narrow viewport and flips it above a low selection', () => {
    const position = placeAnnotationComposer(
      { left: 10, right: 350, top: 620, bottom: 644 },
      { width: 375, height: 667, scrollX: 0, scrollY: 80 },
    )

    expect(position).toEqual({ left: 16, top: 308 })
    expect(position.left).toBeGreaterThanOrEqual(16)
  })
})

describe('placeSelectionToolbar', () => {
  it('centers the action toolbar above the selected text', () => {
    const position = placeSelectionToolbar(
      { left: 500, right: 700, top: 240, bottom: 264 },
      { width: 1440, height: 900, scrollX: 0, scrollY: 320 },
    )

    expect(position).toEqual({ left: 466, top: 506 })
  })

  it('places the toolbar below a selection near the top and keeps it inside the viewport', () => {
    const position = placeSelectionToolbar(
      { left: 2, right: 48, top: 20, bottom: 44 },
      { width: 320, height: 640, scrollX: 0, scrollY: 80 },
    )

    expect(position).toEqual({ left: 16, top: 136 })
  })
})
