import { describe, expect, it } from "vitest";
import {duplicateFx,emptyDraft,isFxDraft,translateFx,type FxStroke} from "../web/src/fx-draft-model";

const stroke:FxStroke={id:"ring-1",kind:"ring",points:[{x:.2,y:.3,p:.6},{x:.4,y:.4,p:.8}],color:"#123abc",width:5,intensity:80,angle:22,visible:true};
describe("FX draft persistence",()=>{
  it("accepts an empty scene and preserves editable marks",()=>{
    expect(isFxDraft(emptyDraft())).toBe(true);
    expect(isFxDraft(JSON.parse(JSON.stringify({version:1,strokes:[stroke]})))).toBe(true);
  });
  it("rejects invalid points, paint, width, and duplicated IDs",()=>{
    expect(isFxDraft({version:1,strokes:[stroke,stroke]})).toBe(false);
    expect(isFxDraft({version:1,strokes:[{...stroke,kind:"unknown"}]})).toBe(false);
    expect(isFxDraft({version:1,strokes:[{...stroke,width:999}]})).toBe(false);
    expect(isFxDraft({version:1,strokes:[{...stroke,points:[{x:NaN,y:.3,p:.4}]}]})).toBe(false);
  });
  it("duplicates independently and limits movement without stretching a stroke",()=>{
    const dup=duplicateFx(stroke,"ring-2");
    expect(dup.id).not.toBe(stroke.id);expect(dup.points[0].x).toBeGreaterThan(stroke.points[0].x);
    const moved=translateFx(stroke.points,100,-100);
    expect(moved[1].x).toBeCloseTo(1);
    expect(moved[0].y).toBeCloseTo(0);
    expect(moved[1].x-moved[0].x).toBeCloseTo(stroke.points[1].x-stroke.points[0].x);
  });
});

