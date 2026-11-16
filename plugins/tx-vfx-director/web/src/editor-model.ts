import type {
  Point,
  VfxAnnotation,
  VfxEffectGroup,
  VfxGeometry,
  VfxLayer,
  VfxStage,
  VfxTarget,
  VfxTargetKind,
  VfxTextLayer,
  VfxToolKind,
} from "../../server/src/types";

export const GROUP_COLORS = ["#58d6ff", "#ffb547", "#b986ff", "#ff6678", "#58e0a3", "#f6db63", "#67a5ff", "#ee82c9"];

export type GeometryControls = {
  rotation: number;
  startAngle: number;
  endAngle: number;
  turns: number;
  clockwise: boolean;
  widthStart: number;
  widthEnd: number;
  taper: boolean;
};

export const DEFAULT_GEOMETRY_CONTROLS: GeometryControls = {
  rotation: 0,
  startAngle: -25,
  endAngle: 225,
  turns: 2.4,
  clockwise: true,
  widthStart: 0.035,
  widthEnd: 0.006,
  taper: true,
};

export function createTarget(name: string, kind: VfxTargetKind = "custom", source: VfxTarget["source"] = "manual", index = 0): VfxTarget {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || `对象 ${index + 1}`,
    kind,
    color: GROUP_COLORS[index % GROUP_COLORS.length],
    confirmed: source === "manual",
    source,
  };
}

export function createEffectGroup(index: number, effectHint = "", targetIds: string[] = []): VfxEffectGroup {
  return {
    id: crypto.randomUUID(),
    name: index ? `特效组 ${index + 1}` : "主特效",
    color: GROUP_COLORS[index % GROUP_COLORS.length],
    targetIds,
    effectDescription: effectHint,
    palette: "服从原镜头光照与色温",
    stage: "action",
    layer: index ? "secondary" : "core",
    allowLighting: true,
    allowHaze: true,
    allowBloom: true,
    allowReflection: true,
    visible: true,
    locked: false,
    solo: false,
    order: index,
  };
}

export function createTextLayer(index: number): VfxTextLayer {
  return {
    id: crypto.randomUUID(),
    name: `文字 ${index + 1}`,
    text: "标题文字",
    anchor: { x: 0.5, y: 0.18 + index * 0.08 },
    orientation: "horizontal",
    fontFamily: "STKaiti, KaiTi, serif",
    fontSize: 80,
    fontWeight: 800,
    tracking: 8,
    fill: "#fff3be",
    gradientTo: "#f4a93b",
    stroke: "#36170b",
    strokeWidth: 3,
    shadowColor: "rgba(0,0,0,.72)",
    shadowBlur: 16,
    rotation: 0,
    align: "center",
    zIndex: index,
    visible: true,
    locked: false,
  };
}

function rotatePoint(point: Point, center: Point, radians: number): Point {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function ellipsePoint(center: Point, radiusX: number, radiusY: number, angle: number, rotation: number): Point {
  return rotatePoint({ x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY }, center, rotation);
}

export function geometryAnnotation(args: {
  id: string;
  tool: Extract<VfxToolKind, "ring" | "arc" | "spiral">;
  start: Point;
  current: Point;
  stage: VfxStage;
  layer: VfxLayer;
  groupId: string;
  targetId?: string;
  controls: GeometryControls;
}): VfxAnnotation {
  const radiusX = Math.max(0.01, Math.abs(args.current.x - args.start.x));
  const radiusY = Math.max(0.01, Math.abs(args.current.y - args.start.y));
  const rotation = args.controls.rotation * Math.PI / 180;
  const direction = args.controls.clockwise ? 1 : -1;
  let points: Point[] = [];
  let geometry: VfxGeometry;
  if (args.tool === "ring") {
    const steps = 72;
    points = Array.from({ length: steps + 1 }, (_, index) => ellipsePoint(args.start, radiusX, radiusY, direction * Math.PI * 2 * index / steps, rotation));
    geometry = { kind: "ellipse", center: args.start, radiusX, radiusY, rotation: args.controls.rotation, clockwise: args.controls.clockwise, widthStart: args.controls.widthStart, widthEnd: args.controls.widthEnd, taper: args.controls.taper };
  } else if (args.tool === "arc") {
    const startAngle = args.controls.startAngle * Math.PI / 180;
    const endAngle = args.controls.endAngle * Math.PI / 180;
    const steps = 56;
    points = Array.from({ length: steps + 1 }, (_, index) => {
      const angle = startAngle + direction * (endAngle - startAngle) * index / steps;
      return ellipsePoint(args.start, radiusX, radiusY, angle, rotation);
    });
    geometry = { kind: "arc", center: args.start, radiusX, radiusY, rotation: args.controls.rotation, startAngle: args.controls.startAngle, endAngle: args.controls.endAngle, clockwise: args.controls.clockwise, widthStart: args.controls.widthStart, widthEnd: args.controls.widthEnd, taper: args.controls.taper };
  } else {
    const turns = Math.max(0.5, args.controls.turns);
    const steps = Math.max(64, Math.round(turns * 44));
    points = Array.from({ length: steps + 1 }, (_, index) => {
      const progress = index / steps;
      const angle = direction * turns * Math.PI * 2 * progress;
      return ellipsePoint(args.start, radiusX * progress, radiusY * progress, angle, rotation);
    });
    geometry = { kind: "spiral", center: args.start, radiusX, radiusY, rotation: args.controls.rotation, clockwise: args.controls.clockwise, turns, widthStart: args.controls.widthStart, widthEnd: args.controls.widthEnd, taper: args.controls.taper };
  }
  return { id: args.id, kind: args.tool, stage: args.stage, layer: args.layer, groupId: args.groupId, targetId: args.targetId, points, geometry };
}

export function visibleGroups(groups: VfxEffectGroup[]): VfxEffectGroup[] {
  const solo = groups.filter((group) => group.solo && group.visible);
  return (solo.length ? solo : groups.filter((group) => group.visible)).sort((a, b) => a.order - b.order);
}

export function groupSummary(group: VfxEffectGroup, targets: VfxTarget[]): string {
  const names = group.targetIds.map((id) => targets.find((target) => target.id === id)?.name).filter(Boolean);
  return names.length ? names.join("、") : "全场景";
}
