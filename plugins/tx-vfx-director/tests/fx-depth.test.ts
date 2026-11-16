import {describe,expect,it} from "vitest";
import {FX_GENERAL,FX_TX} from "../web/src/fx-depth-presets";
import {cubicFx,DEFAULT_VANISH,makeFxCurve,makeFxProjection,splitFxCurve} from "../web/src/fx-depth-geometry";
import {isFxDraft,moveFxStroke,type FxStroke} from "../web/src/fx-draft-model";

const points=[{x:.25,y:.52,p:.58},{x:.43,y:.52,p:.58},{x:.65,y:.52,p:.58}];
const mark:FxStroke={id:"s",kind:"ribbon",color:"#abc123",width:7,intensity:90,angle:0,visible:true,points};
describe("FX curves, depth, and form presets",()=>{
 it("ships 20 distinct generic geometries plus documented character recipes",()=>{
   expect(FX_GENERAL.length).toBe(20);expect(new Set(FX_GENERAL.map(s=>s.shape)).size).toBe(20);
   expect(FX_TX.length).toBe(10);expect(FX_TX.every(s=>s.character&&s.stage)).toBe(true);
   expect(new Set([...FX_GENERAL,...FX_TX].map(s=>s.id)).size).toBe(30);
 });
 it("splits a cubic without distorting the existing curve",()=>{
   const curve=makeFxCurve(points), next=splitFxCurve(curve,0,.42), a=cubicFx(curve[0],curve[1],.33),b=cubicFx(next[0],next[1],.33/.42);
   expect(next.length).toBe(curve.length+1);expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10);
 });
 it("retains the first placement and pulls farther points closer to the vanishing direction",()=>{
   const flat=makeFxProjection(mark),far=makeFxProjection({...mark,depth:{from:0,to:80,tilt:0,yaw:0,front:false}});
   expect(far.points[0].x).toBeCloseTo(flat.points[0].x,10);
   expect(far.points.at(-1)!.s).toBeLessThan(flat.points.at(-1)!.s);
   expect(far.points.at(-1)!.x).toBeLessThan(flat.points.at(-1)!.x);
 });
 it("round trips projection and moves the full editable layer",()=>{
   const s={...mark,curve:makeFxCurve(points),transform:{scale:147,rotate:33},depth:{from:-30,to:62,tilt:18,yaw:8,front:true}};
   const p=makeFxProjection(s,DEFAULT_VANISH,2.1),q=p.inverse(p.point(points[1],.55),.55);
   expect(q.x).toBeCloseTo(points[1].x,10);expect(q.y).toBeCloseTo(points[1].y,10);
   const moved=moveFxStroke(s,.08,-.04);
   expect(moved.curve![0].x).toBeCloseTo(s.curve[0].x+.08,10);expect(moved.depth).toEqual(s.depth);
   expect(isFxDraft({version:1,vanish:{x:.53,y:.52},strokes:[moved]})).toBe(true);
 });
});

