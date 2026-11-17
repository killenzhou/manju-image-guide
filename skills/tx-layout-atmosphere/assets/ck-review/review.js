const $=id=>document.getElementById(id);
const rows=window.CK_DATA, episode=window.CK_EPISODE||'PROJECT', key='TX-'+episode+'-CK-'+rows[0].version;
const dims={layout:'构图、站位和画幅',content:'美术空间、地标和道具',light:'时段、光源方向和明暗',material:'材质、色调和雾层',effect:'表演／特效阶段和遮挡'};
const blank=()=>({basis:'',checks:{},feedback:'',evidence:'',marks:{},status:'待确认'});
const eligible=s=>['matched','none'].includes(s.basis)&&Boolean(s.evidence.trim())&&Object.keys(dims).every(k=>['ok','exception'].includes(s.checks[k]));
const record=(row,s)=>({...s,id:row.id,version:row.version,sha256:row.sha256,source:row.source,t:row.t,file:row.file,artSource:row.artSource});
let db={};
try{db=JSON.parse(localStorage.getItem(key)||'{}')||{}}catch{}
let row=rows[0],mode='pen',stroke=null;
const st=()=>db[row.id]??=blank();
const production=r=>r.qa?.version===r.version&&r.qa?.sha256===r.sha256&&eligible(r.qa)?r.qa:null;
function ready(s,r){return !r.hold&&(Boolean(production(r))||eligible(s))}
function certify(s,r){const q=production(r);if(!q||eligible(s))return s;
 return {...s,basis:q.basis,checks:{...q.checks},evidence:q.evidence};
}
function save(){try{localStorage.setItem(key,JSON.stringify(db))}catch{}}
function exportRows(records,name){
 const blob=new Blob([JSON.stringify({schema:1,episode,records},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
const list=$('review-list'), template=$('review-card');
function mount(row){
 const scope=document.createElement('article');
 scope.className='review-card';scope.id='shot-'+row.id;
 scope.append(template.content.cloneNode(true));
 for(const el of scope.querySelectorAll('[id]')){el.dataset.field=el.id;el.removeAttribute('id')}
 const $=name=>scope.querySelector('[data-field="'+name+'"]');
 const st=()=>db[row.id]??=blank();let mode='pen',stroke=null;
 for(const el of scope.querySelectorAll('img')){el.loading='lazy';el.decoding='async'}
 const pic=$('annotImage'); pic.width=row.size[0];pic.height=row.size[1];
 list.append(scope);
function refresh(){
 const s=st(); $('status').textContent='· '+s.status;
 $('gate').textContent=row.hold|| (ready(s,row)?'自检已完成，可以审核。':'制作自检待补，可先留意见或退回。');
 $('approve').disabled=!ready(s,row); $('revise').disabled=!s.feedback.trim()&&!Object.values(s.marks).some(v=>v.length);
}
function changed(){const s=st();if(s.status!=='待确认'){s.status='待确认';delete s.at}save();refresh()}
function draw(){
 const cv=$('canvas'),box=cv.getBoundingClientRect(); if(!box.width||!box.height)return;
 const scale=window.devicePixelRatio||1; cv.width=Math.round(box.width*scale);cv.height=Math.round(box.height*scale);
 const c=cv.getContext('2d'), w=cv.width,h=cv.height;
 for(const m of st().marks[$('layer').value]||[]){
  c.strokeStyle=m.color;c.fillStyle=m.color;c.lineWidth=3*scale;c.lineJoin='round';c.lineCap='round';
  if(m.type==='pin'){c.beginPath();c.arc(m.x*w,m.y*h,12*scale,0,Math.PI*2);c.fill();c.fillStyle='#111';c.font='bold '+13*scale+'px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(m.n,m.x*w,m.y*h)}
  else{c.beginPath();m.points.forEach(([x,y],i)=>i?c.lineTo(x*w,y*h):c.moveTo(x*w,y*h));c.stroke()}
 }
}
function layer(){if(!row[$('layer').value])$('layer').value='file';const img=$('annotImage');if($('layer').value==='file'){img.width=row.size[0];img.height=row.size[1]}else{img.removeAttribute('width');img.removeAttribute('height')}img.src=row[$('layer').value];draw()}
function show(){
 const s=st();$('shot').textContent=row.id+' · Layout '+row.t+' 秒 · '+row.size.join(' × ');
 $('note').textContent=row.note;
 for(const [img,field] of [['sb','storyboard'],['ly','layout'],['render','file']]){$(img).src=row[field];$(img+'Link').href=row[field]}
 $('art').hidden=!row.art; if(row.art){$('art').src=row.art;$('artLink').href=row.art}else{$('art').removeAttribute('src');$('artLink').removeAttribute('href')}
 $('artNote').textContent=row.artNote;$('artSource').textContent=row.artSource||'暂无经核对的适用设计图';
 const q=certify(s,row);for(const k of ['basis','feedback','evidence'])$(k).value=q[k];for(const k of Object.keys(dims))$('check-'+k).value=q.checks[k]||'';
 refresh();layer();
}
for(const [k,label] of Object.entries(dims)){
 const l=document.createElement('label');l.textContent=label;const el=document.createElement('select');el.dataset.field='check-'+k;
 for(const [v,t] of [['','待复核'],['ok','符合'],['fail','偏差待修'],['exception','已说明并接受偏离']])el.add(new Option(t,v));
 el.onchange=()=>{st().checks[k]=el.value;changed()};l.append(el);$('checks').append(l);
}
for(const k of ['basis','feedback','evidence'])$(k).oninput=()=>{st()[k]=$(k).value;changed()};
$('layer').onchange=layer;$('annotImage').onload=draw;new ResizeObserver(draw).observe($('annotImage'));
for(const m of ['pen','pin'])$(m).onclick=()=>{mode=m;for(const v of ['pen','pin'])$(v).classList.toggle('active',m===v)};
$('pen').click();
const cv=$('canvas'),marks=()=>st().marks[$('layer').value]??=[];
function pt(e){const b=cv.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))]}
cv.onpointerdown=e=>{if(e.button!==0)return;const [x,y]=pt(e);cv.setPointerCapture(e.pointerId);if(mode==='pin'){marks().push({type:'pin',x,y,n:1+marks().filter(m=>m.type==='pin').reduce((n,m)=>Math.max(n,m.n),0),color:$('color').value});changed()}else{stroke={type:'pen',points:[[x,y],[x+.001,y]],color:$('color').value};marks().push(stroke)}draw()};
cv.onpointermove=e=>{if(stroke){stroke.points.push(pt(e));draw()}};
cv.onpointerup=cv.onpointercancel=()=>{if(stroke){stroke=null;changed()}};
$('undo').onclick=()=>{if(marks().length){marks().pop();changed();draw()}};
$('clear').onclick=()=>{if(marks().length&&confirm('清空当前图层批注？')){st().marks[$('layer').value]=[];changed();draw()}};
function decide(status){
 const s=st();if(status==='通过'&&!ready(s,row))return;
 if(status==='通过') Object.assign(s,certify(s,row));
 s.status=status;s.at=new Date().toISOString();save();refresh();exportRows([record(row,s)],episode+'-CK-'+row.id+'-'+status+'.json');
}
$('approve').onclick=()=>decide('通过');$('revise').onclick=()=>decide('退回修改');

show(); return show;
}
const cards=rows.map(mount);
$('export').onclick=()=>exportRows(rows.filter(r=>db[r.id]).map(r=>record(r,db[r.id])),episode+'-CK-review.json');
$('import').onchange=async e=>{try{
 const f=e.target.files[0];if(!f)return;const x=JSON.parse(await f.text());if(x.schema!==1||x.episode!==episode||!Array.isArray(x.records))throw Error('记录格式或集号不匹配');
 let count=0;for(const r of x.records){const current=rows.find(v=>v.id===r.id);if(!current||current.version!==r.version||current.sha256!==r.sha256)continue;
 const s={...blank(),...r};if(s.status==='通过'&&!eligible(s))s.status='待确认';db[r.id]=s;count++}
 if(!count)throw Error('没有匹配当前版本和成图哈希的记录');save();cards.forEach(show=>show());
 }catch(err){alert(err.message)}finally{e.target.value=''}};
