from pathlib import Path
def edit(path,pairs):
    p=Path(path)
    s=p.read_text(encoding="utf-8")
    for a,b in pairs:
        assert s.count(a)==1,(a,s.count(a))
        s=s.replace(a,b)
    p.write_text(s,encoding="utf-8")

edit("web/src/App.tsx", [
('import { FxDraftStudio } from "./FxDraftStudio";','import { FxDraftStudio } from "./FxDraftStudio";\nimport { describeDraftForCodex, rasterizeDraftForCodex } from "./fx-draft-handoff";'),
('function downloadDataUrl(dataUrl:', '''async function deliverVfxRequest(app:McpApp, request:{requestId:string}, content:ContentBlock[], prompt:string) {
  const capabilities=app.getHostCapabilities() || {};
  if(capabilities.updateModelContext?.text && capabilities.updateModelContext?.image){
    await app.updateModelContext({content,structuredContent:{vfxDirectorInlineRequest:request}});
    const result=await app.sendMessage({role:"user",content:[{type:"text",text:prompt}]});
    if(result.isError)throw new Error("Codex 未接收这次请求，请重试。");
  }else if(capabilities.message?.text && capabilities.message?.image){
    const result=await app.sendMessage({role:"user",content});
    if(result.isError)throw new Error("Codex 未接收这次请求，请重试。");
  }else throw new Error("请在支持图片提交的 Codex 对话中重新打开工作台。");
}

function downloadDataUrl(dataUrl:'''),
('  const [draftKey,setDraftKey]=useState(0);','''  const [draftKey,setDraftKey]=useState(0);
  const [draftSend,setDraftSend]=useState<{busy:boolean; text:string; error?:boolean}>({busy:false,text:""});
  const sendDraftLock=useRef(false);'''),
('      setDraftKey(key=>key+1);','      setDraftKey(key=>key+1);\n      setDraftSend({busy:false,text:""});'),
('''      const hostCapabilities = app.getHostCapabilities() || {};
      if (hostCapabilities.updateModelContext?.text && hostCapabilities.updateModelContext?.image) {
        await app.updateModelContext({ content: contextContent, structuredContent: { vfxDirectorInlineRequest: request } });
        const result = await app.sendMessage({ role: "user", content: [{ type: "text", text: `请使用 $tx-vfx-director 直接生成并在对话中展示这张踏星特效图。严格使用本次 VFX Director v2 inline request 附带的干净源图、引导和候选参考，保护非目标区域。无需导出或让我重复描述。Request ID: ${requestId}` }] });
        if (result.isError) throw new Error("Codex 拒绝了 VFX 请求");
      } else if (hostCapabilities.message?.text && hostCapabilities.message?.image) {
        const result = await app.sendMessage({ role: "user", content: contextContent });
        if (result.isError) throw new Error("Codex 拒绝了 VFX 请求");
      } else throw new Error("当前 Codex 版本不支持从编辑器提交图片，请更新 Codex");''','''      await deliverVfxRequest(app,request,contextContent,`请使用 $tx-vfx-director 直接生成并在对话中展示这张踏星特效图。严格使用本次 VFX Director v2 inline request 附带的干净源图、引导和候选参考，保护非目标区域。无需导出或让我重复描述。Request ID: ${requestId}`);'''),
('  const saveShot = () => {','''  const submitHandDraft=useCallback(async()=>{
    if(sendDraftLock.current || submitting)return;
    if(STANDALONE){
      setDraftSend({busy:false,error:true,text:"这个页面是独立预览。请在 Codex 对话里打开「踏星特效工作台」，在手绘页直接出图；不需要导出出图包。"});
      return;
    }
    if(!app || !session || !sourceImage || !sourceDataUrl){
      setDraftSend({busy:false,error:true,text:"编辑器还没连接到 Codex 对话，请从对话重新打开工作台。"});
      return;
    }
    sendDraftLock.current=true;
    const loadId=loadingId.current;
    setDraftSend({busy:true,text:"正在发送镜头、手绘草稿和遮挡…"});
    try{
      const visible=describeDraftForCodex(fxDraft);
      if(!visible.length)throw new Error("请先画一层可见特效。");
      const rendered=rasterizeDraftForCodex(sourceImage,fxDraft);
      const requestId=crypto.randomUUID();
      const effectDescription="按手绘合成稿精修以下效果："+visible.map(l=>l.name).join("、")+"。保留草稿的落点、主轮廓、透视与遮挡，只提升材质、亮暗层次和局部细节。";
      const group={...createEffectGroup(0,effectDescription),name:"手绘特效草稿",palette:visible.map(l=>l.tone).filter((v,i,a)=>a.indexOf(v)===i).join("、"),allowLighting:false,allowHaze:false,allowBloom:false,allowReflection:false};
      const renderPlan=buildRenderPlan([group],[]);
      const brief:VfxBrief={effectDescription,renderStage:"action",stageIntent:{anticipation:"",action:effectDescription,dissipation:""},palette:group.palette,preserve:preserve.trim()||DEFAULT_PRESERVE,allowLighting:false,allowHaze:false,allowBloom:false,allowReflection:false};
      const request={schemaVersion:"vfx-director-inline/v2",mode:"hand-draft-refine",requestId,...(parentBranch?{txParentRequestId:parentBranch}:{}),source:{imageNumber:1,fileName:session.sourceFileName,width:sourceImage.naturalWidth,height:sourceImage.naturalHeight},guides:{annotatedImageNumber:2,influenceImageNumber:3,protectionImageNumber:4,draftAlphaImageNumber:5,guideWidth:rendered.width,guideHeight:rendered.height},draft:{visibleLayers:visible,hasProtection:rendered.hasProtection},targets:[],effectGroups:[group],references:[],annotations:[],textLayers:[],brief,renderPlan};
      const instruction="使用第 1 张干净源图作为唯一编辑底图，第 2 张为手绘合成草稿，第 3 张白亮部分为实际特效足迹，第 4 张白亮部分为保护区，第 5 张为独立透明特效草稿（不是文字层）。照手绘主形精修，保留起点、路径、透视、前后遮挡与画幅；其余场景、人物、机位和原有文字保持。第 4 张已扣除用户明确放在遮挡前的笔迹占位，仅在该足迹内保留前景特效。不要生成全屏发光、标注、蒙版、手柄或界面。直接在当前对话展示成图，不让用户下载或上传工程。";
      const content:ContentBlock[]=[
        {type:"text",text:`VFX Director inline request\n${JSON.stringify(request)}\n${instruction}`},
        imageContent(sourceDataUrl),imageContent(rendered.guide),imageContent(rendered.influence),imageContent(rendered.protect),imageContent(rendered.alpha),
      ];
      await deliverVfxRequest(app,request,content,`请使用 $tx-vfx-director 直接按这次手绘特效草稿精修镜头，并在当前对话展示生成结果。使用 inline 请求的干净源图、手绘合成稿、影响区、保护区和透明草稿；不需要我再导出工程。Request ID: ${requestId}`);
      if(loadId!==loadingId.current)return;
      setBranches(current=>[...current,{id:requestId,parent:parentBranch,name:"手绘特效精修",delivery:"host",width:sourceImage.naturalWidth,height:sourceImage.naturalHeight}]);
      setDraftSend({busy:false,text:"已发送到 Codex，等待对话出图。草稿已保留。"});
    }catch(e){
      if(loadId===loadingId.current)setDraftSend({busy:false,error:true,text:e instanceof Error?e.message:"草稿提交失败，请重试。"});
    }finally{sendDraftLock.current=false;}
  },[app,fxDraft,parentBranch,preserve,session,sourceDataUrl,sourceImage,submitting]);

  const saveShot = () => {'''),
('draft={fxDraft} onChange={setFxDraft} onSave={saveShot}','draft={fxDraft} onChange={next=>{setFxDraft(next);if(!sendDraftLock.current)setDraftSend({busy:false,text:""});}} onGenerate={()=>void submitHandDraft()} generation={draftSend} onSave={saveShot}'),
])

edit("web/src/FxDraftStudio.tsx", [
('onChange:(d:FxDraft)=>void; onSave:','onChange:(d:FxDraft)=>void; onGenerate:()=>void; generation:{busy:boolean;text:string;error?:boolean}; onSave:'),
('{image,fileName,draft,onChange,onSave,onClose,onOpen}','{image,fileName,draft,onChange,onGenerate,generation,onSave,onClose,onOpen}'),
('''      <div role="status">{status}</div><button type="button" disabled={exporting||!draft.strokes.some(s=>s.kind==="occlude"&&s.visible)}''','''      <div role="status" data-error={Boolean(generation.error)}>{generation.text||status}</div><button type="button" disabled={exporting||!draft.strokes.some(s=>s.kind==="occlude"&&s.visible)}'''),
('''    </footer>
  </section>;''','''      <button className="fxd-generate" type="button" disabled={generation.busy||!draft.strokes.some(s=>s.kind!=="occlude"&&s.visible&&s.intensity>0)} onClick={onGenerate}>{generation.busy?"正在发送…":"直接出图"}</button>
    </footer>
  </section>;''')
])

