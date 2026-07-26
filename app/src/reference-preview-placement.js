export function resolveReferencePreviewPlacement({
  targetTop,
  targetBottom,
  desiredHeight,
  viewportHeight,
  margin = 10,
  offset = 8,
}) {
  const availableAbove = Math.max(0, targetTop - margin - offset);
  const availableBelow = Math.max(0, viewportHeight - margin - targetBottom - offset);
  const height = Math.max(0, desiredHeight);
  const side =
    height <= availableAbove
      ? "above"
      : height <= availableBelow
        ? "below"
        : availableAbove >= availableBelow
          ? "above"
          : "below";

  return {
    availableAbove,
    availableBelow,
    maxHeight: side === "above" ? availableAbove : availableBelow,
    side,
  };
}
