import { useMemo, useState } from "react";
import type { ReferenceRole, VfxStage, VfxToolKind } from "../../server/src/types";
import { TX_SKILLS, txPreset } from "./tx-skills";
import type { GeometryControls } from "./editor-model";

export type TxRecipe = {
  id: string; name: string; prompt: string; palette: string; tool: VfxToolKind; stage: VfxStage; guide: string;
  geometry?: Partial<GeometryControls>;
  reference?: {fileName: string; mimeType: string; dataUrl: string; roles: ReferenceRole[]};
};
export const RECIPE_KEY = "vfx-director-tx-recipes/v1";
const tools = ["influence","protect","flow","contour","emitter","ring","arc","spiral","blade-trail"];
export function readRecipes(): TxRecipe[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECIPE_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is TxRecipe => item && ["id","name","prompt","palette","guide"].every(key => typeof item[key] === "string")
      && ["anticipation","action","dissipation"].includes(item.stage) && tools.includes(item.tool)
      && (!item.reference || (typeof item.reference.dataUrl === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(item.reference.dataUrl) && Array.isArray(item.reference.roles)))).slice(0, 15);
  } catch { return []; }
}
export function TxSkillPanel({ onApply, recipes, onDelete }: { onApply: (recipe: TxRecipe) => void; recipes: TxRecipe[]; onDelete: (id:string)=>void }) {
  const [query, setQuery] = useState("");
  const [skillId, setSkill] = useState(TX_SKILLS[0].id);
  const [formId, setForm] = useState("");
  const [momentId, setMoment] = useState("");
  const [mode, setMode] = useState<"still"|"replace">("still");
  const [copyStatus, setCopyStatus] = useState("");
  const [savedId, setSavedId] = useState("");
  const matches = useMemo(() => TX_SKILLS.filter(skill => query.trim().toLowerCase().split(/\s+/).every(term => skill.keywords.includes(term))), [query]);
  const skill = matches.find(item => item.id === skillId) || matches[0];
  const form = skill?.forms.find(item => item.id === formId) || skill?.forms[0];
  const moment = form?.moments.find(item => item.id === momentId) || form?.moments[0];
  const recipe = skill && form && moment ? txPreset(skill, form, moment, mode) : null;
  const applySelection = (s: typeof skill | undefined, f: typeof form | undefined, m: typeof moment | undefined, usage: typeof mode) => {
    if (s && f && m) onApply(txPreset(s, f, m, usage));
  };
  const saved = recipes.find(item => item.id === savedId) || recipes[0];
  return <>
    <section className="tx-section">
      <div className="tx-eyebrow">TX / 技能参考</div>
      <h2>踏星技能库</h2><p className="tx-muted">点技能即生效，笔迹可先画也可后画。</p>
      <input aria-label="搜索踏星技能" placeholder="搜角色、技能、集数" value={query} onChange={e=>setQuery(e.target.value)} />
      <div className="tx-skill-list">{matches.map(item => <button type="button" key={item.id} aria-pressed={skill?.id===item.id} onClick={()=>{setSkill(item.id);setForm("");setMoment("");setCopyStatus("");applySelection(item,item.forms[0],item.forms[0]?.moments[0],mode);}}><span>{item.character}</span><strong>{item.name}</strong></button>)}</div>
      {!matches.length && <p className="tx-muted">暂无匹配的试用技能。</p>}
      {skill && form && moment && recipe && <>
        <label>技能形态<select aria-label="技能形态" value={form.id} onChange={e=>{const next=skill.forms.find(item=>item.id===e.target.value);setForm(e.target.value);setMoment("");setCopyStatus("");applySelection(skill,next,next?.moments[0],mode);}}>{skill.forms.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>镜头时刻<select aria-label="镜头时刻" value={moment.id} onChange={e=>{setMoment(e.target.value);setCopyStatus("");applySelection(skill,form,form.moments.find(item=>item.id===e.target.value),mode);}}>{form.moments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>用途<select aria-label="提示词用途" value={mode} onChange={e=>{const next=e.target.value as typeof mode;setMode(next);setCopyStatus("");applySelection(skill,form,moment,next);}}><option value="still">加入特效</option><option value="replace">局部替换</option></select></label>
        <div className="tx-brush-card"><img src={recipe.reference.dataUrl} alt={skill.name+"候选局部参考"}/><div><strong>{moment.label}</strong><p>{moment.guide}</p></div></div>
        <button type="button" className="tx-primary" onClick={()=>onApply(recipe)}>应用当前预设</button>
        <details className="tx-details"><summary>提示词与参考来源</summary>
          <p>{skill.source} · v{skill.version}</p><p>{form.evidence}</p>
          <a href={skill.board} download={skill.id+"-design-board.jpg"}>下载候选设计板</a>
          <textarea readOnly aria-label="技能提示词" value={recipe.prompt}/>
          <button type="button" onClick={()=>void navigator.clipboard?.writeText(recipe.prompt).then(()=>setCopyStatus("已复制"),()=>setCopyStatus("请选中文本手动复制"))}>复制提示词</button>
          <span role="status">{copyStatus}</span>
        </details>
      </>}
    </section>
    {saved && <section className="tx-section"><h2>我的特效</h2><select aria-label="选择已保存特效" value={saved.id} onChange={e=>setSavedId(e.target.value)}>{recipes.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><div className="tx-inline"><button type="button" onClick={()=>onApply(saved)}>应用已保存特效</button><button type="button" onClick={()=>onDelete(saved.id)}>删除预设</button></div></section>}
  </>;
}

