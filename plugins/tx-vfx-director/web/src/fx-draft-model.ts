import { DEFAULT_VANISH, makeFxProjection, slideFxKnots, type FxDepth, type FxKnot, type FxTransform, type XY } from "./fx-depth-geometry";
import { getFxLook } from "./fx-depth-presets";
import { paintFxLook } from "./fx-depth-render";
export type FxBrush = "ribbon" | "ring" | "crystal" | "occlude";
export type FxPoint = {x:number;y:number;p:number};
export type FxStroke = {id:string; kind:FxBrush; points:FxPoint[]; color:string; width:number; intensity:number; angle:number; visible:boolean; preset?:string; curve?:FxKnot[]; depth?:FxDepth; transform?:FxTransform};
export type FxDraft = {version:1; strokes:FxStroke[]; vanish?:XY};
export const emptyDraft = ():FxDraft => ({version:1,strokes:[]});
export const FX_BRUSHES = [
  {id:"ribbon",label:"能量带",hint:"拖出带亮芯、流丝和收尖的能量。",color:"#58d8ff",width:4},
  {id:"ring",label:"冲击环",hint:"从落点往外拖，控制环的大小与扁度。",color:"#a9b8ff",width:3},
  {id:"crystal",label:"冰晶枝",hint:"沿地面或身体轮廓拖，晶枝沿路径生长。",color:"#86e7ff",width:8},
  {id:"occlude",label:"遮挡笔",hint:"涂过脸、手或道具，使原图从特效下露出。",color:"#ffffff",width:9},
] as const;
export const FX_MAX_STROKES=200;
export const FX_MAX_POINTS=1000;
export const FX_MAX_KNOTS=24;
const coord=(p:XY|undefined,lo:number,hi:number)=>Boolean(p)&&Number.isFinite(p!.x)&&p!.x>=lo&&p!.x<=hi&&Number.isFinite(p!.y)&&p!.y>=lo&&p!.y<=hi;
const within=(n:number,a:number,b:number)=>Number.isFinite(n)&&n>=a&&n<=b;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export function isFxDraft(value:unknown):value is FxDraft {
  if(!value || typeof value!=="object") return false;
  const d=value as FxDraft;
  return d.version===1 && (d.vanish===undefined || coord(d.vanish,0,1)) && Array.isArray(d.strokes) && d.strokes.length<=FX_MAX_STROKES && new Set(d.strokes.map(s=>s?.id)).size===d.strokes.length && d.strokes.every(s=>
    s && typeof s.id==="string" && s.id.length>0 && FX_BRUSHES.some(brush=>brush.id===s.kind) && /^#[0-9a-f]{6}$/i.test(s.color) &&
    Number.isFinite(s.width) && s.width>=1 && s.width<=24 && Number.isFinite(s.intensity) && s.intensity>=0 && s.intensity<=100 &&
    Number.isFinite(s.angle) && Math.abs(s.angle)<=180 && typeof s.visible==="boolean" && Array.isArray(s.points) && s.points.length>=1 && s.points.length<=FX_MAX_POINTS &&
    s.points.every(p=>p && coord(p,0,1) && within(p.p,0,1)) &&
    (s.preset===undefined || getFxLook(s.preset)?.stroke===s.kind) &&
    (s.depth===undefined || s.depth && within(s.depth.from,-100,100) && within(s.depth.to,-100,100) && within(s.depth.tilt,-80,80) && within(s.depth.yaw,-80,80) && typeof s.depth.front==="boolean") &&
    (s.transform===undefined || s.transform && within(s.transform.scale,20,240) && within(s.transform.rotate,-180,180)) &&
    (s.curve===undefined || Array.isArray(s.curve) && s.curve.length>0 && s.curve.length<=FX_MAX_KNOTS && s.curve.every(k=>k && coord(k,-1,2) && within(k.p,0,1) && coord(k.in,-1,2) && coord(k.out,-1,2))));

}
export function translateFx(points:FxPoint[],dx:number,dy:number):FxPoint[] {
  const minX=Math.min(...points.map(p=>p.x)), maxX=Math.max(...points.map(p=>p.x));
  const minY=Math.min(...points.map(p=>p.y)), maxY=Math.max(...points.map(p=>p.y));
  dx=clamp(dx,-minX,1-maxX); dy=clamp(dy,-minY,1-maxY);
  return points.map(p=>({...p,x:clamp(p.x+dx,0,1),y:clamp(p.y+dy,0,1)}));
}
export function duplicateFx(stroke:FxStroke,id:string):FxStroke {
  return {...moveFxStroke(stroke,.022,.024),id};
}
export function moveFxStroke(s:FxStroke,dx:number,dy:number):FxStroke {
 const constraints=s.curve?.length?[...s.points,...s.curve]:s.points;
 const all=translateFx(constraints,dx,dy),points=all.slice(0,s.points.length);
 return {...s,points,...(s.curve?.length?{curve:slideFxKnots(s.curve,points[0].x-s.points[0].x,points[0].y-s.points[0].y)}:{})};
}
type P={x:number;y:number;p:number};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const rgba=(hex:string,a:number)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${clamp(a,0,1)})`;
function resample(points:P[],step:number):P[] {
  if(points.length<2) return points;
  let carry=0;
  const out=[points[0]];
  for(let i=1;i<points.length;i++){
    const a=points[i-1], b=points[i], distance=Math.hypot(b.x-a.x,b.y-a.y);
    if(!distance) continue;
    let at=step-carry;
    for(;at<=distance;at+=step){
      const f=at/distance;
      out.push({x:mix(a.x,b.x,f),y:mix(a.y,b.y,f),p:mix(a.p,b.p,f)});
    }
    carry=clamp(distance-(at-step),0,step-.0001);
  }
  const tail=points[points.length-1], prev=out[out.length-1];
  if(Math.hypot(tail.x-prev.x,tail.y-prev.y)>.2) out.push(tail);
  return out;
}
function circle(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,fill:string) {
  if(r<=0) return;
  ctx.fillStyle=fill; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}
function smoothPath(ctx:CanvasRenderingContext2D,pts:P[]) {
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++) ctx.quadraticCurveTo(pts[i].x,pts[i].y,(pts[i].x+pts[i+1].x)/2,(pts[i].y+pts[i+1].y)/2);
  const last=pts[pts.length-1];ctx.lineTo(last.x,last.y);
}
function tangent(pts:P[],i:number) {
  const a=pts[Math.max(0,i-2)],b=pts[Math.min(pts.length-1,i+2)],d=Math.hypot(b.x-a.x,b.y-a.y)||1;
  return {x:(b.x-a.x)/d,y:(b.y-a.y)/d};
}
function strand(ctx:CanvasRenderingContext2D,pts:P[],w:number,color:string,offset=0) {
  if(pts.length<2){circle(ctx,pts[0].x,pts[0].y,w*.4,color);return;}
  const sides=[1,-1].flatMap((sign)=>{
    const edge=pts.map((p,i)=>{
      const f=i/(pts.length-1),n=tangent(pts,i);
      const taper=(.12+.88*Math.sin(Math.PI*Math.pow(f,.64))**.76)*(.55+.65*p.p);
      const scale=sign*w*taper+offset*w*Math.sin(Math.PI*f)*Math.cos(f*8);
      return {...p,x:p.x-n.y*scale,y:p.y+n.x*scale};
    });
    return sign===1?edge:edge.reverse();
  });
  smoothPath(ctx,sides);ctx.closePath();ctx.fillStyle=color;ctx.fill();
}
function paintRibbon(ctx:CanvasRenderingContext2D,points:P[],w:number,color:string,a:number) {
  const pts=resample(points,Math.max(2,w*.21));
  for(let i=6;i>=1;i--) strand(ctx,pts,w*(.56+i*.29),rgba(color,a*.045));
  strand(ctx,pts,w*.53,rgba(color,a*.63));
  strand(ctx,pts,w*.23,rgba(color,a*.8),1.4);
  strand(ctx,pts,w*.11,rgba("#edfcff",a*.88),-.75);
  strand(ctx,pts,w*.08,rgba("#ffffff",a*.68),.5);
}
function paintRing(ctx:CanvasRenderingContext2D,points:P[],w:number,color:string,a:number,angle:number) {
  const p=points[0], q=points[points.length-1];
  const rx=Math.max(w*.38,Math.abs(q.x-p.x)), ry=Math.max(w*.22,Math.abs(q.y-p.y));
  const draw=(scale:number,thickness:number,c:string,start=0,end=Math.PI*2)=>{
    ctx.beginPath();ctx.ellipse(p.x,p.y,rx*scale,ry*scale,angle*Math.PI/180,start,end);
    ctx.lineWidth=Math.max(.6,thickness);ctx.strokeStyle=c;ctx.stroke();
  };
  for(let i=6;i>0;i--) draw(1,w*(.18+i*.22),rgba(color,a*.05));
  draw(1.065,w*.13,rgba(color,a*.36),.22,5.8);
  draw(.94,w*.10,rgba(color,a*.27),.8,4.65);
  draw(1,w*.32,rgba(color,a*.78));
  draw(1,w*.10,rgba("#f3fdff",a*.92),-.95,2.37);
  draw(1.14,w*.05,rgba(color,a*.22),2.8,5.55);
}
const rand=(n:number,k:number)=>((Math.sin(n*97.15+k*17.17)*43758.5453123)%1+1)%1;
function polygon(ctx:CanvasRenderingContext2D,pts:Array<[number,number]>,fill:string) {
  ctx.beginPath();ctx.moveTo(...pts[0]);pts.slice(1).forEach(p=>ctx.lineTo(...p));ctx.closePath();ctx.fillStyle=fill;ctx.fill();
}
function paintCrystals(ctx:CanvasRenderingContext2D,points:P[],w:number,color:string,a:number) {
  const pts=resample(points,Math.max(6,w*.48));
  strand(ctx,pts,w*.47,rgba(color,a*.13)); strand(ctx,pts,w*.07,rgba(color,a*.7));
  pts.forEach((p,i)=>{
    const n=tangent(pts,i), base=pts.length===1 ? -Math.PI/2 : Math.atan2(n.y,n.x);
    const f=(i+1)/(pts.length+1);
    for(let side=0;side<2;side++){
      const turn=pts.length===1 ? side*1.3-.65 : (side?1:-1)*(.4+rand(i,side+2)*.9);
      const l=w*(.36+rand(i,side+4)*1.0)*(.7+.35*Math.sin(f*Math.PI))*(.65+p.p*.55);
      const b=w*(.09+rand(i,side+9)*.16), angle=base+turn;
      const vx=Math.cos(angle),vy=Math.sin(angle),nx=-vy,ny=vx;
      const at=(x:number,y:number):[number,number]=>[p.x+vx*x+nx*y,p.y+vy*x+ny*y];
      const tip=at(l,0), center=at(l*.68,0), left=at(l*.48,b), right=at(l*.46,-b), heel=at(-l*.10,0);
      polygon(ctx,[tip,left,heel,right],rgba(color,a*.61));
      polygon(ctx,[tip,left,heel,center],rgba("#e4fbff",a*.58));
      polygon(ctx,[tip,center,right],rgba("#fcfeff",a*.72));
      if(i%2===0) circle(ctx,...at(l*.83,b*1.25),Math.max(.8,w*.033),rgba("#c9f8ff",a*.72));
    }
  });
}
function applyMask(ctx:CanvasRenderingContext2D,pts:P[],w:number,intensity:number) {
  for(let i=4;i>=0;i--){
    const radius=w*(.48+i*.145), alpha=(i===0?1:.20)*intensity;
    const color=rgba("#ffffff",alpha);
    if(pts.length===1) circle(ctx,pts[0].x,pts[0].y,radius,color);
    else{smoothPath(ctx,pts);ctx.lineWidth=radius*2;ctx.strokeStyle=color;ctx.stroke();}
  }
}
export function renderFxDraft(ctx:CanvasRenderingContext2D,width:number,height:number,strokes:FxStroke[],pass:"fx"|"mask"="fx",vanish:XY=DEFAULT_VANISH) {
  ctx.clearRect(0,0,width,height);ctx.save();ctx.lineCap="round";ctx.lineJoin="round";
  const paint=(s:FxStroke)=>{
    if(!s.visible || s.kind==="occlude" || !s.points.length) return;
    const recipe=getFxLook(s.preset) ?? (s.kind==="ring" && s.depth && (s.depth.from||s.depth.to||s.depth.tilt||s.depth.yaw) ? getFxLook("shock") : undefined);
    if(recipe){paintFxLook(ctx,s,width,height,recipe,vanish);return;}
    const points=makeFxProjection(s,vanish,width/height).points.map(p=>({x:p.x*width,y:p.y*height,p:clamp(p.p*p.s,0,1)}));
    const scale=(s.transform?.scale??100)/100;
    const w=Math.min(width,height)*s.width/100*scale, a=s.intensity/100;
    if(s.kind==="ribbon") paintRibbon(ctx,points,w,s.color,a);
    if(s.kind==="ring") paintRing(ctx,points,w,s.color,a,s.angle);
    if(s.kind==="crystal") paintCrystals(ctx,points,w,s.color,a);
  };
  const ordered=strokes.filter(s=>s.visible&&s.kind!=="occlude").slice().sort((a,b)=>((b.depth?.from??0)+(b.depth?.to??0))-((a.depth?.from??0)+(a.depth?.to??0)));
  if(pass==="fx") ordered.filter(s=>!s.depth?.front).forEach(paint);
  ctx.globalCompositeOperation=pass==="fx"?"destination-out":"source-over";
  for(const s of strokes){
    if(!s.visible || s.kind!=="occlude" || !s.points.length) continue;
    const points=makeFxProjection(s,vanish,width/height).points.map(p=>({x:p.x*width,y:p.y*height,p:p.p}));
    applyMask(ctx,points,Math.min(width,height)*s.width/100*(s.transform?.scale??100)/100,s.intensity/100);
  }
  ctx.globalCompositeOperation="source-over";
  if(pass==="fx") ordered.filter(s=>s.depth?.front).forEach(paint);
  ctx.restore();
}
