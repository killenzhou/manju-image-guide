export type VfxToolKind =
  | "influence"
  | "protect"
  | "flow"
  | "contour"
  | "emitter"
  | "text"
  | "title"
  | "ring"
  | "arc"
  | "spiral"
  | "blade-trail";
export type VfxStage = "anticipation" | "action" | "dissipation";
export type VfxLayer = "core" | "secondary" | "environment";
export type ReferenceRole =
  | "shape"
  | "motion"
  | "material"
  | "color-light"
  | "density"
  | "atmosphere"
  | "layout"
  | "typography";
export type VfxTargetKind = "person" | "weapon" | "prop" | "sky" | "ground" | "environment" | "custom";
export type VfxGeometryKind = "ellipse" | "arc" | "spiral" | "blade-trail";

export type Point = { x: number; y: number };
export type NormalizedRect = { x: number; y: number; width: number; height: number };

export type VfxGeometry = {
  kind: VfxGeometryKind;
  center?: Point;
  radiusX?: number;
  radiusY?: number;
  rotation?: number;
  startAngle?: number;
  endAngle?: number;
  clockwise?: boolean;
  turns?: number;
  widthStart?: number;
  widthEnd?: number;
  taper?: boolean;
};

export type VfxAnnotation = {
  id: string;
  kind: VfxToolKind;
  stage: VfxStage;
  layer: VfxLayer;
  points: Point[];
  label?: string;
  groupId?: string;
  targetId?: string;
  geometry?: VfxGeometry;
};

export type VfxTarget = {
  id: string;
  name: string;
  kind: VfxTargetKind;
  color: string;
  description?: string;
  bounds?: NormalizedRect;
  confirmed: boolean;
  source: "suggested" | "manual";
};

export type VfxEffectGroup = {
  id: string;
  name: string;
  color: string;
  targetIds: string[];
  effectDescription: string;
  palette: string;
  stage: VfxStage;
  layer: VfxLayer;
  allowLighting: boolean;
  allowHaze: boolean;
  allowBloom: boolean;
  allowReflection: boolean;
  visible: boolean;
  locked: boolean;
  solo: boolean;
  order: number;
  presetId?: string;
};

export type VfxTextLayer = {
  id: string;
  name: string;
  text: string;
  groupId?: string;
  targetId?: string;
  anchor: Point;
  orientation: "horizontal" | "vertical";
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  tracking: number;
  fill: string;
  gradientTo?: string;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  rotation: number;
  align: "left" | "center" | "right";
  zIndex: number;
  visible: boolean;
  locked: boolean;
};

export type VfxRenderPass = {
  id: string;
  name: string;
  kind: "combined-vfx" | "environment" | "core" | "secondary" | "packaging";
  effectGroupIds: string[];
  textLayerIds: string[];
  preservePreviousPasses: boolean;
};

export type VfxRenderPlan = {
  mode: "single" | "staged";
  reason: string;
  passes: VfxRenderPass[];
};

export type VfxSession = {
  schemaVersion: "1.0";
  id: string;
  workspaceRoot: string;
  sessionDir: string;
  sessionFile: string;
  sourcePath: string;
  originalSourcePath: string;
  sourceFileName: string;
  mimeType: string;
  effectHint: string;
  createdAt: string;
};

export type VfxReferenceInput = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  roles: ReferenceRole[];
  groupIds?: string[];
};

export type VfxBrief = {
  effectDescription: string;
  renderStage: VfxStage;
  stageIntent: Record<VfxStage, string>;
  palette: string;
  preserve: string;
  allowLighting: boolean;
  allowHaze: boolean;
  allowBloom: boolean;
  allowReflection: boolean;
};

export type VfxRequestManifestV1 = {
  schemaVersion: "vfx-director-request/v1";
  requestId: string;
  createdAt: string;
  source: { path: string; fileName: string; width: number; height: number };
  guides: { annotated: string; influence: string; protection: string };
  references: Array<{ index: number; path: string; fileName: string; roles: ReferenceRole[] }>;
  annotations: VfxAnnotation[];
  brief: VfxBrief;
  constraints: string[];
};

export type VfxRequestManifestV2 = {
  schemaVersion: "vfx-director-request/v2";
  requestId: string;
  createdAt: string;
  source: { path: string; fileName: string; width: number; height: number };
  guides: { annotated: string; influence: string; protection: string; textOverlay?: string };
  references: Array<{ index: number; path: string; fileName: string; roles: ReferenceRole[]; groupIds: string[] }>;
  targets: VfxTarget[];
  effectGroups: VfxEffectGroup[];
  annotations: VfxAnnotation[];
  textLayers: VfxTextLayer[];
  renderPlan: VfxRenderPlan;
  brief: VfxBrief;
  constraints: string[];
};

export type VfxRequestManifest = VfxRequestManifestV1 | VfxRequestManifestV2;
