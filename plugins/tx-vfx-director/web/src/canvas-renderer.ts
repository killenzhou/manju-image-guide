import type { Point, VfxAnnotation, VfxEffectGroup, VfxTarget, VfxTextLayer } from "../../server/src/types";

export type Rect = { x: number; y: number; width: number; height: number };
export type MapMode = "influence" | "protect";

export function computeImageRect(containerWidth: number, containerHeight: number, imageWidth: number, imageHeight: number): Rect {
  if (!containerWidth || !containerHeight || !imageWidth || !imageHeight) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height };
}

function applyPath(context: CanvasRenderingContext2D, points: Point[], width: number, height: number) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x * width, points[0].y * height);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x * width, points[index].y * height);
}

function arrowHead(context: CanvasRenderingContext2D, points: Point[], width: number, height: number, size: number) {
  if (points.length < 2) return;
  const end = points.at(-1)!;
  const previous = points.at(-2)!;
  const angle = Math.atan2((end.y - previous.y) * height, (end.x - previous.x) * width);
  const x = end.x * width;
  const y = end.y * height;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - Math.cos(angle - Math.PI / 6) * size, y - Math.sin(angle - Math.PI / 6) * size);
  context.lineTo(x - Math.cos(angle + Math.PI / 6) * size, y - Math.sin(angle + Math.PI / 6) * size);
  context.closePath();
  context.fill();
}

function variableStroke(context: CanvasRenderingContext2D, annotation: VfxAnnotation, width: number, height: number, base: number) {
  const points = annotation.points;
  const start = annotation.geometry?.widthStart ?? 0.04;
  const end = annotation.geometry?.widthEnd ?? 0.006;
  if (points.length < 2) return;
  for (let index = 1; index < points.length; index += 1) {
    const progress = index / (points.length - 1);
    context.lineWidth = Math.max(2, base * (start + (end - start) * progress));
    context.beginPath();
    context.moveTo(points[index - 1].x * width, points[index - 1].y * height);
    context.lineTo(points[index].x * width, points[index].y * height);
    context.stroke();
  }
}

export function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: VfxAnnotation,
  width: number,
  height: number,
  emitterNumber: number,
  color: string,
  mapMode?: MapMode,
) {
  if (!annotation.points.length) return;
  if (mapMode && annotation.kind !== mapMode) return;
  const base = Math.min(width, height);
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  if (mapMode) {
    context.strokeStyle = "#ffffff";
    context.fillStyle = "#ffffff";
    context.globalAlpha = 1;
    context.lineWidth = base * 0.085;
    applyPath(context, annotation.points, width, height);
    context.stroke();
    context.restore();
    return;
  }
  if (annotation.kind === "influence" || annotation.kind === "protect") {
    const annotationColor = annotation.kind === "protect" ? "#ff5a67" : color;
    context.strokeStyle = annotationColor;
    context.globalAlpha = annotation.kind === "influence" ? 0.24 : 0.2;
    context.lineWidth = base * 0.085;
    applyPath(context, annotation.points, width, height);
    context.stroke();
    context.globalAlpha = 0.96;
    context.lineWidth = Math.max(2, base * 0.004);
    context.setLineDash([base * 0.012, base * 0.008]);
    applyPath(context, annotation.points, width, height);
    context.stroke();
  } else if (["flow", "ring", "arc", "spiral"].includes(annotation.kind)) {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = annotation.kind === "flow" ? 0 : base * 0.012;
    context.lineWidth = Math.max(3, base * (annotation.geometry?.widthStart || 0.006));
    applyPath(context, annotation.points, width, height);
    context.stroke();
    if (annotation.kind !== "ring") arrowHead(context, annotation.points, width, height, base * 0.026);
  } else if (annotation.kind === "blade-trail") {
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = base * 0.014;
    variableStroke(context, annotation, width, height, base);
    context.globalAlpha = 0.55;
    context.strokeStyle = "#ffffff";
    variableStroke(context, { ...annotation, geometry: { ...annotation.geometry, kind: "blade-trail", widthStart: (annotation.geometry?.widthStart || 0.04) * 0.24, widthEnd: 0.002 } }, width, height, base);
  } else if (annotation.kind === "contour") {
    context.strokeStyle = color;
    context.lineWidth = Math.max(2, base * 0.004);
    context.shadowColor = "rgba(0,0,0,.8)";
    context.shadowBlur = base * 0.006;
    applyPath(context, annotation.points, width, height);
    context.stroke();
  } else if (annotation.kind === "emitter") {
    const point = annotation.points[0];
    const x = point.x * width;
    const y = point.y * height;
    const radius = base * 0.024;
    context.fillStyle = "rgba(17,19,24,.82)";
    context.strokeStyle = color;
    context.lineWidth = Math.max(2, base * 0.003);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = color;
    context.font = `700 ${Math.max(12, base * 0.026)}px system-ui`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(emitterNumber), x, y + 1);
  } else if (annotation.kind === "text") {
    const point = annotation.points[0];
    const label = annotation.label || "特效说明";
    const fontSize = Math.max(12, base * 0.024);
    context.font = `600 ${fontSize}px system-ui`;
    const padding = fontSize * 0.62;
    const metrics = context.measureText(label);
    const x = point.x * width;
    const y = point.y * height;
    context.fillStyle = "rgba(17,19,24,.86)";
    context.fillRect(x, y - fontSize - padding, metrics.width + padding * 2, fontSize + padding * 2);
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, base * 0.002);
    context.strokeRect(x, y - fontSize - padding, metrics.width + padding * 2, fontSize + padding * 2);
    context.fillStyle = "#f4f6f8";
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText(label, x + padding, y + padding * 0.15);
  }
  context.restore();
}

function measureTrackedLine(context: CanvasRenderingContext2D, line: string, tracking: number): number {
  return [...line].reduce((sum, character, index) => sum + context.measureText(character).width + (index ? tracking : 0), 0);
}

function drawTrackedLine(context: CanvasRenderingContext2D, line: string, x: number, y: number, tracking: number, strokeWidth: number) {
  let cursor = x;
  [...line].forEach((character, index) => {
    if (index) cursor += tracking;
    if (strokeWidth > 0) context.strokeText(character, cursor, y);
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width;
  });
}

export function drawTextLayer(context: CanvasRenderingContext2D, layer: VfxTextLayer, width: number, height: number, sourceWidth: number) {
  if (!layer.visible || !layer.text) return;
  const scale = width / sourceWidth;
  const fontSize = Math.max(8, layer.fontSize * scale);
  const tracking = layer.tracking * scale;
  const lines = layer.text.split("\n");
  const x = layer.anchor.x * width;
  const y = layer.anchor.y * height;
  context.save();
  context.translate(x, y);
  context.rotate(layer.rotation * Math.PI / 180);
  context.font = `${layer.fontWeight} ${fontSize}px ${layer.fontFamily}`;
  context.textBaseline = "top";
  context.lineJoin = "round";
  context.strokeStyle = layer.stroke;
  context.lineWidth = layer.strokeWidth * scale * 2;
  context.shadowColor = layer.shadowColor;
  context.shadowBlur = layer.shadowBlur * scale;
  const gradient = layer.gradientTo ? context.createLinearGradient(0, 0, 0, fontSize * Math.max(1, lines.length)) : undefined;
  if (gradient) {
    gradient.addColorStop(0, layer.fill);
    gradient.addColorStop(1, layer.gradientTo!);
    context.fillStyle = gradient;
  } else context.fillStyle = layer.fill;
  if (layer.orientation === "vertical") {
    const columns = lines;
    const columnWidth = fontSize + tracking;
    const totalWidth = columns.length * columnWidth;
    let originX = layer.align === "center" ? -totalWidth / 2 : layer.align === "right" ? -totalWidth : 0;
    columns.forEach((column) => {
      [...column].forEach((character, index) => {
        const cy = index * (fontSize + tracking);
        if (layer.strokeWidth > 0) context.strokeText(character, originX, cy);
        context.fillText(character, originX, cy);
      });
      originX += columnWidth;
    });
  } else {
    lines.forEach((line, index) => {
      const measured = measureTrackedLine(context, line, tracking);
      const originX = layer.align === "center" ? -measured / 2 : layer.align === "right" ? -measured : 0;
      drawTrackedLine(context, line, originX, index * (fontSize * 1.22 + tracking), tracking, layer.strokeWidth);
    });
  }
  context.restore();
}

export function drawScene(args: {
  context: CanvasRenderingContext2D;
  image: HTMLImageElement;
  rect: Rect;
  annotations: VfxAnnotation[];
  groups: VfxEffectGroup[];
  targets: VfxTarget[];
  textLayers: VfxTextLayer[];
  activeTargetId?: string;
  draft?: VfxAnnotation | null;
}) {
  const { context, image, rect, groups, targets, textLayers } = args;
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.fillStyle = "#090b0f";
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  context.save();
  context.translate(rect.x, rect.y);
  context.beginPath();
  context.rect(0, 0, rect.width, rect.height);
  context.clip();
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  let emitterNumber = 0;
  [...args.annotations, ...(args.draft ? [args.draft] : [])].forEach((annotation) => {
    const group = annotation.groupId ? groupMap.get(annotation.groupId) : groups[0];
    if (annotation.kind === "emitter") emitterNumber += 1;
    drawAnnotation(context, annotation, rect.width, rect.height, emitterNumber, group?.color || "#ffb547");
  });
  const activeTarget = targets.find((target) => target.id === args.activeTargetId);
  if (activeTarget?.bounds) {
    context.strokeStyle = activeTarget.color;
    context.lineWidth = 2;
    context.setLineDash([8, 6]);
    context.strokeRect(activeTarget.bounds.x * rect.width, activeTarget.bounds.y * rect.height, activeTarget.bounds.width * rect.width, activeTarget.bounds.height * rect.height);
  }
  textLayers.slice().sort((a, b) => a.zIndex - b.zIndex).forEach((layer) => drawTextLayer(context, layer, rect.width, rect.height, image.naturalWidth));
  context.restore();
}

export function renderTextOverlay(textLayers: VfxTextLayer[], width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建文字包装层");
  textLayers.slice().sort((a, b) => a.zIndex - b.zIndex).forEach((layer) => drawTextLayer(context, layer, width, height, width));
  return canvas.toDataURL("image/png");
}
