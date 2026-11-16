import { DEFAULT_VANISH, FLAT_DEPTH, makeFxProjection, lens, type XY } from "./fx-depth-geometry";
import type {FxStroke} from "./fx-draft-model";
import type {FxLook,FxShape} from "./fx-depth-presets";

type P=XY&{s:number};
const tau=Math.PI*2;
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const noise=(n:number)=>{const v=Math.sin(n*19.167+33.53)*23581.376;return v-Math.floor(v);};
const ink=(hex:string,a:number)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${Math.min(1,Math.max(a,0))})`;
function line(ctx:CanvasRenderingContext2D,p:XY[],w:number,c:string) {
 if(p.length<2)return;
 ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);
 for(let i=1;i<p.length;i++)ctx.lineTo(p[i].x,p[i].y);
 ctx.lineWidth=Math.max(.35,w);ctx.strokeStyle=c;ctx.stroke();
}
function fill(ctx:CanvasRenderingContext2D,p:XY[],c:string) {
 if(p.length<3)return;
 ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);p.slice(1).forEach(q=>ctx.lineTo(q.x,q.y));ctx.closePath();ctx.fillStyle=c;ctx.fill();
}
function normal(p:P[],i:number){
 const a=p[Math.max(0,i-1)],b=p[Math.min(i+1,p.length-1)],dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1;
 return {x:-dy/n,y:dx/n,tx:dx/n,ty:dy/n};
}
function evenly(p:P[],step:number){
 if(p.length<=1)return p;
 const out=[p[0]];let rem=0;
 for(let i=1;i<p.length;i++){
   const a=p[i-1],b=p[i],d=Math.hypot(b.x-a.x,b.y-a.y);
   if(!d)continue;
   let t=step-rem;
   while(t<d && out.length<400){out.push({x:mix(a.x,b.x,t/d),y:mix(a.y,b.y,t/d),s:mix(a.s,b.s,t/d)});t+=step;}
   rem=d-(t-step);
 }
 const b=p.at(-1)!;if(Math.hypot(b.x-out.at(-1)!.x,b.y-out.at(-1)!.y)>.25)out.push(b);
 return out;
}
function offset(p:P[],fn:(f:number,i:number)=>number):P[]{
 return p.map((q,i)=>{
   const n=normal(p,i),d=fn(i/Math.max(1,p.length-1),i)*q.s;
   return {...q,x:q.x+n.x*d,y:q.y+n.y*d};
 });
}
function bulb(ctx:CanvasRenderingContext2D,p:XY,r:number,c:string,a:number){
 if(r<=.1)return;
 const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
 g.addColorStop(0,ink(c,a));g.addColorStop(.29,ink(c,a*.46));g.addColorStop(1,ink(c,0));
 ctx.fillStyle=g;ctx.fillRect(p.x-r,p.y-r,2*r,2*r);
}
function dot(ctx:CanvasRenderingContext2D,p:XY,r:number,c:string){
 if(r<=.05)return;
 ctx.beginPath();ctx.arc(p.x,p.y,r,0,tau);ctx.fillStyle=c;ctx.fill();
}
function ribbon(ctx:CanvasRenderingContext2D,p:P[],w:number,c:string,asym=1){
 const power=(f:number)=>.065+.935*Math.sin(Math.PI*Math.pow(f,.79))**.63;
 fill(ctx,[...offset(p,f=>w*power(f)*asym),...offset(p,f=>-w*power(f)).reverse()],c);
}
function flare(ctx:CanvasRenderingContext2D,p:XY,r:number,color:string,a:number){
 bulb(ctx,p,r*1.3,color,a*.37);
 const t=r*.16;
 fill(ctx,[{x:p.x-r,y:p.y},{x:p.x-t,y:p.y-t},{x:p.x,y:p.y-r*.74},{x:p.x+t,y:p.y-t},{x:p.x+r,y:p.y},{x:p.x+t,y:p.y+t},{x:p.x,y:p.y+r*.74},{x:p.x-t,y:p.y+t}],ink(color,a));
}
function paths(ctx:CanvasRenderingContext2D,p:P[],w:number,tone:string,hi:string,a:number,shape:FxShape){
 if(p.length<2){const c=p[0];if(c){bulb(ctx,c,w*.6*c.s,tone,a*.75);dot(ctx,c,w*.1*c.s,ink(hi,a));}return;}
 const samples=evenly(p,Math.max(2,w*.23));
 const strand=(q:P[],width=w,asym=1)=>{
   for(let i=3;i>=1;i--)ribbon(ctx,q,width*(.48+i*.25),ink(tone,a*.036),asym);
   ribbon(ctx,q,width*.46,ink(tone,a*.63),asym);
   ribbon(ctx,offset(q,f=>Math.sin(f*11)*width*.10),width*.13,ink(hi,a*.88));
   line(ctx,offset(q,f=>Math.sin(f*20)*width*.19),width*.045,ink(hi,a*.54));
 };
 switch(shape){
 case "blade":
   ribbon(ctx,samples,w*.88,ink(tone,a*.12),.28);ribbon(ctx,samples,w*.62,ink(tone,a*.58),.16);
   for(let i=0;i<5;i++)line(ctx,offset(samples,f=>-Math.sin(Math.PI*f)*w*(.65-i*.112)),w*(i===0?.086:.035),ink(i===0?hi:tone,a*(i===0?.96:.53)));
   break;
 case "slash": case "claw": case "wind": case "water": {
   const n=shape==="claw"?3:shape==="wind"?5:shape==="water"?3:2;
   for(let i=0;i<n;i++){
     const q=offset(samples,f=>w*((i-(n-1)/2)*.38*Math.sin(Math.PI*f)+(shape==="wind"?Math.sin(f*12+i)*.24:0)));
     strand(q,w*(shape==="water"?.64:1-i*.12));
   }
   if(shape==="water")samples.forEach((p,i)=>{if(i%3===1)dot(ctx,p,w*.032,ink(hi,a*.7));});
   break;
 }
 case "lightning": {
   const nodes=evenly(samples,w*.44),q=offset(nodes,(f,i)=>Math.sin(Math.PI*f)*(noise(i)-.5)*w*.76);
   line(ctx,q,w*.47,ink(tone,a*.20));line(ctx,q,w*.13,ink(tone,a*.84));line(ctx,q,w*.05,ink(hi,a*.94));
   q.forEach((pt,i)=>{if(i%4===1){const n=normal(q,i),s=i%3===0?-1:1;line(ctx,[pt,{x:pt.x+(n.x*s+n.tx)*w*.43,y:pt.y+(n.y*s+n.ty)*w*.43},{x:pt.x+(n.x*s+n.tx*.9)*w*.9,y:pt.y+(n.y*s+n.ty*.9)*w*.9}],w*.035,ink(hi,a*.74));}});
   break;
 }
 case "flame": {
   strand(samples,w*.65);const q=evenly(samples,w*.45);
   q.forEach((pt,i)=>{if(i%2===1){const n=normal(q,i),d=(noise(i)-.5)*w*1.45*pt.s;fill(ctx,[{x:pt.x-n.x*w*.18,y:pt.y-n.y*w*.18},pt,{x:pt.x+n.x*d+n.tx*w*.78,y:pt.y+n.y*d+n.ty*w*.78}],ink(i%4===1?tone:hi,a*.63));}});
   break;
 }
 case "ink": {
   ribbon(ctx,offset(samples,(f,i)=>(noise(i)-.5)*w*.45),w*.6,ink(tone,a*.88),1.45);
   for(let i=0;i<6;i++){const q=offset(samples,(f,k)=>w*(i*.12-.36+noise(i*13+k)*.07));line(ctx,q.filter((_,j)=>j%11!==0),w*.025,ink(i%2?tone:hi,a*.43));}
   samples.forEach((p,i)=>{if(i%3===1){const n=normal(samples,i),d=(noise(i)-.5)*w*2.9;dot(ctx,{x:p.x+n.x*d,y:p.y+n.y*d},w*(.02+noise(i+3)*.07),ink(tone,a*.7));}});
   break;
 }
 case "vine": {
   line(ctx,samples,w*.19,ink(tone,a*.95));line(ctx,offset(samples,()=>w*.07),w*.048,ink(hi,a*.64));
   const nodes=evenly(samples,w*.49);
   nodes.forEach((q,i)=>{const n=normal(nodes,i),s=i%2?1:-1,tip={x:q.x+(n.x*s*.57+n.tx*.57)*w,y:q.y+(n.y*s*.57+n.ty*.57)*w};fill(ctx,[q,{x:q.x+n.x*s*w*.49,y:q.y+n.y*s*w*.49},tip,{x:q.x+n.tx*w*.41,y:q.y+n.ty*w*.41}],ink(i%2?tone:hi,a*.66));});
   break;
 }
 case "arrow": {
   strand(samples,w*.43);
   const t=samples.at(-1)!,n=normal(samples,samples.length-1),d=w*t.s;
   const at=(x:number,y:number)=>({x:t.x+n.tx*x*d+n.x*y*d,y:t.y+n.ty*x*d+n.y*y*d});
   fill(ctx,[at(0,0),at(-1.55,.46),at(-1.1,0),at(-1.55,-.46)],ink(tone,a*.78));
   fill(ctx,[at(0,0),at(-1.55,.46),at(-1.1,0)],ink(hi,a*.81));line(ctx,[at(0,0),at(-1.2,0)],w*.053,ink("#ffffff",a*.94));
   for(let i=0;i<2;i++)line(ctx,offset(samples,f=>w*Math.sin(f*20+i*Math.PI)*.24*Math.sin(f*Math.PI)),w*.04,ink(hi,a*.57));
   break;
 }
 default:
   strand(samples);line(ctx,offset(samples,f=>Math.sin(f*12)*w*.66*Math.sin(Math.PI*f)),w*.05,ink(hi,a*.47));
 }
}
function grains(ctx:CanvasRenderingContext2D,p:P[],w:number,tone:string,hi:string,a:number,shape:FxShape){
 const nodes=evenly(p,Math.max(4,w*(shape==="mist"?.26:.37)));
 if(!nodes.length)return;
 if(shape==="frost")line(ctx,nodes,w*.07,ink(hi,a*.55));
 nodes.forEach((q,i)=>{
   const n=normal(nodes,i),size=w*q.s;
   const count=shape==="frost"?2:shape==="shard"?3:shape==="ember"?3:2;
   for(let k=0;k<count;k++){
     const r=noise(i*11+k),v=noise(i*9+k+10),side=k%2?1:-1;
     const c={x:q.x+n.x*size*r*side*.7,y:q.y+n.y*size*r*side*.7};
     if(shape==="mist"){bulb(ctx,c,size*(.49+v*.75),k?hi:tone,a*(.06+r*.13));continue;}
     if(shape==="ember"){
       bulb(ctx,c,size*.22,tone,a*.63);dot(ctx,c,size*(.022+v*.04),ink(hi,a*.96));
       if(k===1)line(ctx,[c,{x:c.x-n.tx*size*.42,y:c.y-n.ty*size*.42}],size*.045,ink(tone,a*.62));
       continue;
     }
     const ang=(nodes.length===1?-Math.PI/2:Math.atan2(n.ty,n.tx))+side*(.38+v*1.1);
     const dx=Math.cos(ang),dy=Math.sin(ang),l=size*(.38+r*.68),b=l*(shape==="shard"?.38:.22);
     const at=(x:number,y:number)=>({x:c.x+dx*x-dy*y,y:c.y+dy*x+dx*y});
     const tip=at(l,0),left=at(l*.46,b),right=at(l*.40,-b),heel=at(-l*.13,0),mid=at(l*.31,0);
     fill(ctx,[tip,left,heel,right],ink(tone,a*(.55+v*.38)));
     fill(ctx,[tip,left,heel,mid],ink(hi,a*.43));fill(ctx,[tip,mid,right],ink(hi,a*.79));
     line(ctx,[heel,mid,tip],size*.018,ink("#efffff",a*.77));
     if(shape==="frost"&&i%3===0)line(ctx,[heel,at(l*.37,b*.7),at(l*.62,b*1.75)],size*.026,ink(hi,a*.56));
   }
 });
}
function rings(ctx:CanvasRenderingContext2D,s:FxStroke,W:number,H:number,w:number,tone:string,hi:string,a:number,shape:FxShape,vanish:XY){
 const projection=makeFxProjection(s,vanish,W/H),first=projection.base[0],last=projection.base.at(-1);
 if(!first||!last)return;
 const depth=s.depth??FLAT_DEPTH,center=projection.point(first,0);
 const cx=center.x*W,cy=center.y*H,rs=(s.transform?.scale??100)/100;
 const rx=Math.max(w*.65,Math.abs(last.x-first.x)*W)*rs,ry=Math.max(w*.40,Math.abs(last.y-first.y)*H)*rs;
 const rot=(s.angle+(s.transform?.rotate??0))*Math.PI/180;
 const tilt=depth.tilt*Math.PI/180,yaw=depth.yaw*Math.PI/180;
 const emit=(rad:number,scale=1,plane=0):P=>{
   const x=Math.cos(rad)*rx*scale,y=Math.sin(rad)*ry*scale;
   const vx=x*Math.cos(yaw)+y*Math.sin(tilt)*Math.sin(yaw),vy=y*Math.cos(tilt);
   const vz=(-x*Math.sin(yaw)+y*Math.sin(tilt)*Math.cos(yaw))/Math.min(W,H)*119;
   const near=lens(mix(depth.from,depth.to,(Math.sin(rad)+1)/2)+vz);
   return {x:cx+(vx*Math.cos(rot)-vy*Math.sin(rot))*near,y:cy+(vx*Math.sin(rot)+vy*Math.cos(rot))*near+plane*near,s:near};
 };
 const trace=(scale:number,from=0,to=tau,n=68,plane=0)=>Array.from({length:n+1},(_,i)=>emit(mix(from,to,i/n),scale,plane));
 const stroke=(scale:number,amount:number,shade:string,alpha:number,lo=0,hi=tau,plane=0)=>{
   const path=trace(scale,lo,hi,72,plane);
   for(let i=0;i<path.length-1;i+=3){
     const z=path[i].s;line(ctx,path.slice(i,i+4),w*amount*z,ink(shade,alpha*Math.min(1.16,Math.max(.42,z))));
   }
 };
 if(shape==="palm"){
   const hand=[[.31,.59],[.26,.31],[.19,.1],[.23,-.04],[.32,.02],[.46,.24],[.55,.25],[.51,-.21],[.55,-.58],[.64,-.60],[.70,-.51],[.74,-.21],[.80,-.28],[.79,-.71],[.86,-.82],[.96,-.78],[1.00,-.36],[1.06,-.39],[1.09,-.61],[1.17,-.60],[1.20,-.18],[1.28,-.36],[1.35,-.32],[1.31,.04],[1.24,.43],[1.05,.69],[.75,.81],[.48,.76],[.31,.59]];
   const at=([x,y]:number[])=>{const vx=(x-.78)*rx*1.63,vy=y*ry*1.56,z=lens(mix(depth.from,depth.to,(y+1)/2));return {x:cx+(vx*Math.cos(rot)-vy*Math.sin(rot))*z,y:cy+(vx*Math.sin(rot)+vy*Math.cos(rot))*z};};
   const poly=hand.map(at);fill(ctx,poly,ink(tone,a*.19));line(ctx,poly,w*.37,ink(tone,a*.46));line(ctx,poly,w*.085,ink(hi,a*.91));
   ctx.save();ctx.beginPath();ctx.moveTo(poly[0].x,poly[0].y);poly.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.clip();
   for(let i=0;i<12;i++){const d=i*.083;line(ctx,Array.from({length:30},(_,j)=>at([.31+d+Math.sin(j*.16+d*9)*.12,.83-j*.052])),w*.031,ink(i%3?hi:tone,a*.33));}
   ctx.restore();return;
 }
 if(shape==="shield"){
   const poly=trace(1,Math.PI/6,tau+Math.PI/6,6);
   fill(ctx,poly,ink(tone,a*.13));line(ctx,poly,w*.44,ink(tone,a*.24));line(ctx,poly,w*.09,ink(hi,a*.88));
   line(ctx,trace(.72,Math.PI/6,tau+Math.PI/6,6),w*.06,ink(tone,a*.61));
   poly.slice(0,6).forEach(p=>line(ctx,[p,{x:cx,y:cy}],w*.026,ink(hi,a*.37)));return;
 }
 const scales=shape==="pulse"?[.66,1]:shape==="gravity"?[.57,.78,1.05]:shape==="portal"?[.79,1,1.13]:[1];
 scales.forEach((scale,i)=>{
   const plane=shape==="gravity"?(i-1)*w*.3:0;
   stroke(scale,.44,tone,a*.16,0,tau,plane);stroke(scale,.16,tone,a*.63,0,tau,plane);
   stroke(scale,.062,hi,a*.87,-.62,shape==="orbit"?4.8:2.85,plane);
   if(shape==="pulse"||shape==="shock")stroke(scale*1.1,.04,tone,a*.48,.2,5.65,plane);
 });
 if(shape==="portal"||shape==="gravity"||shape==="orbit"){
   for(let i=0;i<(shape==="orbit"?13:25);i++){
     const ang=i*tau/(shape==="orbit"?13:25)+noise(i)*.15, q=emit(ang,1);
     if(shape==="orbit"){flare(ctx,q,w*(i%4===0?.39:.14)*q.s,hi,a*(i%4===0?.94:.7));}
     else if(shape==="gravity")line(ctx,[emit(ang,.63,-w*.35),q,{x:q.x,y:q.y+w*.35*q.s}],w*.043,ink(hi,a*.49));
     else line(ctx,[emit(ang,.73),emit(ang+.05,.93),emit(ang+.09,1.17)],w*.048,ink(i%3?tone:hi,a*.61));
   }
 }
}
export function paintFxLook(ctx:CanvasRenderingContext2D,s:FxStroke,W:number,H:number,preset:FxLook,vanish:XY=DEFAULT_VANISH){
 const a=s.intensity/100, t=(s.transform?.scale??100)/100, w=Math.min(W,H)*s.width/100*t;
 const tone=s.color,hi=preset.accent;
 if(preset.stroke==="ring"){rings(ctx,s,W,H,w,tone,hi,a,preset.shape,vanish);return;}
 const p=makeFxProjection(s,vanish,W/H).points.map(q=>({x:q.x*W,y:q.y*H,s:q.s}));
 if(preset.stroke==="crystal")grains(ctx,p,w,tone,hi,a,preset.shape);
 else paths(ctx,p,w,tone,hi,a,preset.shape);
}

