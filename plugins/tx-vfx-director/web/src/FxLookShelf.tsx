import {useEffect,useRef,useState} from "react";
import {FX_GENERAL,FX_TX,type FxLook} from "./fx-depth-presets";
import {makeFxCurve} from "./fx-depth-geometry";
import {renderFxDraft,type FxStroke} from "./fx-draft-model";

function Thumb({look}:{look:FxLook}) {
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
   const ctx=ref.current?.getContext("2d");if(!ctx)return;
   const points=look.stroke==="ring"?[[.49,.51],[.77,.79]]:[[.12,.69],[.22,.45],[.35,.30],[.47,.34],[.60,.53],[.74,.58],[.88,.44]];
   const mark:FxStroke={id:"preview",kind:look.stroke,preset:look.id,points:points.map(([x,y])=>({x,y,p:.62})),color:look.tone,width:look.width,intensity:93,angle:-12,visible:true,depth:{from:-12,to:19,tilt:14,yaw:16,front:false}};
   if(look.stroke!=="ring")mark.curve=makeFxCurve(mark.points);
   ctx.lineCap="round";ctx.lineJoin="round";renderFxDraft(ctx,176,104,[mark]);
 },[look]);
 return <canvas ref={ref} width={176} height={104} aria-hidden="true"/>;
}
export function FxLookShelf({selected,onPick}:{selected:string;onPick:(look:FxLook)=>void}){
 const [tab,setTab]=useState<"general"|"tx">("general");
 const [search,setSearch]=useState("");
 const group=tab==="general"?FX_GENERAL:FX_TX;
 const looks=group.filter(k=>(k.name+" "+(k.character||"")+" "+(k.stage||"")).includes(search.trim()));
 return <div className="fxd-look-shelf">
  <div className="fxd-look-tabs"><button type="button" aria-pressed={tab==="general"} onClick={()=>{setTab("general");setSearch("");}}>通用 20</button><button type="button" aria-pressed={tab==="tx"} onClick={()=>{setTab("tx");setSearch("");}}>踏星 {FX_TX.length}</button></div>
  <input className="fxd-look-search" aria-label="搜索特效造型" placeholder="搜索造型或人物" value={search} onChange={e=>setSearch(e.target.value)}/>
  <div className="fxd-look-grid">{looks.map(look=><button type="button" data-look={look.id} aria-pressed={selected===look.id} key={look.id} title={[look.character,look.stage,look.hint].filter(Boolean).join(" · ")} onClick={()=>onPick(look)}>
   <Thumb look={look}/><span>{look.character&&<small>{look.character}</small>}{look.name}</span></button>)}</div>
  {!looks.length&&<p>没有匹配的造型。</p>}
 </div>;
}

