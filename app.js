const API="https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const GEO="https://api-adresse.data.gouv.fr";
const FUELS={gazole:"Gazole",e10:"SP95-E10",sp95:"SP95",sp98:"SP98",e85:"E85",gplc:"GPLc"};
const MAX=1000;
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls={
  get(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v??d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
};

let st={fuel:ls.get("fuel","gazole"),dist:ls.get("dist",25),sort:"price",center:null,list:[]};
let favs=ls.get("favs",{});
let alerts=ls.get("alerts",{});
let map=null,layer=null;

/* ---------- Navigation ---------- */
const TITLES={search:"Paramètres de la recherche",results:"Résultats",map:"Carte",fav:"Favoris",alert:"Alerte prix bas",about:"À propos"};
function show(v){
  document.querySelectorAll(".view").forEach(e=>e.hidden=true);
  $("#v-"+v).hidden=false;
  $("#title").textContent=TITLES[v]||"Riamo Carburant";
  closeDrawer();
  window.scrollTo(0,0);
  if(v==="map")drawMap();
  if(v==="fav")loadFavs();
  if(v==="alert")renderAlerts();
}
function openDrawer(){$("#drawer").classList.add("on");$("#shade").classList.add("on")}
function closeDrawer(){$("#drawer").classList.remove("on");$("#shade").classList.remove("on")}
$("#burger").onclick=openDrawer;
$("#shade").onclick=closeDrawer;
$("#btnMap").onclick=()=>show("map");
document.querySelectorAll(".drawer a[data-v]").forEach(a=>a.onclick=()=>show(a.dataset.v));
$("#share").onclick=async()=>{
  const d={title:"Riamo Carburant",text:"Trouve le carburant le moins cher près de toi !",url:location.href};
  try{if(navigator.share)await navigator.share(d);else{await navigator.clipboard.writeText(d.url);alert("Lien copié !")}}catch(e){}
};

/* ---------- Formulaire ---------- */
for(const[k,v]of Object.entries(FUELS)){
  $("#fuel").add(new Option(v,k));
  $("#afuel").add(new Option(v,k));
}
[5,10,15,25,50,100].forEach(d=>$("#dist").add(new Option(d+" km",d)));
$("#fuel").value=st.fuel;
$("#dist").value=st.dist;
$("#fuel").onchange=e=>{st.fuel=e.target.value;ls.set("fuel",st.fuel)};
$("#dist").onchange=e=>{st.dist=+e.target.value;ls.set("dist",st.dist)};
$("#clr").onclick=()=>{$("#q").value="";$("#q").focus()};
$("#q").addEventListener("keydown",e=>{if(e.key==="Enter")search()});
$("#q").addEventListener("focus",()=>document.querySelector('input[value="text"]').checked=true);
document.querySelectorAll('input[name="mode"]').forEach(r=>r.onchange=()=>{
  if(mode()==="gps")locate(true);
});
$("#go").onclick=()=>search();
$("#btnSort").onclick=()=>{
  st.sort=st.sort==="price"?"dist":"price";
  $("#btnSort").textContent=st.sort==="price"?"↓€":"↓km";
  renderList();
};
const mode=()=>document.querySelector('input[name="mode"]:checked').value;
const setStatus=t=>$("#status").textContent=t;

/* ---------- Localisation + ville automatique ---------- */
function getPos(){
  return new Promise((res,rej)=>{
    if(!navigator.geolocation)return rej(new Error("no-geo"));
    navigator.geolocation.getCurrentPosition(p=>res(p.coords),rej,{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
  });
}
async function cityOf(lat,lon){
  try{
    const r=await fetch(`${GEO}/reverse/?lon=${lon}&lat=${lat}&limit=1`);
    const j=await r.json();
    const p=j.features&&j.features[0]&&j.features[0].properties;
    if(p)return `${p.city||p.name} ${p.postcode||""}`.trim();
  }catch(e){}
  return "Ma position";
}
async function locate(run){
  $("#place").textContent="Localisation en cours…";
  try{
    const c=await getPos();
    const label=await cityOf(c.latitude,c.longitude);
    st.center={lat:c.latitude,lon:c.longitude,label};
    $("#place").textContent="📍 "+label;
    if(run)search(true);
    return true;
  }catch(e){
    $("#place").textContent="Position refusée : autorise la localisation ou cherche par ville.";
    return false;
  }
}
async function geocode(q){
  const r=await fetch(`${GEO}/search/?q=${encodeURIComponent(q)}&limit=1`);
  const j=await r.json();
  const f=j.features&&j.features[0];
  if(!f)throw new Error("introuvable");
  const [lon,lat]=f.geometry.coordinates;
  return{lat,lon,label:f.properties.label};
}

/* ---------- Données ---------- */
function km(a,b,c,d){
  const R=6371,t=x=>x*Math.PI/180,dl=t(c-a),dn=t(d-b);
  const h=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dn/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function hm(iso){
  if(!iso)return"";
  const d=new Date(iso),n=new Date();
  const t=String(d.getHours()).padStart(2,"0")+"h"+String(d.getMinutes()).padStart(2,"0");
  return d.toDateString()===n.toDateString()?t:String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+" "+t;
}
async function fetchAll(c){
  const f=st.fuel+"_prix";
  let where=`within_distance(geom, geom'POINT(${c.lon} ${c.lat})', ${st.dist}km) and ${f} is not null`;
  if($("#h24").checked)where+=` and horaires_automate_24_24="Oui"`;
  let out=[],offset=0,total=1;
  while(offset<total&&offset<MAX){
    const p=new URLSearchParams({where,order_by:f+" asc",limit:"100",offset:String(offset)});
    const r=await fetch(`${API}?${p}`);
    if(!r.ok)throw new Error("HTTP "+r.status);
    const j=await r.json();
    total=j.total_count||0;
    out=out.concat(j.results||[]);
    if(!(j.results||[]).length)break;
    offset+=100;
    setStatus(`Chargement… ${out.length}/${Math.min(total,MAX)} stations`);
  }
  return{list:out,total};
}
function prep(list,c){
  return list.map(s=>{
    const lat=s.geom?s.geom.lat:s.latitude/100000,lon=s.geom?s.geom.lon:s.longitude/100000;
    return{...s,_lat:lat,_lon:lon,_d:km(c.lat,c.lon,lat,lon)};
  });
}

async function search(auto){
  setStatus("Recherche en cours…");
  try{
    let c;
    if(mode()==="gps"){
      if(!(auto&&st.center)){if(!await locate(false)){setStatus("Impossible de te localiser.");return}}
      c=st.center;
    }else{
      const q=$("#q").value.trim();
      if(!q){setStatus("Entre un code postal, une ville ou une adresse.");return}
      c=await geocode(q);
      st.center=c;
    }
    const {list,total}=await fetchAll(c);
    st.list=prep(list,c);
    st.total=total;
    setStatus("");
    renderList();
    show("results");
    checkAlerts();
  }catch(e){
    setStatus(e.message==="introuvable"?"Lieu introuvable.":"Erreur de chargement. Vérifie ta connexion.");
  }
}

/* ---------- Affichage ---------- */
function card(s,i,fuelKey){
  const f=fuelKey||st.fuel;
  const d=document.createElement("div");
  d.className="st"+(i===0?" best":"");
  const price=Number(s[f+"_prix"]).toFixed(3).replace(".",",");
  const isFav=!!favs[s.id];
  const dist=s._d!=null?` · ${s._d.toFixed(1).replace(".",",")} km`:"";
  d.innerHTML=`<div class="l"><b>${esc(s.adresse)}</b><small>${esc(s.cp)} ${esc(s.ville)}${dist}</small>
    <div class="acts"><a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s._lat},${s._lon}">🧭 Itinéraire</a>
    <span class="star ${isFav?"on":""}">${isFav?"★ Favori":"☆ Favori"}</span></div></div>
    <div class="r"><div class="pr">${price}</div><small>${hm(s[f+"_maj"])}</small><small>${FUELS[f]}</small></div>`;
  d.querySelector(".star").onclick=e=>{
    if(favs[s.id])delete favs[s.id];
    else favs[s.id]={adresse:s.adresse,ville:s.ville,cp:s.cp};
    ls.set("favs",favs);
    const on=!!favs[s.id];
    e.target.classList.toggle("on",on);
    e.target.textContent=on?"★ Favori":"☆ Favori";
  };
  return d;
}
function renderList(){
  const key=st.fuel+"_prix";
  const arr=[...st.list].sort((a,b)=>st.sort==="price"?a[key]-b[key]:a._d-b._d);
  const c=st.center;
  $("#sum").textContent=`📍 ${c?c.label:""} · ${arr.length} stations · ${FUELS[st.fuel]} · rayon ${st.dist} km`+(st.total>MAX?` (affichage limité aux ${MAX} moins chères)`:"");
  const box=$("#list");
  box.innerHTML="";
  if(!arr.length){$("#sum").textContent="Aucune station trouvée. Augmente le rayon ou change de carburant.";return}
  const frag=document.createDocumentFragment();
  arr.forEach((s,i)=>frag.appendChild(card(s,i)));
  box.appendChild(frag);
}

/* ---------- Carte ---------- */
function drawMap(){
  const c=st.center||{lat:46.6,lon:2.4};
  if(!map){
    map=L.map("map").setView([c.lat,c.lon],st.center?11:6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
    layer=L.layerGroup().addTo(map);
  }
  setTimeout(()=>map.invalidateSize(),50);
  layer.clearLayers();
  if(!st.list.length)return;
  const key=st.fuel+"_prix";
  const arr=[...st.list].sort((a,b)=>a[key]-b[key]);
  const min=arr[0][key],max=arr[Math.min(arr.length-1,300)][key];
  arr.slice(0,400).forEach(s=>{
    const t=max>min?(s[key]-min)/(max-min):0;
    const col=t<.33?"#27c93f":t<.66?"#ff9a00":"#ff3b30";
    L.circleMarker([s._lat,s._lon],{radius:9,color:"#fff",weight:2,fillColor:col,fillOpacity:.95})
      .bindPopup(`<b>${Number(s[key]).toFixed(3)} €</b> ${FUELS[st.fuel]}<br>${esc(s.adresse)}<br>${esc(s.cp)} ${esc(s.ville)}`)
      .addTo(layer);
  });
  if(st.center){
    L.marker([c.lat,c.lon]).addTo(layer).bindPopup("📍 "+esc(c.label));
    map.setView([c.lat,c.lon],11);
  }
}

/* ---------- Favoris ---------- */
async function loadFavs(){
  const ids=Object.keys(favs);
  const box=$("#favlist");
  box.innerHTML="";
  if(!ids.length){$("#favstatus").textContent="Aucun favori. Appuie sur ☆ Favori dans les résultats.";return}
  $("#favstatus").textContent="Chargement…";
  try{
    const where=ids.map(i=>`id=${Number(i)}`).join(" or ");
    const r=await fetch(`${API}?${new URLSearchParams({where,limit:"100"})}`);
    const j=await r.json();
    const c=st.center;
    const list=(j.results||[]).map(s=>{
      const lat=s.geom?s.geom.lat:0,lon=s.geom?s.geom.lon:0;
      return{...s,_lat:lat,_lon:lon,_d:c?km(c.lat,c.lon,lat,lon):null};
    });
    $("#favstatus").textContent=`${list.length} station(s) favorite(s) · ${FUELS[st.fuel]}`;
    list.forEach((s,i)=>{
      if(s[st.fuel+"_prix"]==null){
        const d=document.createElement("div");d.className="st";
        d.innerHTML=`<div class="l"><b>${esc(s.adresse)}</b><small>${esc(s.cp)} ${esc(s.ville)} · pas de ${FUELS[st.fuel]}</small></div>`;
        box.appendChild(d);
      }else box.appendChild(card(s,-1));
    });
  }catch(e){$("#favstatus").textContent="Erreur de chargement."}
}

/* ---------- Alertes ---------- */
$("#asave").onclick=()=>{
  const p=parseFloat($("#aprice").value);
  if(!p||p<=0){alert("Entre un prix valide, ex : 1.800");return}
  alerts[$("#afuel").value]=p;
  ls.set("alerts",alerts);
  $("#aprice").value="";
  renderAlerts();
  if("Notification" in window&&Notification.permission==="default")Notification.requestPermission();
};
function renderAlerts(){
  const box=$("#alist");box.innerHTML="";
  for(const[f,p]of Object.entries(alerts)){
    const d=document.createElement("div");d.className="al";
    d.innerHTML=`<div>${FUELS[f]} ≤ ${p.toFixed(3)} €</div><span>Supprimer</span>`;
    d.querySelector("span").onclick=()=>{delete alerts[f];ls.set("alerts",alerts);renderAlerts()};
    box.appendChild(d);
  }
}
function checkAlerts(){
  const th=alerts[st.fuel];
  if(!th||!st.list.length)return;
  const best=Math.min(...st.list.map(s=>Number(s[st.fuel+"_prix"])));
  if(best<=th){
    const msg=`🔔 ${FUELS[st.fuel]} à ${best.toFixed(3)} € près de toi (alerte ${th.toFixed(3)} €)`;
    $("#sum").textContent=msg+" · "+$("#sum").textContent;
    try{if("Notification" in window&&Notification.permission==="granted")new Notification("Riamo Carburant",{body:msg,icon:"logo.png"})}catch(e){}
  }
}

/* ---------- PWA ---------- */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>localStorage.getItem("riamoConsent")==="yes" && navigator.serviceWorker.register("/sw.js").catch(()=>{}));
}
show("search");
