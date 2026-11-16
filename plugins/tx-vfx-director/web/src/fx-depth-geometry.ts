import type {FxPoint,FxStroke} from "./fx-draft-model";
export type XY={x:number;y:number};
export type FxKnot=FxPoint&{in:XY;out:XY};
export type FxDepth={from:number;to:number;tilt:number;yaw:number;front:boolean};
export type FxTransform={scale:number;rotate:number};
export const FLAT_DEPTH:FxDepth={from:0,to:0,tilt:0,yaw:0,front:false};
export const UNIT_TRANSFORM:FxTransform={scale:100,rotate:0};
export const DEFAULT_VANISH:XY={x:.5,y:.46};
export const cap=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const vec=(a:XY,b:XY,t:number)=>({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t)});
const len=(a:XY,b:XY)=>Math.hypot(a.x-b.x,a.y-b.y);
export function makeFxCurve(points:FxPoint[],line=false):FxKnot[]{
 const source=line?[points[0],points.at(-1)!]:points;
 const total=source.reduce((s,p,i)=>s+(i?len(source[i-1],p):0),0);
 if(total<.0001){const p=source[0];return [{...p,in:{x:p.x,y:p.y},out:{x:p.x,y:p.y}}];}
 const stride=Math.max(.028,total/9), chosen=[source[0]];
 let distance=0,last=0;
 for(let i=1;i<source.length-1;i++){
   distance+=len(source[i-1],source[i]);
   if(distance-last>=stride){chosen.push(source[i]);last=distance;}
 }
 chosen.push(source.at(-1)!);
 return chosen.map((p,i)=>{
   const a=chosen[Math.max(0,i-1)],b=chosen[Math.min(chosen.length-1,i+1)];
   const dx=(b.x-a.x)/6,dy=(b.y-a.y)/6;
   return {...p,in:{x:p.x-dx,y:p.y-dy},out:{x:p.x+dx,y:p.y+dy}};
 });
}
export function cubicFx(a:FxKnot,b:FxKnot,t:number):FxPoint {
 const v1=vec(a,a.out,t),v2=vec(a.out,b.in,t),v3=vec(b.in,b,t);
 return {...vec(vec(v1,v2,t),vec(v2,v3,t),t),p:lerp(a.p,b.p,t)};
}
export function traceFxCurve(curve:FxKnot[]):FxPoint[]{
 if(curve.length<2) return curve.map(({x,y,p})=>({x,y,p}));
 const pts:FxPoint[]=[];
 for(let i=0;i<curve.length-1;i++){
   const a=curve[i],b=curve[i+1],steps=cap(Math.ceil((len(a,a.out)+len(a.out,b.in)+len(b.in,b))*180),10,60);
   for(let k=0;k<steps;k++) pts.push(cubicFx(a,b,k/steps));
 }
 pts.push(curve.at(-1)!);return pts;
}
export function splitFxCurve(curve:FxKnot[],segment:number,t:number):FxKnot[]{
 const a=curve[segment],b=curve[segment+1];
 if(!a||!b)return curve;
 t=cap(t,.04,.96);
 const p=vec(a,a.out,t),q=vec(a.out,b.in,t),r=vec(b.in,b,t),s=vec(p,q,t),u=vec(q,r,t);
 const knot={...vec(s,u,t),p:lerp(a.p,b.p,t),in:s,out:u};
 return [...curve.slice(0,segment),{...a,out:p},knot,{...b,in:r},...curve.slice(segment+2)];
}
export function slideFxKnots(knots:FxKnot[],dx:number,dy:number):FxKnot[]{
 const move=(p:XY)=>({x:cap(p.x+dx,-1,2),y:cap(p.y+dy,-1,2)});
 return knots.map(p=>({...p,...move(p),in:move(p.in),out:move(p.out)}));
}
export function strokeBasis(s:FxStroke):FxPoint[]{return s.curve?.length ? traceFxCurve(s.curve) : s.points;}
export function lens(z:number){return 1/(1+cap(z,-100,100)*.0062);}
export function makeFxProjection(s:FxStroke,vanish:XY=DEFAULT_VANISH,aspect=1) {
 const base=strokeBasis(s), anchor=base[0]??{x:.5,y:.5,p:.58}, depth=s.depth??FLAT_DEPTH,t=s.transform??UNIT_TRANSFORM;
 const distance=[0]; for(let i=1;i<base.length;i++)distance.push(distance[i-1]+len(base[i],base[i-1]));
 const total=distance.at(-1)||1;
 const cx=s.kind==="ring"?anchor.x:(Math.min(...base.map(p=>p.x))+Math.max(...base.map(p=>p.x)))/2;
 const cy=s.kind==="ring"?anchor.y:(Math.min(...base.map(p=>p.y))+Math.max(...base.map(p=>p.y)))/2;
 const a=t.rotate*Math.PI/180,cos=Math.cos(a)*t.scale/100,sin=Math.sin(a)*t.scale/100;
 const xform=(p:XY)=>({x:cx+(p.x-cx)*cos-(p.y-cy)*sin/aspect,y:cy+(p.x-cx)*sin*aspect+(p.y-cy)*cos});
 const o=xform(anchor), front=lens(depth.from);
 const factor=(f:number)=>lens(lerp(depth.from,depth.to,f));
 const point=(p:XY,f:number)=>{
   const r=xform(p), l=factor(f);
   return {x:vanish.x+(r.x-vanish.x)*l+(o.x-vanish.x)*(1-front),y:vanish.y+(r.y-vanish.y)*l+(o.y-vanish.y)*(1-front)};
 };
 const inverse=(p:XY,f:number)=>{const l=factor(f),u=(p.x-vanish.x-(o.x-vanish.x)*(1-front))/l+vanish.x-cx,v=(p.y-vanish.y-(o.y-vanish.y)*(1-front))/l+vanish.y-cy;const n=(t.scale/100)**2;return {x:cx+(u*cos+v*sin/aspect)/n,y:cy+(-u*sin*aspect+v*cos)/n};};
 return {base,point,inverse,factor,points:base.map((p,i)=>({...p,...point(p,distance[i]/total),s:factor(distance[i]/total)}))};
}
export function nearestFxCurve(curve:FxKnot[],target:XY,width:number,height:number){
 let best={segment:0,t:.5,d:Infinity};
 for(let i=0;i<curve.length-1;i++)for(let j=0;j<=36;j++){
   const t=j/36,p=cubicFx(curve[i],curve[i+1],t),d=Math.hypot((p.x-target.x)*width,(p.y-target.y)*height);
   if(d<best.d)best={segment:i,t,d};
 }
 return best;
}

