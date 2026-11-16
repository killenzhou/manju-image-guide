from pathlib import Path
p=Path("web/src/FxDraftStudio.tsx")
s=p.read_text(encoding="utf-8")
def c(a,b):
 global s
 assert s.count(a)==1,(a,s.count(a))
 s=s.replace(a,b)
c('import "./fx-draft.css";','''import { FxLookShelf } from "./FxLookShelf";
import { getFxLook, type FxLook } from "./fx-depth-presets";
import { cubicFx, DEFAULT_VANISH, FLAT_DEPTH, makeFxCurve, makeFxProjection, splitFxCurve, UNIT_TRANSFORM, type FxDepth, type FxKnot, type FxTransform, type XY } from "./fx-depth-geometry";
import "./fx-draft.css";''')
c('FX_MAX_POINTS, FX_MAX_STROKES, renderFxDraft, translateFx','FX_MAX_KNOTS, FX_MAX_POINTS, FX_MAX_STROKES, moveFxStroke, renderFxDraft')
c('type Mode=FxBrush|"move";','type Mode=FxBrush|"move"|"curve"|"vanish";')
c('type Working={pointer:number; stroke:FxStroke; initial?:{start:FxPoint;points:FxPoint[]}};','''type CurveGrip={index:number;handle:"anchor"|"in"|"out";f:number};
type Working={pointer:number; stroke:FxStroke; initial?:{start:FxPoint;original:FxStroke}; grip?:CurveGrip};''')
c('move:"M12 2v20','curve:"M3 19C7 0 18 24 21 5M3 19h3m12-14h3",vanish:"M2 4l20 16M2 20L22 4M12 2v20",move:"M12 2v20')
c('  const [selected,setSelected]=useState("");','''  const [selected,setSelected]=useState("");
  const [lookId,setLookId]=useState("");
  const [shelfOpen,setShelfOpen]=useState(false);
  const [knot,setKnot]=useState(0);''')
c('  const [undo,setUndo]=useState<FxStroke[][]>([]);\n  const [redo,setRedo]=useState<FxStroke[][]>([]);','  const [undo,setUndo]=useState<FxDraft[]>([]);\n  const [redo,setRedo]=useState<FxDraft[]>([]);')
c('  const info=FX_BRUSHES.find(b=>b.id===mode);','''  const info=FX_BRUSHES.find(b=>b.id===mode);
  const look=getFxLook(lookId),vanish=draft.vanish??DEFAULT_VANISH;
  const depth=focus?.depth??FLAT_DEPTH,transform=focus?.transform??UNIT_TRANSFORM;
  const labelFor=(s:FxStroke)=>getFxLook(s.preset)?.name??names[s.kind];
  const fAt=(i:number,n:number)=>i/Math.max(n-1,1);
  function gripAt(s:FxStroke,grip:CurveGrip):XY {
    const anchor=s.curve![grip.index], projection=makeFxProjection(s,vanish,w/h);
    return projection.point(grip.handle==="anchor"?anchor:anchor[grip.handle],grip.f);
  }''')
c('''  const commit=useCallback((strokes:FxStroke[])=>{
    setUndo(list=>[...list.slice(-39),draft.strokes]);setRedo([]);onChange({version:1,strokes});
  },[draft.strokes,onChange]);''','''  const commit=useCallback((strokes:FxStroke[],nextVanish=draft.vanish)=>{
    setUndo(list=>[...list.slice(-39),draft]);setRedo([]);onChange({...draft,strokes,vanish:nextVanish});
  },[draft,onChange]);''')
c('setRedo(list=>[...list,draft.strokes]);onChange({version:1,strokes:undo.at(-1)!});','setRedo(list=>[...list,draft]);onChange(undo.at(-1)!);')
c('},[draft.strokes,onChange,undo]);','},[draft,onChange,undo]);')
c('setUndo(list=>[...list,draft.strokes]);onChange({version:1,strokes:redo.at(-1)!});','setUndo(list=>[...list,draft]);onChange(redo.at(-1)!);')
c('},[draft.strokes,onChange,redo]);','},[draft,onChange,redo]);')
c('working ? working.initial ? draft.strokes.map','working ? (working.initial||working.grip) ? draft.strokes.map')
c('    renderFxDraft(ctx,x,y,marks);','''    renderFxDraft(ctx,x,y,marks,"fx",vanish);
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
    }''')
c('  },[w,h,fit,draft.strokes,working,focus,back]);','  },[w,h,fit,draft.strokes,working,focus,back,mode,knot,vanish]);')
c('    setMode(kind);if(kind==="move") return;','    setMode(kind);if(kind==="move"||kind==="curve"||kind==="vanish") return;\n    setLookId("");')
c('  const point=(e:React.PointerEvent<HTMLCanvasElement>):FxPoint=>{','''  function pickLook(recipe:FxLook){
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
  const point=(e:React.PointerEvent<HTMLCanvasElement>):FxPoint=>{''')
c('''    if(mode==="move"){
      if(!focus || !focus.visible){setStatus("先从右侧选择一条可见笔迹，再拖动。");return;}
      updateWorking({pointer:e.pointerId,stroke:focus,initial:{start:p,points:focus.points}});
    } else {''','''    if(mode==="vanish"){
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
    } else {''')
c('kind:mode,points:[p],color,width,intensity,angle:0,visible:true','kind:mode,points:[p],color,width,intensity,angle:0,visible:true,...(look?{preset:look.id}:{})')
c('''    if(live.initial){
      updateWorking({...live,stroke:{...live.stroke,points:translateFx(live.initial.points,p.x-live.initial.start.x,p.y-live.initial.start.y)}});''','''    if(live.grip && focus?.curve){
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
      updateWorking({...live,stroke:moveFxStroke(live.initial.original,p.x-live.initial.start.x,p.y-live.initial.start.y)});''')
c('live.initial!.points[i].x && p.y===live.initial!.points[i].y','live.initial!.original.points[i].x && p.y===live.initial!.original.points[i].y')
c('''    commit(live.initial?draft.strokes.map(s=>s.id===live.stroke.id?live.stroke:s):[...draft.strokes,live.stroke]);
    setStatus(live.initial?"笔迹已移动。":live.stroke.kind==="occlude"?"已创建可编辑遮挡，原图未改动。":"已绘制 "+names[live.stroke.kind]+"。");''','''    if(live.grip&&JSON.stringify(live.stroke.curve)===JSON.stringify(focus?.curve))return;
    commit(live.initial||live.grip?draft.strokes.map(s=>s.id===live.stroke.id?live.stroke:s):[...draft.strokes,live.stroke]);
    setStatus(live.grip?"曲线已修改。":live.initial?"整层已移动。":live.stroke.kind==="occlude"?"已创建可编辑遮挡，原图未改动。":"已绘制 "+labelFor(live.stroke)+"。");''')
c('  function change(patch:Partial<FxStroke>)','''  function addKnot(e:React.MouseEvent<HTMLCanvasElement>){
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
  function change(patch:Partial<FxStroke>)''')
c('renderFxDraft(ctx,w,h,draft.strokes,pass);','renderFxDraft(ctx,w,h,draft.strokes,pass,vanish);')
c('      <button className="fxd-move"','''      <button className="fxd-move fxd-look-toggle" type="button" aria-expanded={shelfOpen} onClick={()=>setShelfOpen(!shelfOpen)}>{shelfOpen?"收起造型库":"展开造型库 · 通用 20 / 踏星 10"}</button>
      {shelfOpen&&<FxLookShelf selected={lookId} onPick={pickLook}/>}
      <button className="fxd-move"''')
c('<h3>下一笔</h3><p>{info?.hint || "选择右侧笔迹后，在画布上拖动。"} </p>','<h3>下一笔{look?" · "+look.name:""}</h3><p>{look?.hint ?? info?.hint ?? "选择右侧特效层后，在画布上操作。"} {look?.stage&&<small className="fxd-evidence">{look.stage}</small>}</p>')
c('{mode!=="move"&&<>','{mode!=="move"&&mode!=="curve"&&mode!=="vanish"&&<>')
c('onPointerCancel={cancelEvent=>finish(cancelEvent,true)}/>','onPointerCancel={cancelEvent=>finish(cancelEvent,true)} onDoubleClick={addKnot}/>')
c('<h2>镜头笔迹 <small>','<h2>特效层 <small>')
c('onClick={()=>setSelected(s.id)} aria-pressed','onClick={()=>{setSelected(s.id);setKnot(0);if(mode==="curve")setMode("move");}} aria-pressed')
c('{i+1} · {names[s.kind]}','{i+1} · {labelFor(s)}')
c('<h3>所选笔迹 · {names[focus.kind]}</h3>','''<h3>所选层 · {labelFor(focus)}</h3>
        {look&&focus.kind!=="occlude"&&<button type="button" className="fxd-replace" onClick={replaceLook}>替换所选层造型</button>}
        {focus.kind!=="ring"&&<div className="fxd-edit-actions"><button type="button" aria-pressed={mode==="curve"} onClick={()=>mode==="curve"?setMode("move"):editCurve()}>{mode==="curve"?"结束曲线编辑":"编辑曲线"}</button>{mode==="curve"&&focus.curve&&<button type="button" disabled={focus.curve.length<=2} onClick={removeKnot}>删除锚点</button>}</div>}''')
c('        <div className="fxd-edit-actions"><button type="button" disabled={draft.strokes.length>=FX_MAX_STROKES}','''        <details className="fxd-advanced" open>
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
        <div className="fxd-edit-actions"><button type="button" disabled={draft.strokes.length>=FX_MAX_STROKES}''')
s=s.replace('import { cubicFx, DEFAULT_VANISH, FLAT_DEPTH, makeFxCurve, makeFxProjection, splitFxCurve, UNIT_TRANSFORM, type FxDepth, type FxKnot, type FxTransform, type XY }','import { cubicFx, DEFAULT_VANISH, FLAT_DEPTH, makeFxCurve, makeFxProjection, splitFxCurve, UNIT_TRANSFORM, type FxDepth, type FxTransform, type XY }')
p.write_text(s,encoding="utf-8")

