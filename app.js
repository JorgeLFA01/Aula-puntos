'use strict';
const $ = id => document.getElementById(id);
let session = sessionStorage.getItem('aula_session') || '', students = [], scanner = null;
let selected = null, operation = null, createPending = null, isBusy = false;
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
    if(e.message?.includes('Sesión vencida')) {session='';sessionStorage.removeItem('aula_session');show('login');}
    if(e instanceof TypeError || e.name==='TimeoutError' || e instanceof SyntaxError)throw new Error('No se pudo confirmar la respuesta. Revisa tu conexión y que Apps Script esté implementado para «Cualquier persona». Puedes reintentar: la misma operación no sumará dos puntos.');
    throw e;
  }
}
async function busy(fn){if(isBusy)return;isBusy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message,true);}finally{isBusy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function render(){
  const roster=$('roster');roster.replaceChildren();
  if(!students.length){roster.textContent='Aún no hay alumnos. Registra el primero para crear su QR.';return;}
  [...students].sort((a,b)=>a.name.localeCompare(b.name,'es')).forEach(s=>{
    const row=document.createElement('div');row.className='row';
    const name=document.createElement('strong');name.textContent=s.name;
    const points=document.createElement('span');points.className='badge';points.textContent=s.points+' puntos';
    const qr=document.createElement('button');qr.className='secondary';qr.textContent='Ver QR';qr.onclick=()=>busy(()=>openCard(s));
    const plus=document.createElement('button');plus.textContent='+1';plus.setAttribute('aria-label','Sumar un punto a '+s.name);plus.onclick=()=>prepareAward(s);
    row.append(name,points,qr,plus);roster.append(row);
  });
}
async function refresh(){students=await api('list');show('teacher');render();}
async function openCard(s){$('cardName').textContent=s.name;$('studentLink').value=linkFor(s.code);await QRCode.toCanvas($('cardQR'),linkFor(s.code),{width:280,margin:2});$('cardDialog').showModal();}
function prepareAward(s){selected=s;operation=uid();$('awardName').textContent='Un punto para '+s.name;$('awardDialog').showModal();}
async function award(){
  const result=await api('award',{id:selected.id,operation});
  const item=students.find(s=>s.id===result.id);if(item)item.points=result.points;
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
    const s=resolveStudent(raw);if(!s){status('El QR no pertenece a esta clase.',true);return;}
    selected=s;operation=uid();
    await busy(async()=>{try{await award();}catch(e){$('awardName').textContent='Confirmar el punto de '+s.name;$('awardDialog').showModal();throw e;}});
  },()=>{});}catch{await stopCamera();throw new Error('No se pudo abrir la cámara. Permite su uso en el navegador y abre la página con HTTPS. También puedes pegar el enlace.');}
}
async function refreshStudent(){const s=await api('student',{code});$('studentName').textContent='¡Hola, '+s.name+'!';$('points').textContent=s.points;$('rank').textContent='Tu posición: #'+s.rank+' de '+s.total;await QRCode.toCanvas($('myQR'),linkFor(code),{width:280,margin:2});show('student');status('');}
$('loginForm').onsubmit=e=>{e.preventDefault();busy(async()=>{const d=await api('login',{password:$('password').value});session=d.session;sessionStorage.setItem('aula_session',session);$('password').value='';await refresh();status('');});};
$('createForm').onsubmit=e=>{e.preventDefault();busy(async()=>{const name=$('name').value.trim();if(!createPending || createPending.name!==name)createPending={name,operation:uid()};const s=await api('create',createPending);if(!students.some(x=>x.id===s.id))students.push(s);createPending=null;$('name').value='';render();await openCard(s);status('Alumno registrado. Comparte su enlace personal.');});};
$('refresh').onclick=()=>busy(async()=>{await refresh();status('Lista actualizada.');});
$('logout').onclick=()=>busy(async()=>{await stopCamera();try{await api('logout');}finally{session='';sessionStorage.removeItem('aula_session');students=[];$('roster').replaceChildren();show('login');}});
$('startScan').onclick=()=>busy(startCamera);$('stopScan').onclick=stopCamera;
$('lookupForm').onsubmit=e=>{e.preventDefault();const s=resolveStudent($('manual').value);if(s)prepareAward(s);else status('No se encontró ese alumno.',true);};
$('confirmAward').onclick=()=>busy(award);$('cancelAward').onclick=()=>{$('awardDialog').close();selected=null;operation=null;};
$('closeCard').onclick=()=>$('cardDialog').close();
$('copyLink').onclick=()=>busy(async()=>{await navigator.clipboard.writeText($('studentLink').value);status('Enlace copiado.');});
$('downloadQR').onclick=()=>{const a=document.createElement('a');a.download='QR-'+$('cardName').textContent.replace(/[^a-zA-Z0-9áéíóúñ]/gi,'_')+'.png';a.href=$('cardQR').toDataURL('image/png');a.click();};
$('refreshStudent').onclick=()=>busy(refreshStudent);
window.addEventListener('hashchange',()=>location.reload());
window.addEventListener('pagehide',()=>{if(scanner)scanner.stop().catch(()=>{});});
if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(apiURL))show('setup');
else if(code){status('Cargando tus puntos…');busy(refreshStudent);}
else if(session){status('Cargando tu clase…');busy(async()=>{await refresh();status('');});}
else show('login');
