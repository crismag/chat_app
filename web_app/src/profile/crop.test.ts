import { expect, test } from 'vitest'

import { clampOffset, coverScale, cropRect } from './crop.ts'

const VIEWPORT = 320

test('a square picture at rest crops to the whole picture', () => {
  const rect = cropRect({
    imageWidth: 800,
    imageHeight: 800,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    viewport: VIEWPORT,
  })

  expect(rect).toEqual({ sx: 0, sy: 0, size: 800 })
})

test('a wide picture at rest takes the middle, not the left edge', () => {
  const rect = cropRect({
    imageWidth: 1600,
    imageHeight: 800,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    viewport: VIEWPORT,
  })

  expect(rect.size).toBe(800)
  expect(rect.sx).toBe(400)
  expect(rect.sy).toBe(0)
})

test('zooming in takes a smaller square, still centred', () => {
  const rect = cropRect({
    imageWidth: 800,
    imageHeight: 800,
    zoom: 2,
    offsetX: 0,
    offsetY: 0,
    viewport: VIEWPORT,
  })

  expect(rect.size).toBe(400)
  expect(rect.sx).toBe(200)
  expect(rect.sy).toBe(200)
})

test('dragging right shows what was to the left of the frame', () => {
  const rect = cropRect({
    imageWidth: 1600,
    imageHeight: 800,
    zoom: 1,
    offsetX: 80,
    offsetY: 0,
    viewport: VIEWPORT,
  })

  /* 80 viewport pixels at a 0.4 scale is 200 source pixels. */
  expect(rect.sx).toBe(200)
})

test('a drag cannot pull an edge into frame', () => {
  const scale = coverScale(1600, 800, VIEWPORT)
  const far = clampOffset(100_000, 1600, scale, VIEWPORT)
  const rect = cropRect({
    imageWidth: 1600,
    imageHeight: 800,
    zoom: 1,
    offsetX: 100_000,
    offsetY: 0,
    viewport: VIEWPORT,
  })

  /* Clamped to the slack, which lands the crop exactly on the left edge. */
  expect(far).toBe(160)
  expect(rect.sx).toBe(0)
  expect(rect.sx + rect.size).toBeLessThanOrEqual(1600)
})

test('a picture with no height does not divide by zero', () => {
  expect(coverScale(0, 0, VIEWPORT)).toBe(1)
})

test('an unzoomable axis has no slack to drag along', () => {
  expect(clampOffset(50, 800, coverScale(800, 800, VIEWPORT), VIEWPORT)).toBe(0)
})
