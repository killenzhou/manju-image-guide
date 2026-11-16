import {FX_BRUSHES,renderFxDraft,type FxDraft} from "./fx-draft-model";
import {getFxLook} from "./fx-depth-presets";

type Raster={canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D};
function raster(width:number,height:number,read=false):Raster {
  const canvas=document.createElement("canvas");
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext("2d",read?{willReadFrequently:true}:undefined);
  if(!ctx)throw new Error("未能创建草稿预览，请重新打开镜头。");
  return {canvas,ctx};
}
function grayscaleFromAlpha({ctx,canvas}:Raster,gain:number) {
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  const data=pixels.data;
  let visible=false;
  for(let i=0;i<data.length;i+=4){
    const a=data[i+3]; if(a)visible=true;
    data[i]=data[i+1]=data[i+2]=Math.min(255,a*gain);data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  return visible;
}

export function rasterizeDraftForCodex(source:HTMLImageElement,draft:FxDraft) {
  const scale=Math.min(1,1600/Math.max(source.naturalWidth,source.naturalHeight));
  const width=Math.max(1,Math.round(source.naturalWidth*scale)),height=Math.max(1,Math.round(source.naturalHeight*scale));
  const fx=raster(width,height);
  renderFxDraft(fx.ctx,width,height,draft.strokes,"fx",draft.vanish);
  const influence=raster(width,height,true);
  influence.ctx.drawImage(fx.canvas,0,0);
  if(!grayscaleFromAlpha(influence,4))throw new Error("草稿中没有可见特效。请显示至少一层，或检查是否被遮挡或移出画面。");
  const protect=raster(width,height,true);
  renderFxDraft(protect.ctx,width,height,draft.strokes,"mask",draft.vanish);
  const front=draft.strokes.filter(s=>s.visible&&s.kind!=="occlude"&&s.depth?.front&&s.intensity>0);
  if(front.length&&draft.strokes.some(s=>s.visible&&s.kind==="occlude")){
    const frontRaster=raster(width,height);
    renderFxDraft(frontRaster.ctx,width,height,front,"fx",draft.vanish);
    // A foreground stroke overrides the hand-painted occlusion only in its own footprint.
    protect.ctx.globalCompositeOperation="destination-out";
    protect.ctx.drawImage(frontRaster.canvas,0,0);
    protect.ctx.globalCompositeOperation="source-over";
  }
  const hasProtection=grayscaleFromAlpha(protect,1);
  const guide=raster(width,height);
  guide.ctx.drawImage(source,0,0,width,height);
  guide.ctx.drawImage(fx.canvas,0,0);
  return {width,height,hasProtection,guide:guide.canvas.toDataURL("image/png"),influence:influence.canvas.toDataURL("image/png"),protect:protect.canvas.toDataURL("image/png"),alpha:fx.canvas.toDataURL("image/png")};
}
export function describeDraftForCodex(draft:FxDraft){
  return draft.strokes.filter(s=>s.visible&&s.kind!=="occlude"&&s.intensity>0).map((s,index)=>{
    const look=getFxLook(s.preset);
    const name=look ? [look.character,look.name].filter(Boolean).join(" · ") : FX_BRUSHES.find(brush=>brush.id===s.kind)?.label??"手绘特效";
    return {order:index+1,name,shape:look?.shape??s.kind,tone:s.color,intensity:s.intensity,
      ...(look?.stage?{designNote:look.stage}:{}),
      ...(s.depth?{depth:{...s.depth}}:{}),
      ...(s.transform?{transform:{...s.transform}}:{})};
  });
}

