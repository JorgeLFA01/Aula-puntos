'use strict';
const $ = id => document.getElementById(id);
let session = sessionStorage.getItem('aula_session') || '', students = [], scanner = null;
let selected = null, operation = null, createPending = null, teacherPending = null, isBusy = false;
let account=null, teachers=[], selectedTeacherId='';
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
const groupKey = s => s.grade && s.group ? s.grade+'|'+s.group : 'unassigned';
const groupLabel = s => s.grade && s.group ? s.grade+'° '+s.group : 'Sin asignar';
let activeGroup='';
function groupRanks(list){
  const ordered=[...list].sort((a,b)=>b.points-a.points || a.name.localeCompare(b.name,'es') || a.id.localeCompare(b.id));
  let last=null, rank=0;
  return ordered.map((s,i)=>{if(s.points!==last)rank=i+1;last=s.points;return {...s,rank};});
}
function render(){
  renderStaff();
  const visibleStudents=students.filter(s=>(s.teacherId||'')===selectedTeacherId);
  const roster=$('roster'),tabs=$('groupTabs'),podium=$('podium');roster.replaceChildren();tabs.replaceChildren();podium.replaceChildren();
  const groups=[...new Map(visibleStudents.map(s=>[groupKey(s),s])).entries()].sort((a,b)=>{if(a[0]==='unassigned')return 1;if(b[0]==='unassigned')return -1;return Number(a[1].grade)-Number(b[1].grade)||a[1].group.localeCompare(b[1].group,'es',{numeric:true});});
  if(!groups.some(([key])=>key===activeGroup))activeGroup=groups[0]?.[0]||'';
  groups.forEach(([key,s],i)=>{
    const tab=document.createElement('button');tab.type='button';tab.id='group-tab-'+i;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','groupPanel');tab.setAttribute('aria-selected',String(activeGroup===key));tab.tabIndex=activeGroup===key?0:-1;tab.textContent=groupLabel(s);tab.onclick=()=>{activeGroup=key;render();$('groupTabs').querySelector('[aria-selected=true]')?.focus();};
    tab.onkeydown=e=>{const offset=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;let target=i;if(offset)target=(i+offset+groups.length)%groups.length;else if(e.key==='Home')target=0;else if(e.key==='End')target=groups.length-1;else return;e.preventDefault();activeGroup=groups[target][0];render();$('groupTabs').querySelector('[aria-selected=true]')?.focus();};
    tabs.append(tab);if(activeGroup===key)$('groupPanel').setAttribute('aria-labelledby',tab.id);
  });
  const peers=visibleStudents.filter(s=>groupKey(s)===activeGroup), ranked=groupRanks(peers);
  $('rankingTitle').textContent=peers.length?'Ranking · '+groupLabel(peers[0]):'Ranking del grupo';
  $('groupCount').textContent=peers.length+' alumnos';
  $('rankingHint').textContent=activeGroup==='unassigned'?'Completa Grado y Grupo en las columnas E y F de tu hoja y pulsa Actualizar.':peers.length?'Los empates comparten posición. El top 3 destaca a quienes tienen puntos en los puestos 1, 2 y 3.':'';
  if(!visibleStudents.length){roster.textContent='Este maestro aún no tiene alumnos. Registra el primero con grado y grupo.';$('groupPanel').removeAttribute('aria-labelledby');return;}
  if(activeGroup!=='unassigned'){
    const medals=['🥇','🥈','🥉'],classes=['gold','silver','bronze'];
    [1,2,3].forEach((position,i)=>{const winners=ranked.filter(s=>s.rank===position && s.points>0),card=document.createElement('div');card.className='podium-card '+(winners.length?classes[i]:'');
      const place=document.createElement('span');place.className='place';place.textContent=medals[i]+' '+position+'.º';
      const names=document.createElement('div');if(winners.length)winners.forEach(w=>{const n=document.createElement('strong');n.textContent=w.name;names.append(n);});else names.textContent=ranked.some(s=>s.rank<position&&s.points>0)&&ranked.filter(s=>s.points>0).length>=position?'Puesto compartido arriba':'Por alcanzar';
      const points=document.createElement('p');points.textContent=winners.length?winners[0].points+' puntos':'—';card.append(place,names,points);podium.append(card);
    });
  }
  ranked.forEach(s=>{
    const row=document.createElement('div');row.className='row';const highlight=activeGroup!=='unassigned'&&s.rank<=3&&s.points>0;if(highlight)row.className+=' top-rank '+['gold','silver','bronze'][s.rank-1];
    const position=document.createElement('span');position.className='rank-position';position.textContent=activeGroup==='unassigned'?'—':'#'+s.rank;
    const name=document.createElement('strong');name.className='roster-name';name.textContent=s.name;
    const points=document.createElement('span');points.className='badge';points.textContent=s.points+' puntos';
    const qr=document.createElement('button');qr.className='secondary';qr.textContent='Ver QR';qr.onclick=()=>busy(()=>openCard(s));
    const plus=document.createElement('button');plus.textContent='+1';plus.setAttribute('aria-label','Sumar un punto a '+s.name);plus.onclick=()=>prepareAward(s);
    row.append(position,name,points,qr,plus);roster.append(row);
  });
}
function renderStaff(){
  const coordinator=account?.role==='coordinator';$('roleLabel').textContent=coordinator?'COORDINACIÓN':'MIS GRUPOS';$('accountName').textContent=account?account.name+' · '+account.username:'';$('coordinatorPanel').hidden=!coordinator;
  if(!coordinator)selectedTeacherId=account?.id||'';
  else if(!teachers.some(t=>t.id===selectedTeacherId)&&!(selectedTeacherId===''&&students.some(s=>!s.teacherId)))selectedTeacherId=teachers[0]?.id||'';
  const options=[...teachers];if(coordinator&&students.some(s=>!s.teacherId))options.push({id:'',name:'Sin maestro asignado',username:''});
  const list=$('teacherList');list.replaceChildren();
  if(coordinator){
    if(!options.length)list.textContent='Agrega el primer maestro para comenzar.';
    options.forEach(t=>{const pupils=students.filter(s=>(s.teacherId||'')===t.id),groups=new Set(pupils.map(groupKey));const button=document.createElement('button');button.className='teacher-choice';button.type='button';button.setAttribute('aria-pressed',String(t.id===selectedTeacherId));const name=document.createElement('strong');name.textContent=t.name;const count=document.createElement('span');count.textContent=groups.size+' grupos · '+pupils.length+' alumnos';button.append(name,count);button.onclick=()=>{selectedTeacherId=t.id;activeGroup='';render();};list.append(button);});
  }
  const owner=options.find(t=>t.id===selectedTeacherId);
  $('groupsOwner').textContent=owner?'Grupos de '+owner.name:'Grupos';$('studentOwner').textContent=selectedTeacherId&&owner?'Alumno para: '+owner.name:'Agrega o selecciona un maestro antes de registrar alumnos.';
}
async function refresh(){const d=await api('list');if(!d.user||!Array.isArray(d.students)||!Array.isArray(d.teachers))throw new Error('Actualiza Code.gs e implementa una nueva versión para usar las cuentas.');account=d.user;teachers=d.teachers;students=d.students;show('teacher');render();}
async function openCard(s){$('cardName').textContent=s.name;$('cardClass').textContent=groupLabel(s);$('studentLink').value=linkFor(s.code);await QRCode.toCanvas($('cardQR'),linkFor(s.code),{width:280,margin:2});$('cardDialog').showModal();}
function prepareAward(s){selected=s;operation=uid();$('awardName').textContent='Un punto para '+s.name+' · '+groupLabel(s);$('awardDialog').showModal();}
async function award(){
  const result=await api('award',{id:selected.id,operation});
  const item=students.find(s=>s.id===result.id);if(item){item.points=result.points;selectedTeacherId=item.teacherId||'';activeGroup=groupKey(item);}
  render();$('awardDialog').close();status('✓ Un punto para '+result.name+'. Total: '+result.points+'.');selected=null;operation=null;
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
    selected=s;operation=uid();
    await busy(async()=>{try{await award();}catch(e){$('awardName').textContent='Confirmar el punto de '+s.name+' · '+groupLabel(s);$('awardDialog').showModal();throw e;}});
  },()=>{});}catch{await stopCamera();throw new Error('No se pudo abrir la cámara. Permite su uso en el navegador y abre la página con HTTPS. También puedes pegar el enlace.');}
}
async function refreshStudent(){const s=await api('student',{code});$('studentName').textContent='¡Hola, '+s.name+'!';$('points').textContent=s.points;$('studentClass').textContent=groupLabel(s);$('rank').textContent=s.rank==null?'Tu grupo aún no está asignado':'Tu posición en el grupo: #'+s.rank+' de '+s.total;await QRCode.toCanvas($('myQR'),linkFor(code),{width:280,margin:2});show('student');status('');}
$('loginForm').onsubmit=e=>{e.preventDefault();busy(async()=>{const d=await api('login',{username:$('username').value.trim().toLowerCase(),password:$('password').value});session=d.session;sessionStorage.setItem('aula_session',session);$('password').value='';await refresh();status('');});};
$('createForm').onsubmit=e=>{e.preventDefault();busy(async()=>{const name=$('name').value.trim(),grade=$('grade').value,group=$('group').value.trim().toUpperCase(),teacherId=selectedTeacherId;if(!teacherId)throw new Error('Selecciona un maestro antes de registrar un alumno.');if(!createPending || createPending.name!==name || createPending.grade!==grade || createPending.group!==group || createPending.teacherId!==teacherId)createPending={name,grade,group,teacherId,operation:uid()};const s=await api('create',createPending);if(!students.some(x=>x.id===s.id))students.push(s);activeGroup=groupKey(s);createPending=null;$('name').value='';render();await openCard(s);status('Alumno registrado. Comparte su enlace personal.');});};
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
