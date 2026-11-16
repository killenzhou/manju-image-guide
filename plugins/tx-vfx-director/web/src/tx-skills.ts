import palmBoard from "../../assets/tx/palm-board.jpg?inline";
import iceBoard from "../../assets/tx/ice-board.jpg?inline";
import palmShape from "../../assets/tx/palm-shape.jpg?inline";
import iceBurst from "../../assets/tx/ice-burst.jpg?inline";
import iceGround from "../../assets/tx/ice-ground.jpg?inline";
import type { ReferenceRole, VfxStage, VfxToolKind } from "../../server/src/types";
import type { GeometryControls } from "./editor-model";

export type TxMoment = { id: string; name: string; stage: VfxStage; tool: VfxToolKind; label: string; guide: string; look: string; shape?: "ground"; geometry?: Partial<GeometryControls> };
export type TxForm = { id: string; name: string; evidence: string; identity: string; moments: TxMoment[] };
export type TxSkill = { id: string; version: number; character: string; name: string; keywords: string; board: string; source: string; palette: string; forms: TxForm[] };
const palmRelease: TxMoment = { id:"release", name:"出掌", stage:"action", tool:"flow", label:"掌力流向", guide:"从掌心向作用点拖一条短线，可再点一个发射点。", look:"让掌缘形态清楚，能量从掌心压向出手方向，内部保留青蓝流纹与少量紫色折光。" };
const palmHit: TxMoment = { id:"impact", name:"命中", stage:"action", tool:"ring", label:"冲击环", guide:"从接触点向外拖出一个环，环面服从镜头透视。", look:"沿引导在接触点形成薄而清楚的空气冲击环；近核亮，外圈减弱，保留背景和命中对象的轮廓。", geometry:{widthStart:.026,widthEnd:.005} };
const palmFade: TxMoment = { id:"falloff", name:"余波", stage:"dissipation", tool:"flow", label:"余波流向", guide:"沿冲击传播方向画短线。", look:"只保留偏冷的衰减波纹和少量残余流丝，不重新画出完整掌形。" };
export const TX_SKILLS: TxSkill[] = [
  {id:"palm",version:1,character:"陆隐",name:"波动掌",keywords:"陆隐 luyin 波动掌 基础 双倍 ep01 ep02 ep03 第1集 第2集 第3集",board:palmBoard,source:"战技总库 · 波动掌 / 波动掌设计板（候选）",palette:"青蓝为主、紫色折光，亮边集中于掌缘和冲击前沿",
    forms:[
      {id:"base",name:"基础",evidence:"战技总库：EP01、EP02；EP01 记载空气波纹拍击。",identity:"单次掌力，不增加第二个能量前沿。",moments:[palmRelease,palmHit,palmFade]},
      {id:"double",name:"双倍叠加",evidence:"战技总库：EP03 对格兰妮；两道错位前沿为试用视觉建议。",identity:"表现前后有间距的两次叠压，保持同一掌力来源；第二次更集中，避免把整幅图提亮。",moments:[palmRelease,palmHit,palmFade]},
    ]},
  {id:"ice",version:1,character:"白雪",name:"寒冰天赋",keywords:"白雪 baixue 寒冰天赋 冰 扩散 冰晶 放射",board:iceBoard,source:"战技总库 · 寒冰天赋 / 寒冰天赋设计板（候选）",palette:"冰蓝与冷白，暗部保留半透明晶体材质，局部克制发光",
    forms:[{id:"documented",name:"设计板表现",evidence:"设计板可见多方向放射、攻击示意、地面冰晶；以下是镜头时刻选项，非官方技能进阶。",identity:"细而有方向的冰蓝分支与半透明冰晶，不用均匀白雾盖住主体。",moments:[
      {id:"gather",name:"起势",stage:"anticipation",tool:"emitter",label:"寒气起点",guide:"点在人物身侧或施法位置。",look:"寒气在指定起点形成细枝与浅晶核，形态还未铺满空间。"},
      {id:"burst",name:"放射",stage:"action",tool:"flow",label:"冰线放射",guide:"从起点朝主扩散方向画流线，可重复画几条。",look:"细长冰蓝丝线从指定点放射，主方向清楚，次级分支渐细，不遮脸。"},
      {id:"ground",name:"地面蔓延",stage:"action",tool:"contour",label:"冰晶蔓延线",guide:"贴着地面透视画出冰晶的延展边界。",look:"冰晶沿地面展开，从起点向外减薄，贴合接触阴影与地面透视。",shape:"ground"},
    ]}]},
];
export function txPreset(skill: TxSkill, form: TxForm, moment: TxMoment, mode: "still" | "replace") {
  const subject = `${skill.character} · ${skill.name} · ${form.name} / ${moment.name}`;
  const body = `${subject}：${form.identity}${moment.look}`;
  const prompt = mode === "replace"
    ? `仅在标注区替换该技能原有效果，保留其他特效，不叠加旧轮廓。${body}保持原机位、人物身份、姿态、服装和非目标区域。`
    : `在标注位置加入该技能的静帧特效。${body}保持原机位、人物身份、姿态、服装和非目标区域。`;
  const dataUrl = skill.id === "palm" ? palmShape : moment.shape === "ground" ? iceGround : iceBurst;
  const roles: ReferenceRole[] = ["shape", "material"];
  return { id:`tx:${skill.id}:v${skill.version}:${form.id}:${moment.id}:${mode}`,name:`${skill.character} · ${skill.name} · ${form.name}`,prompt,palette:skill.palette,tool:moment.tool,stage:moment.stage,guide:moment.guide,geometry:moment.geometry,reference:{fileName:`${skill.id}-${moment.shape || "shape"}-candidate.jpg`,mimeType:"image/jpeg",dataUrl,roles} };
}
