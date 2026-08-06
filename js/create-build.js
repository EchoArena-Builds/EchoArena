
import { supabase } from './supabase.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v='') => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

const state = {
 session:null, heroes:[], classes:[], equipments:[], tiers:[],
 selectedHero:null, selectedTier:null, activeSlot:1,
 slots:{1:null,2:null,3:null,4:null,5:null,6:null}
};

function mediaSource(item){ return item?.media_source || item?.image_url || ''; }
function tierById(id){ return state.tiers.find(t=>t.id===id); }
function currentTier(){ return state.selectedTier || state.tiers.at(-1) || null; }

function toast(text){
 const old=$('.toast'); if(old) old.remove();
 const t=document.createElement('div'); t.className='toast'; t.textContent=text; document.body.appendChild(t);
 setTimeout(()=>t.remove(),2600);
}

function updateProgress(){
 let pct=25;
 if(state.selectedHero) pct=50;
 const filled=Object.values(state.slots).filter(Boolean).length;
 if(filled) pct=Math.max(pct,50+Math.round(filled/6*25));
 if(filled===6) pct=75;
 $('#progressText').textContent=pct+'%';
 $('#progressBar').style.width=pct+'%';
 $('#equipmentCount').textContent=`${filled}/6`;
 $$('.step').forEach((e,i)=>{
   e.classList.toggle('active', i===(pct<50?0:pct<75?1:pct<100?2:3));
 });
}

function renderClasses(){
 $('#classFilter').innerHTML=`<button class="active" data-class="">Todos</button>`+
 state.classes.map(c=>`<button data-class="${esc(c.slug)}">${esc(c.name)}</button>`).join('');
 $$('#classFilter button').forEach(b=>b.onclick=()=>{
   $$('#classFilter button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
   renderHeroes();
 });
}

function renderHeroes(){
 const q=$('#heroSearch').value.trim().toLowerCase();
 const cls=$('#classFilter .active')?.dataset.class||'';
 const rows=state.heroes.filter(h=>(!cls||h.class_slug===cls)&&(!q||h.name.toLowerCase().includes(q)));
 $('#heroGrid').innerHTML=rows.map(h=>`
 <article class="hero-card ${state.selectedHero?.id===h.id?'selected':''}" data-id="${h.id}">
  ${mediaSource(h)?`<img src="${esc(mediaSource(h))}" alt="${esc(h.name)}">`:`<div class="hero-ph">${esc(h.name[0])}</div>`}
  <footer><b>${esc(h.name)}</b><small>${esc(h.class_name||'')}</small></footer>
 </article>`).join('');
 $$('#heroGrid .hero-card').forEach(c=>c.onclick=()=>{
   state.selectedHero=state.heroes.find(h=>h.id===c.dataset.id); renderHeroes(); updateProgress();
   toast(`${state.selectedHero.name} selecionado`);
 });
}

function renderTiers(){
 $('#tierSelect').innerHTML=state.tiers.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
 if(state.tiers.length){ state.selectedTier=state.tiers.at(-1); $('#tierSelect').value=state.selectedTier.id; }
}

function renderEquipment(){
 const q=$('#equipmentSearch').value.trim().toLowerCase();
 const tier=currentTier();
 const rows=state.equipments.filter(e=>!q||e.name.toLowerCase().includes(q));
 $('#equipmentList').innerHTML=rows.map(e=>`
 <article class="equipment" draggable="true" data-id="${e.id}">
   ${e.image_url?`<img src="${esc(e.image_url)}" alt="${esc(e.name)}">`:`<div class="hero-ph">${esc(e.name[0])}</div>`}
   <div><h4>${esc(e.name)}</h4><p>${esc(e.description||'Sem descrição cadastrada.')}</p>
   <div class="tier-inline" style="color:${tier?.color||'#fff000'}"><i class="tier-dot" style="background:${tier?.color||'#fff000'}"></i>${esc(tier?.name||'Divino')}</div></div>
 </article>`).join('');
 $$('#equipmentList .equipment').forEach(card=>{
   card.onclick=()=>equip(card.dataset.id);
   card.ondragstart=e=>e.dataTransfer.setData('text/plain',card.dataset.id);
 });
}

function equip(id){
 const item=state.equipments.find(e=>e.id===id);
 const tier=currentTier();
 state.slots[state.activeSlot]={item,tier};
 renderSlots(); updateProgress();
 toast(`${item.name} — ${tier?.name||''} equipado no slot ${state.activeSlot}`);
}

function renderSlots(){
 $$('.slot').forEach(el=>{
   const n=Number(el.dataset.slot),data=state.slots[n];
   el.classList.toggle('active',n===state.activeSlot);
   if(!data){
     el.innerHTML=`<span class="slot-label">${esc(el.dataset.label)}</span><span style="font-size:20px">+</span>`;
   }else{
     el.innerHTML=`${data.item.image_url?`<img src="${esc(data.item.image_url)}">`:''}
       <span class="item-name">${esc(data.item.name)}</span>
       <span class="tier-name" style="color:${data.tier.color}">● ${esc(data.tier.name)}</span>`;
   }
   el.onclick=()=>{state.activeSlot=n;renderSlots()};
   el.ondragover=e=>e.preventDefault();
   el.ondrop=e=>{e.preventDefault();state.activeSlot=n;equip(e.dataTransfer.getData('text/plain'))};
 });
}

function review(){
 if(!$('#buildName').value.trim()) return toast('Digite o nome da build.');
 if(!state.selectedHero) return toast('Selecione um herói.');
 $('#reviewHero').innerHTML=mediaSource(state.selectedHero)?`<img src="${esc(mediaSource(state.selectedHero))}">`:'';
 $('#reviewHeroName').textContent=state.selectedHero.name;
 $('#reviewTitle').textContent=$('#buildName').value.trim();
 $('#reviewDescription').textContent=$('#buildDescription').value.trim()||'Sem descrição.';
 $('#reviewItems').innerHTML=Object.entries(state.slots).map(([n,d])=>`
 <div class="review-item"><small>Slot ${n}</small><b>${d?esc(d.item.name):'Vazio'}</b>
 <small style="color:${d?.tier.color||'#65718a'}">${d?esc(d.tier.name):'Nenhum tier'}</small></div>`).join('');
 $('#reviewModal').classList.add('open');
}

async function save(status='published'){
 const title=$('#buildName').value.trim();
 if(!title||!state.selectedHero) return toast('Preencha o nome e selecione um herói.');
 const isPublic=$('#visibility').value==='public' && status==='published';
 $('#saveFinal').disabled=true;

 const {data:build,error}=await supabase.from('builds').insert({
   user_id:state.session.user.id, hero_id:state.selectedHero.id, title,
   description:$('#buildDescription').value.trim(),
   is_public:isPublic, visibility:isPublic?'public':'private',
   status, published_at:isPublic?new Date().toISOString():null
 }).select('id').single();

 if(error){ $('#saveFinal').disabled=false; return toast('Erro: '+error.message); }

 const items=Object.entries(state.slots).filter(([,d])=>d).map(([slot,d])=>({
   build_id:build.id,equipment_id:d.item.id,tier_id:d.tier.id,slot:Number(slot)
 }));
 if(items.length){
   const {error:itemError}=await supabase.from('build_items').insert(items);
   if(itemError){ await supabase.from('builds').delete().eq('id',build.id); $('#saveFinal').disabled=false; return toast('Erro nos equipamentos: '+itemError.message); }
 }
 toast(status==='draft'?'Rascunho salvo.':'Build salva com sucesso.');
 setTimeout(()=>location.href='./index.html',900);
}

async function boot(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){location.href='./index.html';return}
 state.session=session; $('#accountEmail').textContent=session.user.email||'Minha conta';

 const [heroes,classes,equipments,tiers]=await Promise.all([
   supabase.from('v_heroes_complete').select('*').eq('enabled',true).order('name'),
   supabase.from('hero_classes').select('id,name,slug').order('name'),
   supabase.from('equipments').select('id,name,description,image_url,rarity,slot_id').eq('enabled',true).order('name'),
   supabase.from('equipment_tiers').select('*').eq('enabled',true).order('display_order')
 ]);
 if(heroes.error) toast('Erro ao carregar heróis: '+heroes.error.message);
 if(equipments.error) toast('Erro ao carregar equipamentos: '+equipments.error.message);
 if(tiers.error) toast('Execute 053_equipment_tiers.sql no Supabase.');

 state.heroes=heroes.data||[]; state.classes=classes.data||[]; state.equipments=equipments.data||[]; state.tiers=tiers.data||[];
 renderClasses();renderHeroes();renderTiers();renderEquipment();renderSlots();updateProgress();
}

$('#heroSearch').oninput=renderHeroes;
$('#equipmentSearch').oninput=renderEquipment;
$('#tierSelect').onchange=e=>{state.selectedTier=tierById(e.target.value);renderEquipment()};
$('#reviewButton').onclick=review;
$('#reviewClose').onclick=()=>$('#reviewModal').classList.remove('open');
$('#saveFinal').onclick=()=>save('published');
$('#saveDraft').onclick=()=>save('draft');
$('#buildName').oninput=e=>{$('#nameCounter').textContent=`${e.target.value.length}/60`};
$('#buildDescription').oninput=e=>{$('#descCounter').textContent=`${e.target.value.length}/500`};
boot();
