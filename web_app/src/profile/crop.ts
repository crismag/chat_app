/*
 * The geometry behind cropping an avatar, kept away from the canvas.
 *
 * The component that uses this owns a square viewport, an <img> the person can
 * drag and zoom, and a canvas that finally draws the result. None of that is
 * testable in a DOM without a canvas implementation — but the part that is
 * actually easy to get wrong is the arithmetic, so the arithmetic lives here
 * as plain functions over numbers.
 *
 * The model: the picture is laid into the viewport the way `object-fit: cover`
 * would, then scaled by the zoom the person chose and shifted by however far
 * they dragged it. Offsets are in viewport pixels and measured from centre.
 */

/** The scale at which the shorter edge exactly fills the viewport. */
export function coverScale(imageWidth: number, imageHeight: number, viewport: number): number {
  const shortest = Math.min(imageWidth, imageHeight)
  return shortest > 0 ? viewport / shortest : 1
}

/**
 * A drag, limited to the picture it is dragging.
 *
 * Past this point the person would be pulling an edge into frame and cropping
 * empty space, so the square would end up part picture and part nothing.
 */
export function clampOffset(
  offset: number,
  imageSize: number,
  scale: number,
  viewport: number,
): number {
  const slack = Math.max(0, (imageSize * scale - viewport) / 2)
  return Math.min(slack, Math.max(-slack, offset))
}

export type CropRect = { sx: number; sy: number; size: number }

/**
 * Which square of the original picture the viewport is showing.
 *
 * Returned in the source image's own coordinates, which is what `drawImage`
 * wants, so the export is a straight crop of the full-resolution original
 * rather than a scaled-up copy of what was on screen.
 */
export function cropRect({
  imageWidth,
  imageHeight,
  zoom,
  offsetX,
  offsetY,
  viewport,
}: {
  imageWidth: number
  imageHeight: number
  zoom: number
  offsetX: number
  offsetY: number
  viewport: number
}): CropRect {
  const scale = coverScale(imageWidth, imageHeight, viewport) * zoom
  const dx = clampOffset(offsetX, imageWidth, scale, viewport)
  const dy = clampOffset(offsetY, imageHeight, scale, viewport)
  const size = viewport / scale
  return {
    sx: (imageWidth - size) / 2 - dx / scale,
    sy: (imageHeight - size) / 2 - dy / scale,
    size,
  }
}
