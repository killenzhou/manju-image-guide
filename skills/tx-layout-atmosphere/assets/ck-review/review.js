/* 踏星 CK 审核页 v2 — 对照板首页 · 本地 VLM 初审 · 达芬奇深色 · 仅最新版 */
const $=id=>document.getElementById(id);
const allRows=window.CK_DATA||[];
const episode=window.CK_EPISODE||'PROJECT';
document.title='踏星｜'+episode+' CK 审核';
{const h=document.querySelector('h1');if(h)h.textContent='踏星 · '+episode+' 场次 CK 审核'}
const SHOTS=window.CK_SHOTS||{};
const key='TX-'+episode+'-CK-review-v2';
const dims={layout:'构图站位',content:'美术地标',light:'光源明暗',material:'材质色调',effect:'表演特效'};
const dimShort={layout:'构',content:'物',light:'光',material:'质',effect:'效'};
const layers=[['file','成图'],['layout','Layout'],['storyboard','分镜'],['art','美术']];
const statusCls=s=>s==='通过'?'ok':s==='待确认'?'todo':'bad';

/* 只保留每个镜头的最新版本 */
const baseOf=id=>id.replace(/-v\d+.*$/,'');
const verOf=r=>{const m=r.id.match(/-v(\d+)/);return m?+m[1]:1};
const latest=new Map();
for(const r of allRows){const b=baseOf(r.id);const cur=latest.get(b);if(!cur||verOf(r)>verOf(cur))latest.set(b,r)}
const rows=allRows.filter(r=>latest.get(baseOf(r.id))===r);
const shotOf=r=>SHOTS[baseOf(r.id)]||{shot:baseOf(r.id),name:''};
const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const blank=()=>({basis:'',checks:{},feedback:'',evidence:'',marks:{},status:'待确认'});
const eligible=s=>['matched','none'].includes(s.basis)&&Boolean((s.evidence||'').trim())&&Object.keys(dims).every(k=>['ok','exception'].includes(s.checks[k]));
const record=(row,s)=>({...s,id:row.id,shot:shotOf(row).shot,version:row.version,sha256:row.sha256,source:row.source,t:row.t,file:row.file,artSource:row.artSource});
let db={};
try{db=JSON.parse(localStorage.getItem(key)||'{}')||{}}catch{}
/* 预载已归档审批记录（版本+哈希校验，本地草稿优先） */
try{
  const arch=window.CK_ARCHIVED;
  const recs=Array.isArray(arch)?arch:(arch?.records||[]);
  for(const rec of recs){
    const cur=rows.find(v=>v.id===rec.id);
    if(!cur||cur.version!==rec.version||cur.sha256!==rec.sha256||db[rec.id])continue;
    const s={...blank(),...rec};if(s.status==='通过'&&!eligible(s)&&!s.approvalSource)s.status='待确认';
    db[rec.id]=s;
  }
}catch{}
let idx=0,layer='file',mode='pen',stroke=null;
let cmp=false,cmpPct=50,z=1,tx=0,ty=0,pan=null,filter='all';

const row=()=>rows[idx];
const st=r=>db[r.id]??=blank();
const production=r=>r.qa?.version===r.version&&r.qa?.sha256===r.sha256&&eligible(r.qa)?r.qa:null;
const approved=r=>st(r).status==='通过'||Boolean(st(r).approvalSource);
const ready=(s,r)=>!r.hold&&(Boolean(production(r))||approved(r)||eligible(s));
const certify=(s,r)=>{const q=production(r);if(!q||eligible(s))return s;return {...s,basis:q.basis,checks:{...q.checks},evidence:q.evidence}};
const save=()=>{try{localStorage.setItem(key,JSON.stringify(db))}catch{}};
const marks=()=>st(row()).marks[layer]??=[];

/* ── 进度 + 胶片条 ── */
const film=$('film');
const thumbs=rows.map((r,i)=>{
  const t=document.createElement('div');t.className='thumb';t.title=r.id+' · '+shotOf(r).name;
  t.innerHTML='<img loading="lazy" alt=""><div class="lab"><span></span><i class="dot todo"></i></div>';
  t.querySelector('img').src=r.file;t.querySelector('span').textContent=shotOf(r).shot;
  t.onclick=()=>goto(i,'file');film.append(t);return t;
});
function counts(){let ok=0,bad=0,todo=0;for(const r of rows){const s=db[r.id]?.status||'待确认';s==='通过'?ok++:s==='待确认'?todo++:bad++}return{ok,bad,todo}}
function filmSync(){
  const c=counts();
  rows.forEach((r,i)=>{thumbs[i].querySelector('.dot').className='dot '+statusCls(db[r.id]?.status||'待确认');thumbs[i].classList.toggle('cur',i===idx)});
  $('pg-ok').textContent=c.ok;$('pg-bad').textContent=c.bad;$('pg-todo').textContent=c.todo;
  const fc=$('ov-filter');if(fc)for(const[k,v]of[['all',rows.length],['todo',c.todo],['ok',c.ok],['bad',c.bad]]){const b=fc.querySelector('[data-f="'+k+'"] b');if(b)b.textContent=v}
  thumbs[idx].scrollIntoView({block:'nearest',inline:'nearest'});
}

/* ── 图层页签 + 对比 ── */
const tabsEl=$('tabs');
const tabs=layers.map(([f,label])=>{
  const t=document.createElement('button');t.className='tab';
  t.innerHTML='<img alt=""><span>'+label+'</span>';
  t.dataset.f=f;t.onclick=()=>{if(cmp)return;layer=f;tabSync();img()};tabsEl.insertBefore(t,$('cmpBtn'));return t;
});
function tabSync(){
  const r=row();
  for(const t of tabs){const f=t.dataset.f,has=Boolean(r[f]);
    t.classList.toggle('active',!cmp&&f===layer);t.classList.toggle('no-img',!has);t.disabled=!has||cmp;
    t.querySelector('img').src=r[f]||''}
  if(!row()[layer])layer='file';
}

/* ── 看图：缩放 / 平移 / 对比杆 / 批注 ── */
const viewer=$('viewer'),frame=$('frame'),cv=$('canvas'),pic=$('annotImage'),cmpImg=$('cmpImg'),cmpBar=$('cmpBar');
function applyView(){frame.style.transform='translate('+tx+'px,'+ty+'px) scale('+z+')';cv.classList.toggle('off',cmp||z>1);$('zoomhint').hidden=z===1||cmp}
function syncCmp(){cmpImg.hidden=!cmp;cmpBar.hidden=!cmp;$('cmpTagL').hidden=!cmp;$('cmpTagR').hidden=!cmp;
  if(cmp){cmpImg.src=row().layout||row().file;setCmp(cmpPct)}applyView();tabSync();
  $('cmpBtn').classList.toggle('active',cmp)}
function setCmp(p){cmpPct=Math.max(2,Math.min(98,p));cmpImg.style.clipPath='inset(0 '+(100-cmpPct)+'% 0 0)';cmpBar.style.left=cmpPct+'%'}
function draw(){
  const box=cv.getBoundingClientRect();if(!box.width||!box.height)return;
  const scale=window.devicePixelRatio||1;
  cv.width=Math.round(box.width*scale);cv.height=Math.round(box.height*scale);
  const c=cv.getContext('2d'),w=cv.width,h=cv.height;
  for(const m of st(row()).marks[layer]||[]){
    c.strokeStyle=m.color;c.fillStyle=m.color;c.lineWidth=3*scale;c.lineJoin='round';c.lineCap='round';
    if(m.type==='pin'){c.beginPath();c.arc(m.x*w,m.y*h,12*scale,0,Math.PI*2);c.fill();c.fillStyle='#111';c.font='bold '+13*scale+'px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(m.n,m.x*w,m.y*h)}
    else{c.beginPath();m.points.forEach(([x,y],i)=>i?c.lineTo(x*w,y*h):c.moveTo(x*w,y*h));c.stroke()}
  }
}
function img(){const r=row();pic.src=r[layer]||r.file;if(cmp)cmpImg.src=r.layout||r.file}
pic.onload=draw;new ResizeObserver(draw).observe(pic);
pic.onclick=()=>{if(!cmp)window.open(pic.src,'_blank')};
let navLock=0;
function wheelNav(d){const n=Date.now();if(n-navLock<180)return;navLock=n;
  const step=d>0?1:-1;
  ov.style.display!=='none'?setCurrent(idx+step):show(idx+step)}
viewer.addEventListener('wheel',e=>{if(cmp)return;e.preventDefault();
  if(e.ctrlKey||e.altKey||e.metaKey||z>1){
    const nz=Math.max(1,Math.min(6,z*(e.deltaY<0?1.15:1/1.15)));
    if(nz===1){tx=ty=0}z=nz;applyView();draw()}
  else wheelNav(e.deltaY)},{passive:false});
film.addEventListener('wheel',e=>{e.preventDefault();wheelNav(e.deltaY)},{passive:false});
frame.addEventListener('pointerdown',e=>{
  if(!cmp&&z<=1)return;
  e.preventDefault();
  frame.setPointerCapture(e.pointerId);
  if(cmp)pan={cmp:true},moveCmp(e);
  else{pan={x:e.clientX-tx,y:e.clientY-ty};viewer.classList.add('panning')}
});
frame.addEventListener('dragstart',e=>e.preventDefault());
frame.addEventListener('pointermove',e=>{
  if(!pan)return;
  if(pan.cmp)moveCmp(e);
  else{tx=e.clientX-pan.x;ty=e.clientY-pan.y;applyView()}
});
frame.addEventListener('pointerup',frame.onpointercancel=()=>{pan=null;viewer.classList.remove('panning')});
function moveCmp(e){const b=frame.getBoundingClientRect();setCmp((e.clientX-b.left)/b.width*100)}
$('cmpBtn').onclick=()=>{cmp=!cmp;if(cmp){z=1;tx=ty=0}syncCmp()};
const pt=e=>{const b=cv.getBoundingClientRect();return[Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))]};
cv.onpointerdown=e=>{if(e.button!==0||cmp||z>1)return;const[x,y]=pt(e);cv.setPointerCapture(e.pointerId);
  if(mode==='pin'){marks().push({type:'pin',x,y,n:1+marks().filter(m=>m.type==='pin').reduce((n,m)=>Math.max(n,m.n),0),color:$('color').value});changed(row())}
  else{stroke={type:'pen',points:[[x,y],[x+.001,y]],color:$('color').value};marks().push(stroke)}draw()};
cv.onpointermove=e=>{if(stroke){stroke.points.push(pt(e));draw()}};
cv.onpointerup=cv.onpointercancel=()=>{if(stroke){stroke=null;changed(row())}};
$('undo').onclick=()=>{if(marks().length){marks().pop();changed(row());draw()}};
$('clear').onclick=()=>{if(marks().length&&confirm('清空当前图层批注？')){st(row()).marks[layer]=[];changed(row());draw()}};
for(const m of['pen','pin'])$(m).onclick=()=>{mode=m;$('pen').classList.toggle('active',m==='pen');$('pin').classList.toggle('active',m==='pin')};
$('pen').classList.add('active');

/* ── 行内审核控件（大图区与紧凑行共用） ── */
const ctlPaints=rows.map(()=>[]);
function mkCtl(r,i,big){
  const ctl=document.createElement('div');ctl.className='ov-ctl'+(big?' big':'');
  ctl.innerHTML='<div class="brow"><span class="st todo">待确认</span><span style="font-size:10px;color:var(--dim)">'+(r.hold?'已拦截':'')+'</span></div>'
    +'<textarea class="fb" placeholder="修改意见…"></textarea>'
    +'<select class="bs"><option value="">设计：待核对</option><option value="matched">设计：已核适用</option><option value="none">设计：无适用</option></select>'
    +'<div class="dimrow"></div>'
    +'<input type="text" class="evi" placeholder="核对依据…">'
    +'<div class="btnrow"><button class="okbtn">通过</button><button class="revbtn">退回</button><button class="vlmbtn" title="本地模型五维初审（Layout+美术+成图）">AI</button></div>'
    +'<div class="vlmc" hidden></div>';
  const dr=ctl.querySelector('.dimrow'),chips={};
  for(const k of Object.keys(dims)){
    const ch=document.createElement('button');ch.className='dimchip';ch.textContent=dimShort[k];ch.title=dims[k]+'（点击切换 待复核→符合→偏差→偏离）';
    ch.onclick=()=>{const s=st(r),seq=['','ok','fail','exception'];s.checks[k]=seq[(seq.indexOf(s.checks[k]||'')+1)%4];edit(r,i)};
    dr.append(ch);chips[k]=ch}
  const s=st(r);
  const fb=ctl.querySelector('.fb'),bs=ctl.querySelector('.bs'),evi=ctl.querySelector('.evi');
  fb.value=s.feedback||'';bs.value=s.basis||'';evi.value=s.evidence||'';
  fb.oninput=()=>{st(r).feedback=fb.value;edit(r,i)};
  bs.onchange=()=>{st(r).basis=bs.value;edit(r,i)};
  evi.oninput=()=>{st(r).evidence=evi.value;edit(r,i)};
  ctl.querySelector('.okbtn').onclick=()=>decide('通过',i);
  ctl.querySelector('.revbtn').onclick=()=>decide('退回修改',i);
  ctl.querySelector('.vlmbtn').onclick=()=>runVlm(r,i);
  const stEl=ctl.querySelector('.st'),okB=ctl.querySelector('.okbtn'),revB=ctl.querySelector('.revbtn'),vB=ctl.querySelector('.vlmbtn');
  ctlPaints[i].push(()=>{
    vB.textContent=vlmRunning.has(r.id)?'…':'AI';
    vlmFill(ctl.querySelector('.vlmc'),r,i);
    const s=st(r),cls=statusCls(s.status);
    stEl.textContent=s.status;stEl.className='st '+cls;
    okB.disabled=!ready(s,r);
    revB.disabled=!(s.feedback||'').trim()&&!Object.values(s.marks).some(v=>v.length);
    for(const k of Object.keys(dims))chips[k].className='dimchip '+(s.checks[k]||'');
    if(document.activeElement!==fb&&fb.value!==(s.feedback||''))fb.value=s.feedback||'';
  });
  return ctl;
}
function paintRow(i){for(const f of ctlPaints[i])f()}

/* ── 本地 VLM 初审（llama-server OpenAI 兼容接口）── */
const VLM_KEY='TX-vlm-cfg';
const vlmCfg=()=>{try{return{ep:'http://127.0.0.1:8765',model:'',...(JSON.parse(localStorage.getItem(VLM_KEY))||{})}}catch{return{ep:'http://127.0.0.1:8765',model:''}}};
const vlmRunning=new Set(),vlmState={online:false,model:''};
const VLM_J2K={'构图与画幅':'layout','内容与地标':'content','光源与明暗比':'light','材质与色调':'material','表演与特效遮挡':'effect'};
const VLM_V2C={ok:'ok',exception:'exception',problem:'fail'};
const VLM_VER={pass:['通过','pass'],hold:['待复核','hold'],reject:['退回','reject']};

const vlmStat=$('vlmstat');
async function vlmPing(){
  const cfg=vlmCfg();
  try{const r=await fetch(cfg.ep+'/v1/models',{signal:AbortSignal.timeout(3000)});
    const j=await r.json();const m=j.data?.[0]?.id||'';
    vlmState.online=true;vlmState.model=m;
    vlmStat.textContent='● '+((m.split(/[\\/]/).pop()||m).slice(0,22));vlmStat.className='on';
    vlmStat.title='本地初审在线：'+m+'\n'+cfg.ep+'（点击改地址）';
  }catch{vlmState.online=false;vlmState.model='';vlmStat.textContent='○ 本地初审';vlmStat.className='';vlmStat.title='本地初审离线：'+cfg.ep+'（点击改地址）'}
}
vlmStat.onclick=async()=>{const cfg=vlmCfg();
  const ep=prompt('本地模型 OpenAI 兼容地址',cfg.ep);
  if(ep){try{localStorage.setItem(VLM_KEY,JSON.stringify({...cfg,ep:ep.replace(/\/+$/,'')}))}catch{}}
  vlmPing()};

async function imgData(url){
  try{const b=await(await fetch(url)).blob();const bmp=await createImageBitmap(b);
    const m=Math.min(1,1568/Math.max(bmp.width,bmp.height));
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*m);c.height=Math.round(bmp.height*m);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.85)}catch{return null}
}
function vlmPrompt(r,hasArt){
  const sh=shotOf(r);
  return '你是影视镜头审核员。图1是 Layout 底图（构图/机位/空间基准）。'
    +(hasArt?'图2是美术设计图（已定光源、材质、造型基准）。':'')
    +'最后一张是 AI 渲染成图。\n\n镜头：'+sh.shot+(sh.name?' '+sh.name:'')+'，候选 '+r.id
    +(r.prompt?'。\n生成提示词：'+r.prompt.slice(0,400):'')
    +'\n\n请逐项核对成图是否落实了 Layout 的构图与要素'+(hasArt?'，以及美术设计的光源/材质/风格':'')
    +'，按 JSON 输出：\n{\n  "构图与画幅": {"verdict":"ok|exception|problem","依据":"…","问题":["…"]},\n  "内容与地标": {"verdict":"…","依据":"…","问题":[]},\n  "光源与明暗比": {"verdict":"…","依据":"…","问题":[]},\n  "材质与色调": {"verdict":"…","依据":"…","问题":[]},\n  "表演与特效遮挡": {"verdict":"…","依据":"…","问题":[]},\n  "整体": {"判定":"pass|hold|reject","首要问题":"…","给返修的一句话":"…"}\n}'
    +'\n只依据可见证据；看不清的写"超出分辨率可判范围"，不要猜。只输出 JSON。'
}
async function runVlm(r,i){
  if(vlmRunning.has(r.id))return;
  if(!vlmState.online)await vlmPing();
  if(!vlmState.online){st(r).vlm={error:'本地初审服务离线（'+vlmCfg().ep+'）'};save();paintRow(i);if(i===idx)vlmDetail(r);return}
  vlmRunning.add(r.id);paintRow(i);vlmDetail(r);
  try{
    const parts=[['Layout 底图',r.layout],['美术设计图',r.art],['成图',r.file]];
    const imgs=[],content=[{type:'text',text:vlmPrompt(r,Boolean(r.art))}];
    for(const[lab,u]of parts){const d=u&&await imgData(u);if(d)imgs.push({lab,d})}
    if(!imgs.length||imgs[imgs.length-1].lab!=='成图')throw Error('成图取不到，无法初审');
    for(const im of imgs)content.push({type:'image_url',image_url:{url:im.d}});
    const cfg=vlmCfg();
    const res=await fetch(cfg.ep+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:vlmState.model||cfg.model||'local',
        messages:[{role:'system',content:'你是严格的影视制作审核员，只依据可见证据做判断。'},{role:'user',content}],
        temperature:0.2,max_tokens:3000,chat_template_kwargs:{enable_thinking:false}}),
      signal:AbortSignal.timeout(180000)});
    if(!res.ok)throw Error('HTTP '+res.status);
    const j=await res.json();
    const txt=j.choices?.[0]?.message?.content||'';
    const a=txt.indexOf('{'),b=txt.lastIndexOf('}');
    if(a<0||b<=a)throw Error('模型未返回 JSON');
    st(r).vlm={t:Date.now(),v:JSON.parse(txt.slice(a,b+1)),nimg:imgs.length};
  }catch(e){st(r).vlm={error:String(e.message||e)}}
  vlmRunning.delete(r.id);save();paintRow(i);vlmDetail(r);
}
function vlmFill(el,r,i){
  const s=st(r),v=s.vlm;
  el.hidden=!v;
  if(!v){el.innerHTML='';return}
  if(v.error){el.innerHTML='<div class="verr">AI初审失败：'+esc(v.error)+'</div>';return}
  const d=v.v||{},o=d['整体']||{};
  const ver=String(o['判定']||'').toLowerCase();
  const[vt,vc]=VLM_VER[ver]||[o['判定']||'?','hold'];
  let dots='',detail='';
  for(const[jd,k]of Object.entries(VLM_J2K)){
    const dd=d[jd]||{},c=VLM_V2C[dd.verdict]||'';
    dots+='<span class="vdot '+c+'" title="'+esc(jd+'：'+(dd.verdict||'?')+'\n'+(dd['依据']||''))+'">'+dimShort[k]+'</span>';
    if(Object.keys(dd).length)detail+='【'+jd+'·'+(dd.verdict||'?')+'】'+(dd['依据']||'')+((dd['问题']||[]).length?'\n  · '+dd['问题'].join('\n  · '):'')+'\n';
  }
  el.innerHTML='<div class="vhead"><b style="color:var(--dim)">AI</b><span class="vver '+vc+'">'+vt+'</span>'
    +(v.nimg?'<span style="color:var(--dim);font-size:9px">'+v.nimg+'图</span>':'')
    +'<div class="vdots">'+dots+'</div></div>'
    +'<div class="vsum">'+esc(o['首要问题']||o['给返修的一句话']||'—')+'</div>'
    +'<div class="vdetail">'+esc(detail)+'</div>'
    +'<div class="vbtns"><button class="vadopt">采纳到核对</button><button class="vexp">详情▾</button></div>';
  el.querySelector('.vexp').onclick=()=>el.classList.toggle('open');
  el.querySelector('.vadopt').onclick=()=>{
    for(const[jd,k]of Object.entries(VLM_J2K)){const vv=d[jd]?.verdict;if(VLM_V2C[vv])s.checks[k]=VLM_V2C[vv]}
    const probs=Object.keys(VLM_J2K).flatMap(jd=>d[jd]?.['问题']||[]);
    s.evidence=('AI初审('+ver+')：'+(o['首要问题']||'各维通过')+(probs.length?'；'+probs.join('；'):'')).slice(0,500);
    edit(r,i);
  };
}
function vlmDetail(r){
  const el=$('vlmcard');if(!el)return;
  const i=rows.indexOf(r);if(i<0)return;
  vlmFill(el,r,i);
  $('vlmrun').textContent=vlmRunning.has(r.id)?'…':'AI';
}
let vlmAbort=false;
async function runVlmAll(btn){
  if(btn.dataset.on){vlmAbort=true;return}
  btn.dataset.on='1';vlmAbort=false;
  const pend=rows.map((r,i)=>[r,i]).filter(([r])=>!st(r).vlm||st(r).vlm.error);
  let n=0;
  for(const[r,i]of pend){
    if(vlmAbort)break;
    btn.textContent='AI '+(++n)+'/'+pend.length+'（点击停止）';
    await runVlm(r,i);
  }
  delete btn.dataset.on;btn.textContent='AI 全部';
}

/* ── 对照板：全部镜头等大同格式行 ── */
const ov=$('overview'),ovbtn=$('ovbtn');
const IC={grid:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
image:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-5 4 4 4-4 5 5"/></svg>'};
const idDots=[];
function imgCell(r,i,f){
  const c=document.createElement('div');c.dataset.shot=i;
  if(r[f]){c.className='ov-cell';c.innerHTML='<img loading="lazy" src="'+r[f]+'" alt=""><span class="tag">'+shotOf(r).shot+' · '+({'file':'成图',layout:'Layout',storyboard:'分镜',art:'美术'}[f])+'</span>';c.onclick=()=>goto(i,f)}
  else{c.className='ov-cell empty';c.textContent='无设计图'}
  return c;
}
function buildOv(){
  ov.innerHTML='';idDots.length=0;ctlPaints.forEach(a=>a.length=0);
  const fc=document.createElement('div');fc.className='ov-filter';fc.id='ov-filter';
  fc.innerHTML='<span class="ft">筛选</span>';
  for(const[k,t]of[['all','全部'],['todo','待确认'],['ok','通过'],['bad','退回']]){
    const b=document.createElement('button');b.className='fchip'+(k===filter?' active':'');b.dataset.f=k;
    b.innerHTML=t+' <b>0</b>';b.onclick=()=>{filter=k;applyFilter()};
    fc.append(b)}
  const ab=document.createElement('button');ab.className='fchip';ab.style.marginLeft='auto';ab.textContent='AI 全部';
  ab.title='本地模型逐镜初审（跳过已有结果）';ab.onclick=()=>runVlmAll(ab);fc.append(ab);
  ov.append(fc);
  const table=document.createElement('div');table.className='ov-table';
  table.insertAdjacentHTML('beforeend','<div class="ov-head">镜头号</div><div class="ov-head">成图</div><div class="ov-head">Layout</div><div class="ov-head">分镜</div><div class="ov-head">美术设计</div><div class="ov-head">审核</div>');
  const wraps=rows.map(()=>[]);
  rows.forEach((r,i)=>{
    const sh=shotOf(r);
    const idc=document.createElement('div');idc.className='ov-id';idc.dataset.shot=i;
    idc.innerHTML='<b>'+sh.shot+'</b><span class="sname">'+esc(sh.name)+'</span><span class="cand">'+r.id+'</span><i class="dot todo"></i>';
    idc.onclick=()=>setCurrent(i);table.append(idc);wraps[i].push(idc);
    idDots[i]=idc.querySelector('.dot');
    for(const[f]of layers){const c=imgCell(r,i,f);table.append(c);wraps[i].push(c)}
    const ctl=mkCtl(r,i,false);ctl.dataset.shot=i;table.append(ctl);wraps[i].push(ctl);
    paintRow(i);
  });
  ov.append(table);
  ov._wraps=wraps;
  applyFilter();filmSync();
}
function setCurrent(i){
  idx=Math.max(0,Math.min(rows.length-1,i));
  filmSync();applyFilter();
  (ov._wraps?.[idx]?.[0])?.scrollIntoView({block:'center',behavior:'smooth'});
}
function applyFilter(){
  for(const b of ov.querySelectorAll('.fchip'))b.classList.toggle('active',b.dataset.f===filter);
  (ov._wraps||[]).forEach((wrap,i)=>{
    const s=db[rows[i].id]?.status||'待确认';
    const vis=filter==='all'||(filter==='todo'&&s==='待确认')||(filter==='ok'&&s==='通过')||(filter==='bad'&&s!=='通过'&&s!=='待确认');
    for(const c of wrap)c.classList.toggle('cellhide',!vis);
  });
}
function ovToggle(on){
  ov.style.display=on?'':'none';ovbtn.classList.toggle('active',on);
  ovbtn.innerHTML=(on?IC.image+'返回单图':IC.grid+'全部对照');
  document.body.classList.toggle('board',on);
  if(on){applyFilter();filmSync()}
}
function goto(i,f){ovToggle(false);layer=rows[i][f]?f:'file';show(i)}
ovbtn.onclick=()=>ovToggle(ov.style.display==='none');

/* ── 细节面板 ── */
const dimBox=$('dimchecks');
for(const[k,label]of Object.entries(dims)){
  const l=document.createElement('label');l.textContent=label+'等一致性';
  const el=document.createElement('select');el.dataset.dim=k;
  for(const[v,t]of[['','待复核'],['ok','符合'],['fail','偏差待修'],['exception','已说明并接受偏离']])el.add(new Option(t,v));
  el.onchange=()=>{st(row()).checks[k]=el.value;edit(row(),idx)};l.append(el);dimBox.append(l);
}
const dimSel=k=>dimBox.querySelector('[data-dim="'+k+'"]');
for(const k of['basis','feedback','evidence'])$(k).oninput=()=>{st(row())[k]=$(k).value;edit(row(),idx)};
function changed(r){edit(r,rows.indexOf(r))}
const chipWords=['构图偏差','光源/明暗','材质/色调','特效阶段','多余元素','人物/姿态','地标不对','保留此项'];
for(const w of chipWords){const b=document.createElement('button');b.textContent=w;b.onclick=()=>{const t=$('feedback');t.value=(t.value?t.value+'；':'')+w;t.dispatchEvent(new Event('input'))};$('chips').append(b)}
function edit(r,i,reset=true){
  const s=st(r);
  if(reset&&s.status!=='待确认'){s.status='待确认';delete s.at}
  save();paintRow(i);if(i===idx)refresh();filmSync();
}
function refresh(){
  const r=row(),s=st(r);
  const cls=statusCls(s.status);
  const b=$('badge');b.textContent=s.status;b.className='badge '+cls;
  const prod=production(r);
  const g=$('gate');
  if(r.hold){g.textContent='拦截：'+r.hold;g.className='gate'}
  else if(prod||approved(r)||eligible(s)){g.textContent='自检已完成，可以审核。';g.className='gate free'}
  else{g.textContent='通过前需完成一致性核对（或留意见退回）。';g.className='gate'}
  $('approve').disabled=!ready(s,r);
  $('revise').disabled=!(s.feedback||'').trim()&&!Object.values(s.marks).some(v=>v.length);
  vlmDetail(r);filmSync();
}
function show(i){
  if(ov.style.display!=='none')ovToggle(false);
  idx=Math.max(0,Math.min(rows.length-1,i));const r=row(),s=certify(st(r),r),sh=shotOf(r);
  $('counter').textContent=sh.shot+' · '+r.id+' · '+(idx+1)+' / '+rows.length;
  $('sid').textContent=sh.shot+(sh.name?'　'+sh.name:'');
  $('meta').innerHTML='';
  const meta=[['候选号',r.id],['版本',r.version],['Layout 取证',typeof r.t==='number'?r.t+' s':(r.t||'—')],['尺寸',(Array.isArray(r.size)?r.size.join(' × '):String(r.size??'—'))],['来源',r.source]];
  for(const[k,v]of meta){const d=document.createElement('div');d.innerHTML='<span style="color:var(--dim)">'+k+'</span>　'+esc(v);$('meta').append(d)}
  const shx=document.createElement('code');shx.textContent='sha256 '+r.sha256.slice(0,16)+'…';$('meta').append(shx);
  $('note').textContent=r.note||'';
  $('holdbar').hidden=!r.hold;if(r.hold)$('holdbar').textContent='拦截：'+r.hold;
  $('feedback').value=s.feedback||'';$('basis').value=s.basis||'';$('evidence').value=s.evidence||'';
  for(const k of Object.keys(dims))dimSel(k).value=s.checks[k]||'';
  const hasArt=Boolean(r.art);
  $('art').hidden=!hasArt;if(hasArt)$('art').src=r.art;
  $('artSource').textContent=r.artSource||'暂无经核对的适用设计图';
  $('artNote').textContent=r.artNote||'';
  $('geninfo').innerHTML='';
  $('geninfo').innerHTML='<div style="color:var(--dim)">Prompt</div><div style="font-size:11px;color:var(--muted);max-height:120px;overflow:auto">'+esc(r.prompt||'')+'</div>'
    +'<div style="color:var(--dim);margin-top:6px">Refs</div><div style="font-size:11px;color:var(--muted)">'+esc((r.refs||[]).join('；')||'—')+'</div>'
    +(r.selfCheck?'<div style="color:var(--dim);margin-top:6px">制作自检</div><div style="font-size:11px;color:var(--warn)">'+esc(r.selfCheck)+'</div>':'');
  z=1;tx=ty=0;if(cmp){cmp=false;syncCmp()}applyView();tabSync();img();draw();refresh();
}
function exportRows(records,name){
  const blob=new Blob([JSON.stringify({schema:1,episode,records},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function decide(status,i){
  i=i??idx;const r=rows[i],s=st(r);
  if(status==='通过'&&!ready(s,r))return;
  if(status==='通过')Object.assign(s,certify(s,r));
  s.status=status;s.at=new Date().toISOString();save();
  paintRow(i);if(i===idx)refresh();filmSync();applyFilter();
  exportRows([record(r,s)],episode+'-CK-'+r.id+'-'+status+'.json');
  if(ov.style.display!=='none'){
    const n=rows.findIndex((x,j)=>j>i&&(db[x.id]?.status||'待确认')==='待确认');
    if(n>=0)(ov._wraps[n]?.[0]||$('ov-hero')).scrollIntoView({block:'center',behavior:'smooth'});
  }
}
$('approve').onclick=()=>decide('通过');
$('revise').onclick=()=>decide('退回修改');
$('vlmrun').onclick=()=>runVlm(row(),idx);
$('export').onclick=()=>exportRows(rows.filter(r=>db[r.id]).map(r=>record(r,db[r.id])),episode+'-CK-review.json');
$('nextTodo').onclick=()=>{
  const n=rows.findIndex((r,j)=>j>idx&&(db[r.id]?.status||'待确认')==='待确认');
  const m=n>=0?n:rows.findIndex(r=>(db[r.id]?.status||'待确认')==='待确认');
  if(m<0)return;
  if(ov.style.display!=='none'){setCurrent(m);(ov._wraps[m]?.[0]).scrollIntoView({block:'center',behavior:'smooth'})}
  else show(m);
};
$('import').onchange=async e=>{try{
  const f=e.target.files[0];if(!f)return;const x=JSON.parse(await f.text());
  if(x.schema!==1||x.episode!==episode||!Array.isArray(x.records))throw Error('记录格式或集号不匹配');
  let count=0;for(const rec of x.records){
    const cur=rows.find(v=>v.id===rec.id);if(!cur||cur.version!==rec.version||cur.sha256!==rec.sha256)continue;
    const s={...blank(),...rec};if(s.status==='通过'&&!eligible(s)&&!s.approvalSource)s.status='待确认';db[rec.id]=s;count++}
  if(!count)throw Error('没有匹配当前版本和成图哈希的记录（旧版本候选已不在本页）');
  save();buildOv();show(idx);
}catch(err){alert(err.message)}finally{e.target.value=''}};

/* 键盘 */
addEventListener('keydown',e=>{
  if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(ov.style.display==='none'&&marks().length){marks().pop();changed(row());draw()}return}
  if(e.key==='Escape'){
    if(ov.style.display!=='none')return;
    if(cmp)return $('cmpBtn').click();
    if(z>1){z=1;tx=ty=0;applyView();draw();return}
    return ovToggle(true);
  }
  const inBoard=ov.style.display!=='none';
  if(e.key==='ArrowLeft')inBoard?setCurrent(idx-1):show(idx-1);
  else if(e.key==='ArrowRight')inBoard?setCurrent(idx+1):show(idx+1);
  else if(e.key==='g'||e.key==='G'){inBoard?show(idx):ovToggle(true)}
  else if(e.key==='c'||e.key==='C'){if(!inBoard)$('cmpBtn').click()}
  else if(e.key==='n'||e.key==='N')$('nextTodo').click();
  else if(e.key>='1'&&e.key<='4'&&!inBoard&&!cmp){layer=layers[+e.key-1][0];tabSync();img()}
});

vlmPing();
buildOv();
show(0);
ovToggle(true);
