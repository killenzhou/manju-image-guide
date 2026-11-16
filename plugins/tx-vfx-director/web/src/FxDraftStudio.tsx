import { useCallback, useEffect, useRef, useState } from "react";
import { duplicateFx, FX_BRUSHES, FX_MAX_KNOTS, FX_MAX_POINTS, FX_MAX_STROKES, moveFxStroke, renderFxDraft, type FxBrush, type FxDraft, type FxPoint, type FxStroke } from "./fx-draft-model";
import { FxLookShelf } from "./FxLookShelf";
import { getFxLook, type FxLook } from "./fx-depth-presets";
import { cubicFx, DEFAULT_VANISH, FLAT_DEPTH, makeFxCurve, makeFxProjection, splitFxCurve, UNIT_TRANSFORM, type FxDepth, type FxTransform, type XY } from "./fx-depth-geometry";
import "./fx-draft.css";

type Mode=FxBrush|"move"|"curve"|"vanish";
type CurveGrip={index:number;handle:"anchor"|"in"|"out";f:number};
type Working={pointer:number; stroke:FxStroke; initial?:{start:FxPoint;original:FxStroke}; grip?:CurveGrip};
type Props={image:HTMLImageElement; fileName:string; draft:FxDraft; onChange:(d:FxDraft)=>void; onGenerate:()=>void; generation:{busy:boolean;text:string;error?:boolean}; onSave:()=>void; onClose:()=>void; onOpen:(event:React.ChangeEvent<HTMLInputElement>)=>void};

const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const names=Object.fromEntries(FX_BRUSHES.map(b=>[b.id,b.label])) as Record<FxBrush,string>;
const shapes:Record<Mode,string>={ribbon:"M2 16C7 6 14 22 22 4M3 18C11 11 17 19 22 4",ring:"M2 12a10 5 0 1 0 20 0 10 5 0 1 0-20 0",crystal:"M3 18l7-9 2 2 6-8 3 3-5 9-3-1-7 7z",occlude:"M4 13l8-9 8 7-8 9H9zM9 20h11",curve:"M3 19C7 0 18 24 21 5M3 19h3m12-14h3",vanish:"M2 4l20 16M2 20L22 4M12 2v20",move:"M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"};
const BrushIcon=({kind}:{kind:Mode})=><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d={shapes[kind]}/></svg>;

export function FxDraftStudio({image,fileName,draft,onChange,onGenerate,generation,onSave,onClose,onOpen}:Props) {
  const [mode,setMode]=useState<Mode>("ribbon");
  const [selected,setSelected]=useState("");
  const [lookId,setLookId]=useState("");
  const [shelfOpen,setShelfOpen]=useState(false);
  const [knot,setKnot]=useState(0);
  const [color,setColor]=useState<string>(FX_BRUSHES[0].color);
  const [width,setWidth]=useState<number>(FX_BRUSHES[0].width);
  const [intensity,setIntensity]=useState(90);
  const [back,setBack]=useState<"shot"|"checker"|"black"|"white">("shot");
  const [status,setStatus]=useState("选笔刷，在镜头上拖动。笔迹就是实际特效。");
  const [working,setWorking]=useState<Working|null>(null);
  const workingRef=useRef<Working|null>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const stage=useRef<HTMLDivElement>(null);
  const [fit,setFit]=useState({width:1,height:1});
  const [undo,setUndo]=useState<FxDraft[]>([]);
  const [redo,setRedo]=useState<FxDraft[]>([]);
  const [exporting,setExporting]=useState(false);
  const focus=draft.strokes.find(s=>s.id===selected);
  const w=image.naturalWidth,h=image.naturalHeight;
  const info=FX_BRUSHES.find(b=>b.id===mode);
  const look=getFxLook(lookId),vanish=draft.vanish??DEFAULT_VANISH;
  const depth=focus?.depth??FLAT_DEPTH,transform=focus?.transform??UNIT_TRANSFORM;
  const labelFor=(s:FxStroke)=>getFxLook(s.preset)?.name??names[s.kind];
  const fAt=(i:number,n:number)=>i/Math.max(n-1,1);
  function gripAt(s:FxStroke,grip:CurveGrip):XY {
    const anchor=s.curve![grip.index], projection=makeFxProjection(s,vanish,w/h);
    return projection.point(grip.handle==="anchor"?anchor:anchor[grip.handle],grip.f);
  }

  const updateWorking=(next:Working|null)=>{workingRef.current=next;setWorking(next);};
  const commit=useCallback((strokes:FxStroke[],nextVanish=draft.vanish)=>{
    setUndo(list=>[...list.slice(-39),draft]);setRedo([]);onChange({...draft,strokes,vanish:nextVanish});
  },[draft,onChange]);
  const undoAction=useCallback(()=>{
    if(!undo.length || workingRef.current) return;
    setRedo(list=>[...list,draft]);onChange(undo.at(-1)!);setUndo(undo.slice(0,-1));
    setStatus("已撤销。");
  },[draft,onChange,undo]);
  const redoAction=useCallback(()=>{
    if(!redo.length || workingRef.current) return;
    setUndo(list=>[...list,draft]);onChange(redo.at(-1)!);setRedo(redo.slice(0,-1));
    setStatus("已重做。");
  },[draft,onChange,redo]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement|null)?.closest("input, textarea, select") || !(e.ctrlKey||e.metaKey)) return;
      if(e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redoAction():undoAction();}
      if(e.key.toLowerCase()==="y"){e.preventDefault();redoAction();}
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[redoAction,undoAction]);
  useEffect(()=>{
    const el=stage.current;
    if(!el) return;
    const layout=()=>{
      const r=el.getBoundingClientRect(),scale=Math.max(.001,Math.min((r.width-28)/w,(r.height-28)/h));
      setFit({width:w*scale,height:h*scale});
    };
    layout();const obs=new ResizeObserver(layout);obs.observe(el);
    return ()=>obs.disconnect();
  },[w,h]);
  useEffect(()=>{
    const el=canvas.current;
    if(!el) return;
    const targetScale=Math.min(1,1800/Math.max(w,h), Math.max(fit.width/w,.01)*Math.min(devicePixelRatio||1,2));
    const x=Math.max(1,Math.round(w*targetScale)),y=Math.max(1,Math.round(h*targetScale));
    if(el.width!==x || el.height!==y){el.width=x;el.height=y;}
    const ctx=el.getContext("2d");if(!ctx) return;
    const marks=working ? (working.initial||working.grip) ? draft.strokes.map(s=>s.id===working.stroke.id?working.stroke:s) : [...draft.strokes,working.stroke] : draft.strokes;
    renderFxDraft(ctx,x,y,marks,"fx",vanish);
    const edit=mode==="curve"?(working?.grip?working.stroke:focus):undefined;
    if(edit?.curve?.length){
      const p=makeFxProjection(edit,vanish,w/h),curve=edit.curve;
      const place=(i:number,part:CurveGrip["handle"])=>{const k=curve[i],q=p.point(part==="anchor"?k:k[part],fAt(i,curve.length));return{x:q.x*x,y:q.y*y};};
      const dot=(q:XY,r:number,c:string,square=false)=>{
        ctx.fillStyle=c;ctx.strokeStyle="#10202b";ctx.lineWidth=1.2;
        if(square){ctx.fillRect(q.x-r,q.y-r,r*2,r*2);ctx.strokeRect(q.x-r,q.y-r,r*2,r*2);}
        else{ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();}
      };
      ctx.save();ctx.strokeStyle="#78f2df";ctx.lineWidth=1.35;ctx.setLineDash([4,3]);ctx.beginPath();
      p.points.forEach((q,i)=>i?ctx.lineTo(q.x*x,q.y*y):ctx.moveTo(q.x*x,q.y*y));ctx.stroke();ctx.setLineDash([]);
      curve.forEach((_,i)=>{
        const q=place(i,"anchor");
        if(i===knot){
          for(const part of ["in","out"] as const){
            if(part==="in"&&i===0||part==="out"&&i===curve.length-1) continue;
            const h=place(i,part);ctx.strokeStyle="#b9ffd2";ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(h.x,h.y);ctx.stroke();dot(h,4,"#b9ffd2");
          }
        }
        dot(q,i===knot?5.5:4,i===knot?"#ffce79":"#68e6ee",true);
      });ctx.restore();
    }
    if(mode==="vanish"){
      ctx.save();ctx.strokeStyle="#f1ca80";ctx.lineWidth=1;ctx.setLineDash([5,4]);ctx.beginPath();
      ctx.moveTo(vanish.x*x,0);ctx.lineTo(vanish.x*x,y);ctx.moveTo(0,vanish.y*y);ctx.lineTo(x,vanish.y*y);ctx.stroke();ctx.restore();
    }
    const mask=working?.stroke.kind==="occlude"?working.stroke:focus?.kind==="occlude"&&focus.visible?focus:undefined;
    if(mask && back==="shot") {
      ctx.save();ctx.strokeStyle="#ff8eae";ctx.lineWidth=1.6;ctx.setLineDash([5,4]);ctx.beginPath();
      const [p,...tail]=mask.points;ctx.moveTo(p.x*x,p.y*y);
      if(!tail.length){ctx.lineTo(p.x*x+4,p.y*y);ctx.moveTo(p.x*x,p.y*y-4);ctx.lineTo(p.x*x,p.y*y+4);}
      else tail.forEach(k=>ctx.lineTo(k.x*x,k.y*y));ctx.stroke();ctx.restore();
    }
  },[w,h,fit,draft.strokes,working,focus,back,mode,knot,vanish]);

  function choose(kind:Mode) {
    setMode(kind);if(kind==="move"||kind==="curve"||kind==="vanish") return;
    setLookId("");
    const b=FX_BRUSHES.find(i=>i.id===kind)!;
    setColor(b.color);setWidth(b.width);setIntensity(kind==="occlude"?100:90);
    setStatus(b.hint);
  }
  function pickLook(recipe:FxLook){
    setLookId(recipe.id);setMode(recipe.stroke);setColor(recipe.tone);setWidth(recipe.width);setIntensity(90);
    setStatus("已选 "+recipe.name+"。可直接画，也可以替换选中的特效层。");
  }
  function replaceLook(){
    if(!focus||!look||focus.kind==="occlude")return;
    change({preset:look.id,kind:look.stroke,color:look.tone,width:look.width});
    setStatus("已替换为 "+look.name+"；保留原曲线、位置、深度和变换。");
  }
  function editCurve(){
    if(!focus||focus.kind==="ring")return;
    if(!focus.curve)change({curve:makeFxCurve(focus.points)});
    setKnot(0);setMode("curve");setStatus("拖动锚点或手柄。双击曲线加点，右侧按钮可减点。");
  }
  function setDepth(patch:Partial<FxDepth>){change({depth:{...depth,...patch}});}
  function setTransform(patch:Partial<FxTransform>){change({transform:{...transform,...patch}});}
  const point=(e:React.PointerEvent<HTMLCanvasElement>):FxPoint=>{
    const r=e.currentTarget.getBoundingClientRect();
    return {x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height),p:e.pointerType==="pen"?clamp(e.pressure||.5):.58};
  };
  function start(e:React.PointerEvent<HTMLCanvasElement>){
    if(e.button!==0 || workingRef.current || exporting) return;
    const p=point(e);
    if(mode==="vanish"){
      commit(draft.strokes,{x:p.x,y:p.y});setMode(focus?"move":"ribbon");setStatus("已设置消失点。调远端 Z 可看见收束方向。");return;
    }
    if(mode==="curve"){
      if(!focus?.curve?.length)return;
      const r=e.currentTarget.getBoundingClientRect();
      let best:CurveGrip|undefined,bestD=14;
      focus.curve.forEach((_,i)=>{
        const parts:CurveGrip["handle"][]=["anchor"];
        if(i===knot){if(i>0)parts.push("in");if(i<focus.curve!.length-1)parts.push("out");}
        parts.forEach(handle=>{
          const grip={index:i,handle,f:fAt(i,focus.curve!.length)},q=gripAt(focus,grip);
          const d=Math.hypot((q.x-p.x)*r.width,(q.y-p.y)*r.height);
          if(d<bestD){best=grip;bestD=d;}
        });
      });
      if(!best)return;
      setKnot(best.index);updateWorking({pointer:e.pointerId,stroke:focus,grip:best});
    } else if(mode==="move"){
      if(!focus || !focus.visible){setStatus("先从右侧选择一层可见特效，再拖动。");return;}
      updateWorking({pointer:e.pointerId,stroke:focus,initial:{start:p,original:focus}});
    } else {
      if(draft.strokes.length>=FX_MAX_STROKES){setStatus("已达到单镜头笔迹上限，请先移除不用的笔迹。");return;}
      updateWorking({pointer:e.pointerId,stroke:{id:crypto.randomUUID(),kind:mode,points:[p],color,width,intensity,angle:0,visible:true,...(look?{preset:look.id}:{})}});
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:React.PointerEvent<HTMLCanvasElement>,final=false) {
    const live=workingRef.current;
    if(!live||live.pointer!==e.pointerId) return;
    const p=point(e),pts=live.stroke.points,last=pts.at(-1)!;
    if(live.grip && focus?.curve){
      const g=live.grip,at=makeFxProjection(focus,vanish,w/h).inverse(p,g.f),old=focus.curve[g.index];
      const b=(q:XY)=>({x:clamp(q.x,-1,2),y:clamp(q.y,-1,2)});
      const curve=focus.curve.map((k,i)=>{
        if(i!==g.index)return k;
        if(g.handle!=="anchor")return {...k,[g.handle]:b(at)};
        const x=clamp(at.x),y=clamp(at.y),dx=x-old.x,dy=y-old.y;
        return {...k,x,y,in:b({x:k.in.x+dx,y:k.in.y+dy}),out:b({x:k.out.x+dx,y:k.out.y+dy})};
      });
      updateWorking({...live,stroke:{...live.stroke,curve}});
    }else if(live.initial){
      updateWorking({...live,stroke:moveFxStroke(live.initial.original,p.x-live.initial.start.x,p.y-live.initial.start.y)});
    }else if(live.stroke.kind==="ring"){
      updateWorking({...live,stroke:{...live.stroke,points:[pts[0],p]}});
    }else if(pts.length<FX_MAX_POINTS && (final ? Math.hypot(last.x-p.x,last.y-p.y)>.001 : Math.hypot(last.x-p.x,last.y-p.y)>.0025)){
      updateWorking({...live,stroke:{...live.stroke,points:[...pts,p]}});
    }
  }
  function finish(e:React.PointerEvent<HTMLCanvasElement>,cancel=false) {
    if(workingRef.current?.pointer!==e.pointerId) return;
    if(!cancel) move(e,true);
    const live=workingRef.current!;
    updateWorking(null);
    if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if(cancel) return;
    setSelected(live.stroke.id);
    if(live.initial && live.stroke.points.every((p,i)=>p.x===live.initial!.original.points[i].x && p.y===live.initial!.original.points[i].y)) return;
    if(live.grip&&JSON.stringify(live.stroke.curve)===JSON.stringify(focus?.curve))return;
    commit(live.initial||live.grip?draft.strokes.map(s=>s.id===live.stroke.id?live.stroke:s):[...draft.strokes,live.stroke]);
    setStatus(live.grip?"曲线已修改。":live.initial?"整层已移动。":live.stroke.kind==="occlude"?"已创建可编辑遮挡，原图未改动。":"已绘制 "+labelFor(live.stroke)+"。");
  }
  function addKnot(e:React.MouseEvent<HTMLCanvasElement>){
    if(mode!=="curve"||!focus?.curve||focus.curve.length>=FX_MAX_KNOTS||focus.curve.length<2)return;
    const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
    const curve=focus.curve,p=makeFxProjection(focus,vanish,w/h);
    let best={i:0,t:.5,d:Infinity};
    for(let i=0;i<curve.length-1;i++)for(let j=2;j<=28;j++){
      const t=j/30,q=p.point(cubicFx(curve[i],curve[i+1],t),fAt(i+t,curve.length));
      const d=Math.hypot((q.x-x)*r.width,(q.y-y)*r.height);
      if(d<best.d)best={i,t,d};
    }
    if(best.d>20){setStatus("在现有曲线上双击可插入点。");return;}
    change({curve:splitFxCurve(curve,best.i,best.t)});setKnot(best.i+1);setStatus("已在曲线上加点。");
  }
  function removeKnot(){
    if(!focus?.curve||focus.curve.length<=2)return;
    const index=Math.min(knot,focus.curve.length-1);change({curve:focus.curve.filter((_,i)=>i!==index)});setKnot(Math.max(0,index-1));
  }
  function change(patch:Partial<FxStroke>){if(focus)commit(draft.strokes.map(s=>s.id===focus.id?{...s,...patch}:s));}
  async function exportPng(pass:"fx"|"mask"){
    setExporting(true);
    try {
      const out=document.createElement("canvas");out.width=w;out.height=h;
      const ctx=out.getContext("2d");if(!ctx)throw Error("浏览器未分配导出画布");
      renderFxDraft(ctx,w,h,draft.strokes,pass,vanish);
      const blob=await new Promise<Blob>((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(Error("图片尺寸超出浏览器导出能力")),"image/png"));
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=fileName.replace(/\.[^.]+$/,"")+(pass==="fx"?"-FX.png":"-遮挡.png");a.click();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      setStatus("已导出 "+(pass==="fx"?"透明特效":"遮挡蒙版")+" · "+w+" × "+h+"。");
    } catch (e) {setStatus(e instanceof Error ? e.message : "PNG 导出失败");}
    finally {setExporting(false);}
  }

  return <section className="fxd" aria-label="手绘特效工作区">
    <header className="fxd-bar">
      <div className="fxd-brand"><span>FX</span><div><h1>手绘草稿</h1><p>{fileName} · {w} × {h}</p></div></div>
      <div className="fxd-actions">
        <button type="button" disabled={!undo.length} onClick={undoAction}>撤销</button><button type="button" disabled={!redo.length} onClick={redoAction}>重做</button>
        <button type="button" onClick={()=>{onSave();setStatus("已保存镜头工程，包含可编辑笔迹。");}}>保存镜头工程</button>
        <label className="fxd-file">打开工程<input type="file" accept=".json,application/json" aria-label="在手绘草稿打开工程" onChange={onOpen}/></label>
        <button className="fxd-switch" type="button" onClick={onClose}>引导与生成 →</button>
      </div>
    </header>
    <aside className="fxd-tools">
      <p className="fxd-tag">01 / BRUSHES</p><h2>笔刷</h2>
      <div className="fxd-brushes">{FX_BRUSHES.map(b=><button type="button" key={b.id} aria-pressed={mode===b.id} onClick={()=>choose(b.id)}><BrushIcon kind={b.id}/><span>{b.label}</span></button>)}</div>
      <button className="fxd-move fxd-look-toggle" type="button" aria-expanded={shelfOpen} onClick={()=>setShelfOpen(!shelfOpen)}>{shelfOpen?"收起造型库":"展开造型库 · 通用 20 / 踏星 10"}</button>
      {shelfOpen&&<FxLookShelf selected={lookId} onPick={pickLook}/>}
      <button className="fxd-move" type="button" aria-pressed={mode==="move"} onClick={()=>choose("move")}><BrushIcon kind="move"/>移动所选笔迹</button>
      <div className="fxd-block">
        <h3>下一笔{look?" · "+look.name:""}</h3><p>{look?.hint ?? info?.hint ?? "选择右侧特效层后，在画布上操作。"} {look?.stage&&<small className="fxd-evidence">{look.stage}</small>}</p>
        {mode!=="move"&&mode!=="curve"&&mode!=="vanish"&&<>
          {mode!=="occlude"&&<label>颜色 <input aria-label="下一笔颜色" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>}
          <label>宽度 <output>{width}</output><input aria-label="下一笔宽度" type="range" min="1" max="24" step="1" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
          <label>{mode==="occlude"?"遮挡":"强度"} <output>{intensity}%</output><input aria-label="下一笔强度" type="range" min="1" max="100" value={intensity} onChange={e=>setIntensity(Number(e.target.value))}/></label>
        </>}
      </div>
      <p className="fxd-note">直接绘制可见特效。不调用 AI，也不需要写说明。</p>
    </aside>
    <div className="fxd-middle">
      <div className="fxd-view"><span>预览</span><div>{([["shot","镜头"],["checker","透明"],["black","黑底"],["white","白底"]] as const).map(([id,label])=><button type="button" key={id} aria-pressed={back===id} onClick={()=>setBack(id)}>{label}</button>)}</div></div>
      <div className="fxd-stage" ref={stage}>
        <div className="fxd-frame" data-bg={back} style={fit}>
          {back==="shot"&&<img src={image.src} alt="原始镜头" draggable={false}/>}
          <canvas aria-label="手绘特效画布" ref={canvas} data-mode={mode} onPointerDown={start} onPointerMove={moveEvent=>move(moveEvent)} onPointerUp={finishEvent=>finish(finishEvent)} onPointerCancel={cancelEvent=>finish(cancelEvent,true)} onDoubleClick={addKnot}/>
        </div>
      </div>
    </div>
    <aside className="fxd-properties">
      <p className="fxd-tag">02 / STROKES</p><h2>特效层 <small>{draft.strokes.length}</small></h2>
      <div className="fxd-list">{!draft.strokes.length?<p>画一笔，之后可以单独选中调整。</p>:draft.strokes.map((s,i)=>
        <div className="fxd-row" key={s.id} data-selected={s.id===selected}><button type="button" onClick={()=>{setSelected(s.id);setKnot(0);if(mode==="curve")setMode("move");}} aria-pressed={s.id===selected}><i style={{background:s.kind==="occlude"?"#ff8eae":s.color}}/>{i+1} · {labelFor(s)}</button><button type="button" aria-label={(s.visible?"隐藏":"显示")+"笔迹 "+(i+1)} onClick={()=>commit(draft.strokes.map(item=>item.id===s.id?{...item,visible:!item.visible}:item))}>{s.visible?"隐藏":"显示"}</button></div>)}</div>
      {focus&&<div className="fxd-block fxd-edit">
        <h3>所选层 · {labelFor(focus)}</h3>
        {look&&focus.kind!=="occlude"&&<button type="button" className="fxd-replace" onClick={replaceLook}>替换所选层造型</button>}
        {focus.kind!=="ring"&&<div className="fxd-edit-actions"><button type="button" aria-pressed={mode==="curve"} onClick={()=>mode==="curve"?setMode("move"):editCurve()}>{mode==="curve"?"结束曲线编辑":"编辑曲线"}</button>{mode==="curve"&&focus.curve&&<button type="button" disabled={focus.curve.length<=2} onClick={removeKnot}>删除锚点</button>}</div>}
        {focus.kind!=="occlude"&&<label>颜色 <input type="color" aria-label="所选笔迹颜色" value={focus.color} onChange={e=>change({color:e.target.value})}/></label>}
        <label>宽度 <output>{focus.width}</output><input type="range" aria-label="所选笔迹宽度" min="1" max="24" value={focus.width} onChange={e=>change({width:Number(e.target.value)})}/></label>
        <label>{focus.kind==="occlude"?"遮挡":"强度"} <output>{focus.intensity}%</output><input type="range" aria-label="所选笔迹强度" min="0" max="100" value={focus.intensity} onChange={e=>change({intensity:Number(e.target.value)})}/></label>
        {focus.kind==="ring"&&<label>旋转 <output>{focus.angle}°</output><input type="range" aria-label="冲击环旋转" min="-180" max="180" value={focus.angle} onChange={e=>change({angle:Number(e.target.value)})}/></label>}
        <details className="fxd-advanced" open>
          <summary>整层变换</summary>
          <label>整体缩放 <output>{transform.scale}%</output><input type="range" aria-label="整层缩放" min="20" max="240" value={transform.scale} onChange={e=>setTransform({scale:Number(e.target.value)})}/></label>
          <label>整体旋转 <output>{transform.rotate}°</output><input type="range" aria-label="整层旋转" min="-180" max="180" value={transform.rotate} onChange={e=>setTransform({rotate:Number(e.target.value)})}/></label>
          <button type="button" onClick={()=>choose("move")}>移动整层</button>
          <button type="button" onClick={()=>change({transform:undefined})}>重置缩放与旋转</button>
        </details>
        {focus.kind!=="occlude"&&<details className="fxd-advanced">
          <summary>透视深度 · Z</summary>
          <p>负值靠近镜头，正值远离；首点保持定位。前景层可画在人物遮挡之前。</p>
          <label>起点 Z <output>{depth.from}</output><input type="range" aria-label="起点 Z" min="-100" max="100" value={depth.from} onChange={e=>setDepth({from:Number(e.target.value)})}/></label>
          <label>终点 Z <output>{depth.to}</output><input type="range" aria-label="终点 Z" min="-100" max="100" value={depth.to} onChange={e=>setDepth({to:Number(e.target.value)})}/></label>
          {focus.kind==="ring"&&<><label>环面俯仰 <output>{depth.tilt}°</output><input type="range" aria-label="环面俯仰" min="-80" max="80" value={depth.tilt} onChange={e=>setDepth({tilt:Number(e.target.value)})}/></label><label>环面偏转 <output>{depth.yaw}°</output><input type="range" aria-label="环面偏转" min="-80" max="80" value={depth.yaw} onChange={e=>setDepth({yaw:Number(e.target.value)})}/></label></>}
          <label className="fxd-front"><input type="checkbox" checked={depth.front} onChange={e=>setDepth({front:e.target.checked})}/> 放在遮挡层之前</label>
          <button type="button" aria-pressed={mode==="vanish"} onClick={()=>{setMode("vanish");setStatus("点击画面以设置透视消失点。");}}>设置消失点</button>
          <button type="button" onClick={()=>change({depth:undefined})}>重置深度</button>
        </details>}
        <div className="fxd-edit-actions"><button type="button" disabled={draft.strokes.length>=FX_MAX_STROKES} onClick={()=>{const dup=duplicateFx(focus,crypto.randomUUID());commit([...draft.strokes,dup]);setSelected(dup.id);setStatus("已复制笔迹并错开位置。");}}>复制</button><button type="button" onClick={()=>choose("move")}>移动</button><button type="button" onClick={()=>{commit(draft.strokes.filter(s=>s.id!==focus.id));setSelected("");}}>删除</button></div>
      </div>}
    </aside>
    <footer className="fxd-bottom">
      <div role="status" data-error={Boolean(generation.error)}>{generation.text||status}</div><button type="button" disabled={exporting||!draft.strokes.some(s=>s.kind==="occlude"&&s.visible)} onClick={()=>void exportPng("mask")}>导出遮挡</button>
      <button className="fxd-export" type="button" disabled={exporting||!draft.strokes.some(s=>s.kind!=="occlude"&&s.visible&&s.intensity>0)} onClick={()=>void exportPng("fx")}>导出透明 PNG</button>
      <button className="fxd-generate" type="button" disabled={generation.busy||!draft.strokes.some(s=>s.kind!=="occlude"&&s.visible&&s.intensity>0)} onClick={onGenerate}>{generation.busy?"正在发送…":"直接出图"}</button>
    </footer>
  </section>;
}

