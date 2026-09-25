'use strict';
const $ = id => document.getElementById(id);
let session = sessionStorage.getItem('aula_session') || '', students = [], scanner = null;
let selected = null, operation = null, createPending = null, teacherPending = null, isBusy = false;
let account=null, teachers=[], selectedTeacherId='';
let groups=[],categories=[],assignments=[],awardCategory='';
const code = new URLSearchParams(location.hash.slice(1)).get('alumno');
const apiURL = window.AULA_CONFIG?.API_URL || '';
const uid = () => crypto.randomUUID();
const linkFor = token => { const u=new URL(location.href);u.search='';u.hash=new URLSearchParams({alumno:token}).toString();return u.href; };
function status(text='', error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function show(id){['login','teacher','student','setup'].forEach(x=>$(x).hidden=x!==id);}
async function api(action, data={}) {
  let res;
  try {
    res=await fetch(apiURL,{method:'POST',redirect:'follow',credentials:'omit',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,session,...data}),signal:AbortSignal.timeout(45000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const body=await res.json();
    if(!body.ok)throw new Error(body.error || 'No se pudo completar la acción.');
    return body.data;
  } catch(e) {
    if(e.message?.includes('Sesión vencida')) {session='';sessionStorage.removeItem('aula_session');students=[];teachers=[];account=null;stopCamera();$('roster').replaceChildren();$('teacherList').replaceChildren();$('teacherDialog').close();$('awardDialog').close();$('cardDialog').close();show('login');}
    if(e instanceof TypeError || e.name==='TimeoutError' || e instanceof SyntaxError)throw new Error('No se pudo confirmar la respuesta. Revisa tu conexión y que Apps Script esté implementado para «Cualquier persona». Puedes reintentar: la misma operación no sumará dos puntos.');
    throw e;
  }
}
async function busy(fn){if(isBusy)return;isBusy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message,true);}finally{isBusy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
const groupKey = s => s.groupId || 'unassigned';
const groupLabel = s => s.grade && s.group ? s.grade+'.º '+s.group : 'Sin asignar';
let activeGroup='';
function groupRanks(list){
  const ordered=[...list].sort((a,b)=>b.points-a.points || a.name.localeCompare(b.name,'es') || a.id.localeCompare(b.id));
  let last=null, rank=0;
  return ordered.map((s,i)=>{if(s.points!==last)rank=i+1;last=s.points;return {...s,rank};});
}
function fillSelect(id,options,current){const el=$(id);el.replaceChildren();options.forEach(o=>{const n=document.createElement('option');n.value=o.id;n.textContent=o.name;el.append(n);});if(options.some(o=>o.id===current))el.value=current;}
function categoryOptions(groupId){return categories.filter(c=>account?.role==='coordinator'||assignments.some(a=>a.teacherId===account.id&&a.groupId===groupId&&a.categoryId===c.id));}
function render(){
 const coord=account?.role==='coordinator';$('roleLabel').textContent=coord?'COORDINACIÓN':'MIS GRUPOS';$('accountName').textContent=account?account.name+' · '+account.username:'';$('coordinatorPanel').hidden=!coord;$('adminCatalogs').hidden=!coord;
 const list=$('teacherList');list.replaceChildren();
 if(coord){[{id:'',name:'Todos los grupos'},...teachers].forEach(t=>{const btn=document.createElement('button');btn.className='teacher-choice';btn.textContent=t.name;btn.setAttribute('aria-pressed',String(selectedTeacherId===t.id));btn.onclick=()=>{selectedTeacherId=t.id;activeGroup='';render();};list.append(btn);});}
 let visibleGroups=groups.filter(g=>!coord||!selectedTeacherId||assignments.some(a=>a.teacherId===selectedTeacherId&&a.groupId===g.id));
 visibleGroups.sort((a,b)=>Number(a.grade)-Number(b.grade)||a.group.localeCompare(b.group));
 if(!visibleGroups.some(g=>g.id===activeGroup))activeGroup=visibleGroups[0]?.id||'';
 $('groupsOwner').textContent='Grados y grupos';const tabs=$('groupTabs');tabs.replaceChildren();
 visibleGroups.forEach(g=>{const btn=document.createElement('button');btn.textContent=groupLabel(g);btn.setAttribute('role','tab');btn.setAttribute('aria-selected',String(g.id===activeGroup));btn.onclick=()=>{activeGroup=g.id;render();};tabs.append(btn);});
 fillSelect('pointCategory',categoryOptions(activeGroup),$('pointCategory').value);
 fillSelect('studentGroup',groups.map(g=>({id:g.id,name:groupLabel(g)})),$('studentGroup').value||activeGroup);
 $('studentOwner').textContent='El alumno pertenecerá al grupo seleccionado y tendrá un único QR.';
 const cat=$('pointCategory').value,catName=categories.find(c=>c.id===cat)?.name||'Sin categoría autorizada';
 const peers=students.filter(s=>s.groupId===activeGroup&&activeGroup).map(s=>({...s,points:s.categoryPoints?.[cat]||0})),ranked=groupRanks(peers);
 $('rankingTitle').textContent='Ranking · '+catName;$('groupCount').textContent=peers.length+' alumnos';$('rankingHint').textContent='Puntos de la categoría seleccionada. Los empates comparten posición.';
 const podium=$('podium');podium.replaceChildren();[1,2,3].forEach((rank,i)=>{const card=document.createElement('div');card.className='podium-card '+['gold','silver','bronze'][i];const winners=ranked.filter(s=>s.rank===rank&&s.points>0);card.textContent=['🥇','🥈','🥉'][i]+' '+(winners.length?winners.map(s=>s.name).join(', ')+' · '+winners[0].points+' puntos':'Por alcanzar');podium.append(card);});
 const roster=$('roster');roster.replaceChildren();if(!ranked.length)roster.textContent=visibleGroups.length?'Este grupo aún no tiene alumnos.':'Coordinación debe crear grupos y asignar permisos para comenzar.';
 ranked.forEach(s=>{const row=document.createElement('div');row.className='row'+(s.rank<=3&&s.points>0?' top-rank '+['gold','silver','bronze'][s.rank-1]:'');const pos=document.createElement('span');pos.textContent='#'+s.rank;const name=document.createElement('strong');name.textContent=s.name;const points=document.createElement('span');points.className='badge';points.textContent=s.points+' puntos';const qr=document.createElement('button');qr.className='secondary';qr.textContent='Ver QR';qr.onclick=()=>busy(()=>openCard(s));const plus=document.createElement('button');plus.textContent='+1';plus.onclick=()=>prepareAward(s);row.append(pos,name,points,qr,plus);roster.append(row);});
 if(coord)renderAdmin();
}
function renderAdmin(){
 fillSelect('assignmentTeacher',teachers,$('assignmentTeacher').value);const options=groups.map(g=>({id:g.id,name:groupLabel(g)}));['assignmentGroup','moveGroup'].forEach(id=>fillSelect(id,options,$(id).value));fillSelect('assignmentCategory',categories,$('assignmentCategory').value);fillSelect('movePupil',students.map(s=>({id:s.id,name:s.name+' · '+groupLabel(s)})),$('movePupil').value);
 const list=$('assignmentList');list.replaceChildren();assignments.forEach(a=>{const row=document.createElement('p');const t=teachers.find(t=>t.id===a.teacherId),g=groups.find(g=>g.id===a.groupId),c=categories.find(c=>c.id===a.categoryId);row.textContent=(t?.name||'Maestro inactivo')+' · '+(g?groupLabel(g):'Grupo')+' · '+(c?.name||'Categoría')+' ';const btn=document.createElement('button');btn.className='secondary';btn.textContent='Quitar permiso';btn.onclick=()=>{if(confirm('¿Quitar este permiso al maestro?'))busy(async()=>{await api('revoke',{id:a.id,operation:uid()});await refresh();status('Permiso retirado.');});};row.append(btn);list.append(row);});
}
async function refresh(){const d=await api('list');if(d.version!==4)throw new Error('Publica la nueva versión de Code.gs y ejecuta actualizarEstructura para usar grupos y categorías.');account=d.user;teachers=d.teachers;students=d.students;groups=d.groups;categories=d.categories;assignments=d.assignments;show('teacher');render();}
async function openCard(s){$('cardName').textContent=s.name;$('cardClass').textContent=groupLabel(s);$('studentLink').value=linkFor(s.code);await QRCode.toCanvas($('cardQR'),linkFor(s.code),{width:280,margin:2});$('cardDialog').showModal();}
function prepareAward(s){
 const cat=$('pointCategory').value;if(!cat||s.groupId!==activeGroup){status('Selecciona el grupo del alumno y una categoría autorizada.',true);return false;}
 selected=s;operation=uid();awardCategory=cat;$('awardName').textContent='Un punto para '+s.name+' · '+groupLabel(s)+' · '+categories.find(c=>c.id===cat).name;$('awardDialog').showModal();return true;
}
async function award(){
 const result=await api('award',{id:selected.id,operation,categoryId:awardCategory});
 $('awardDialog').close();selected=null;operation=null;await refresh();status('✓ Un punto para '+result.name+'. Total general: '+result.points+'.');
}
function resolveStudent(raw){let token=raw.trim();try{token=new URLSearchParams(new URL(token).hash.slice(1)).get('alumno')||token;}catch{}return students.find(s=>s.code===token);}
async function stopCamera(){const old=scanner;scanner=null;if(old){try{await old.stop();old.clear();}catch{}}$('stopScan').hidden=true;$('startScan').hidden=false;}
async function startCamera(){
  status('');$('startScan').hidden=true;$('stopScan').hidden=false;
  let captured=false;
  scanner=new Html5Qrcode('reader');
  try {await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},async raw=>{
    if(captured)return;captured=true;await stopCamera();
    const s=resolveStudent(raw);if(!s){status('El QR no pertenece a un alumno al que tengas acceso.',true);return;}
    if(!prepareAward(s))return;
    await busy(async()=>{try{await award();}catch(e){if(selected&&!$('awardDialog').open)$('awardDialog').showModal();throw e;}});
  },()=>{});}catch{await stopCamera();throw new Error('No se pudo abrir la cámara. Permite su uso en el navegador y abre la página con HTTPS. También puedes pegar el enlace.');}
}
async function refreshStudent(){const s=await api('student',{code});$('studentName').textContent='¡Hola, '+s.name+'!';$('points').textContent=s.points;$('studentClass').textContent=groupLabel(s);$('studentCategories').replaceChildren();(s.categories||[]).forEach(c=>{const p=document.createElement('p');p.textContent=c.name+': '+c.points+' puntos · '+(c.rank?'puesto #'+c.rank:'Sin grupo');$('studentCategories').append(p);});$('rank').textContent=s.rank==null?'Tu grupo aún no está asignado':'Tu posición en el grupo: #'+s.rank+' de '+s.total;await QRCode.toCanvas($('myQR'),linkFor(code),{width:280,margin:2});show('student');status('');}
$('loginForm').onsubmit=e=>{e.preventDefault();busy(async()=>{const d=await api('login',{username:$('username').value.trim().toLowerCase(),password:$('password').value});session=d.session;sessionStorage.setItem('aula_session',session);$('password').value='';await refresh();status('');});};
$('createForm').onsubmit=e=>{e.preventDefault();busy(async()=>{const name=$('name').value.trim(),groupId=$('studentGroup').value;if(!groupId)throw new Error('Selecciona un grupo autorizado.');if(!createPending||createPending.name!==name||createPending.groupId!==groupId)createPending={name,groupId,operation:uid()};const s=await api('create',createPending);activeGroup=groupId;createPending=null;$('name').value='';await refresh();await openCard(s);status('Alumno registrado.');});};
$('pointCategory').onchange=()=>render();
function adminForm(id,action,data){let pending=null;$(id).onsubmit=e=>{e.preventDefault();busy(async()=>{const values=data(),key=JSON.stringify(values);if(!pending||pending.key!==key)pending={key,operation:uid()};await api(action,{...values,operation:pending.operation});pending=null;await refresh();status('Cambios guardados.');});};}
adminForm('groupForm','createGroup',()=>({grade:$('newGrade').value,group:$('newGroup').value}));
adminForm('categoryForm','createCategory',()=>({name:$('categoryName').value}));
adminForm('assignmentForm','assign',()=>({teacherId:$('assignmentTeacher').value,groupId:$('assignmentGroup').value,categoryId:$('assignmentCategory').value}));
adminForm('moveForm','moveStudent',()=>({id:$('movePupil').value,groupId:$('moveGroup').value}));
$('refresh').onclick=()=>busy(async()=>{await refresh();status('Lista actualizada.');});
$('logout').onclick=()=>busy(async()=>{await stopCamera();try{await api('logout');}finally{session='';sessionStorage.removeItem('aula_session');students=[];teachers=[];account=null;selectedTeacherId='';$('roster').replaceChildren();$('teacherList').replaceChildren();$('podium').replaceChildren();show('login');}});
$('startScan').onclick=()=>busy(startCamera);$('stopScan').onclick=stopCamera;
$('lookupForm').onsubmit=e=>{e.preventDefault();const s=resolveStudent($('manual').value);if(s)prepareAward(s);else status('No se encontró ese alumno.',true);};
$('confirmAward').onclick=()=>busy(award);$('cancelAward').onclick=()=>{$('awardDialog').close();selected=null;operation=null;};
$('closeCard').onclick=()=>$('cardDialog').close();
$('copyLink').onclick=()=>busy(async()=>{await navigator.clipboard.writeText($('studentLink').value);status('Enlace copiado.');});
$('downloadQR').onclick=()=>{const a=document.createElement('a');a.download='QR-'+$('cardName').textContent.replace(/[^a-zA-Z0-9áéíóúñ]/gi,'_')+'.png';a.href=$('cardQR').toDataURL('image/png');a.click();};
$('newTeacher').onclick=()=>{$('teacherError').textContent='';$('teacherDialog').showModal();};
$('cancelTeacher').onclick=()=>{$('teacherDialog').close();$('teacherPassword').value='';teacherPending=null;};
$('teacherDialog').addEventListener('close',()=>{$('teacherPassword').value='';teacherPending=null;});
$('teacherForm').onsubmit=e=>{e.preventDefault();busy(async()=>{try{
 const name=$('teacherName').value.trim(),username=$('teacherUsername').value.trim().toLowerCase(),password=$('teacherPassword').value;
 if(!teacherPending||teacherPending.name!==name||teacherPending.username!==username)teacherPending={name,username,operation:uid()};
 const t=await api('createTeacher',{...teacherPending,password});if(!teachers.some(x=>x.id===t.id))teachers.push(t);selectedTeacherId=t.id;activeGroup='';$('teacherDialog').close();$('teacherForm').reset();render();status('Cuenta creada para '+t.name+'. Usuario: '+t.username+'. Entrega su contraseña de forma privada.');
 }catch(e){$('teacherError').textContent=e.message;throw e;}});};
$('refreshStudent').onclick=()=>busy(refreshStudent);
window.addEventListener('hashchange',()=>location.reload());
window.addEventListener('pagehide',()=>{if(scanner)scanner.stop().catch(()=>{});});
if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(apiURL))show('setup');
else if(code){status('Cargando tus puntos…');busy(refreshStudent);}
else if(session){status('Cargando tu clase…');busy(async()=>{await refresh();status('');});}
else show('login');
