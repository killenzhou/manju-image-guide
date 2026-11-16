from pathlib import Path
p=Path("web/src/App.tsx")
s=p.read_text(encoding="utf-8")
def change(a,b):
    global s
    assert s.count(a)==1, (s.count(a),a)
    s=s.replace(a,b)
change('import { zipSync', 'import { FxDraftStudio } from "./FxDraftStudio";\nimport { emptyDraft, isFxDraft, type FxDraft } from "./fx-draft-model";\nimport { zipSync')
change('geometry:GeometryControls; preserve:string;', 'geometry:GeometryControls; preserve:string; fxDraft?:FxDraft;')
change('typeof v.preserve!=="string")','typeof v.preserve!=="string" || (v.fxDraft!==undefined && !isFxDraft(v.fxDraft)))')
change('  const [quickMode, setQuickMode]', '  const [draftOpen,setDraftOpen]=useState(()=>new URLSearchParams(location.search).has("paint"));\n  const [fxDraft,setFxDraft]=useState<FxDraft>(emptyDraft);\n  const [draftKey,setDraftKey]=useState(0);\n  const [quickMode, setQuickMode]')
change('      setTxApplied({});', '      setFxDraft(emptyDraft());\n      setDraftKey(key=>key+1);\n      setTxApplied({});')
change('geometry:geometryControls,preserve,','geometry:geometryControls,preserve,...(fxDraft.strokes.length?{fxDraft}:{}),')
change('        setPreserve(project.preserve);','        setPreserve(project.preserve);\n        if(project.fxDraft){setFxDraft(project.fxDraft);setDraftOpen(true);}')
change('选技能、画引导，再提交出图。','可手绘真实特效草稿，也可选技能、画引导再提交出图。')
change('        <div className="paste-hint">', '        <button className="tx-demo" type="button" onClick={()=>{const sample=demoPayload();setDraftOpen(true);loadSource({...sample.session,effectHint:""},sample.sourceDataUrl);}}>用演示镜头试笔刷</button>\n        <div className="paste-hint">')
change('className="app-shell tx-shell" data-standalone','className="app-shell tx-shell" data-draft={draftOpen} data-standalone')
change('      <div className="top-actions">','      <div className="top-actions">\n        <button type="button" className="fxd-enter" onClick={()=>setDraftOpen(true)}>手绘草稿</button>')
change('    {preflightOpen ? <div className="preflight-panel"', '    {draftOpen&&<FxDraftStudio key={draftKey} image={sourceImage} fileName={session.sourceFileName} draft={fxDraft} onChange={setFxDraft} onSave={saveShot} onClose={()=>setDraftOpen(false)} onOpen={reopenShot}/>}\n    {preflightOpen ? <div className="preflight-panel"')
p.write_text(s,encoding="utf-8")

