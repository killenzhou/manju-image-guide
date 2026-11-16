from pathlib import Path
p=Path("web/src/fx-draft-model.ts")
s=p.read_text(encoding="utf-8")
def rep(a,b):
    global s
    assert s.count(a)==1,(a,s.count(a))
    s=s.replace(a,b)
s='import { DEFAULT_VANISH, makeFxProjection, slideFxKnots, type FxDepth, type FxKnot, type FxTransform, type XY } from "./fx-depth-geometry";\nimport { getFxLook } from "./fx-depth-presets";\nimport { paintFxLook } from "./fx-depth-render";\n'+s
rep('angle:number; visible:boolean','angle:number; visible:boolean; preset?:string; curve?:FxKnot[]; depth?:FxDepth; transform?:FxTransform')
rep('version:1; strokes:FxStroke[]','version:1; strokes:FxStroke[]; vanish?:XY')
rep('export const FX_MAX_POINTS=1000;','export const FX_MAX_POINTS=1000;\nexport const FX_MAX_KNOTS=24;\nconst coord=(p:XY|undefined,lo:number,hi:number)=>p&&Number.isFinite(p.x)&&p.x>=lo&&p.x<=hi&&Number.isFinite(p.y)&&p.y>=lo&&p.y<=hi;\nconst within=(n:number,a:number,b:number)=>Number.isFinite(n)&&n>=a&&n<=b;')
rep('return d.version===1 && Array.isArray(d.strokes)', 'return d.version===1 && (d.vanish===undefined || coord(d.vanish,0,1)) && Array.isArray(d.strokes)')
rep('    s.points.every(p=>p && Number.isFinite(p.x) && p.x>=0 && p.x<=1 && Number.isFinite(p.y) && p.y>=0 && p.y<=1 && Number.isFinite(p.p) && p.p>=0 && p.p<=1));','''    s.points.every(p=>p && coord(p,0,1) && within(p.p,0,1)) &&
    (s.preset===undefined || getFxLook(s.preset)?.stroke===s.kind) &&
    (s.depth===undefined || s.depth && within(s.depth.from,-100,100) && within(s.depth.to,-100,100) && within(s.depth.tilt,-80,80) && within(s.depth.yaw,-80,80) && typeof s.depth.front==="boolean") &&
    (s.transform===undefined || s.transform && within(s.transform.scale,20,240) && within(s.transform.rotate,-180,180)) &&
    (s.curve===undefined || Array.isArray(s.curve) && s.curve.length>0 && s.curve.length<=FX_MAX_KNOTS && s.curve.every(k=>k && coord(k,0,1) && within(k.p,0,1) && coord(k.in,-1,2) && coord(k.out,-1,2))));
''')
rep('  return {...stroke,id,points:translateFx(stroke.points,.022,.024)};','  return {...moveFxStroke(stroke,.022,.024),id};')
rep('type P={x:number;y:number;p:number};','''export function moveFxStroke(s:FxStroke,dx:number,dy:number):FxStroke {
 const constraints=s.curve?.length?[...s.points,...s.curve]:s.points;
 const all=translateFx(constraints,dx,dy),points=all.slice(0,s.points.length);
 return {...s,points,...(s.curve?.length?{curve:slideFxKnots(s.curve,points[0].x-s.points[0].x,points[0].y-s.points[0].y)}:{})};
}
type P={x:number;y:number;p:number};''')
rep('export function renderFxDraft(ctx:CanvasRenderingContext2D,width:number,height:number,strokes:FxStroke[],pass:"fx"|"mask"="fx") {','export function renderFxDraft(ctx:CanvasRenderingContext2D,width:number,height:number,strokes:FxStroke[],pass:"fx"|"mask"="fx",vanish:XY=DEFAULT_VANISH) {')
start=s.index('  if(pass==="fx") for(const s of strokes)')
s=s[:start]+'''  const paint=(s:FxStroke)=>{
    if(!s.visible || s.kind==="occlude" || !s.points.length) return;
    const recipe=getFxLook(s.preset);
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
'''
p.write_text(s,encoding="utf-8")

