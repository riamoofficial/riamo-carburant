(function(){
  var KEY="riamoConsent";
  function get(){try{return localStorage.getItem(KEY)}catch(e){return null}}
  function set(v){try{localStorage.setItem(KEY,v)}catch(e){}}
  function clear(){try{localStorage.removeItem(KEY)}catch(e){}}
  function ok(k,min){
    try{var t=+localStorage.getItem(k)||0;return Date.now()-t>min*60000}catch(e){return true}
  }
  function mark(k){try{localStorage.setItem(k,String(Date.now()))}catch(e){}}
  function addTag(src,zone){
    var s=document.createElement("script");
    s.src=src;
    if(zone)s.dataset.zone=zone;
    s.async=true;
    s.setAttribute("data-cfasync","false");
    document.body.appendChild(s);
  }

  function startAds(){
    setTimeout(function(){addTag("https://nap5k.com/tag.min.js","12311821")},8000);
    setTimeout(function(){addTag("https://5gvci.com/act/files/tag.min.js?z=12311830")},15000);
    try{
      if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
    }catch(e){}
    var t0=Date.now(),iv=setInterval(function(){
      var searched=document.querySelectorAll("#list .st").length>0;
      if(searched&&Date.now()-t0>30000&&ok("lastVig",10)){
        clearInterval(iv);
        mark("lastVig");
        addTag("https://n6wxm.com/vignette.min.js","12311826");
      }
    },5000);
  }

  function banner(){
    var b=document.createElement("div");
    b.id="cookieBanner";
    b.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#1c1c1c;color:#f2f2f2;padding:16px;border-top:3px solid #ff9a00;font-family:Iceland,system-ui,sans-serif;font-size:19px;box-shadow:0 -6px 24px #000a";
    b.innerHTML='<div style="max-width:720px;margin:auto">'+
      '<div style="margin-bottom:12px">🍪 Nous utilisons des cookies et traceurs publicitaires (Monetag) pour financer le site. Tu peux les accepter ou les refuser. <a href="confidentialite.html" style="color:#ff9a00">En savoir plus</a></div>'+
      '<div style="display:flex;gap:10px">'+
      '<button id="ckNo" style="flex:1;padding:14px;border-radius:8px;border:2px solid #ff9a00;background:transparent;color:#f2f2f2;font:inherit;font-size:1.1em">Refuser</button>'+
      '<button id="ckYes" style="flex:1;padding:14px;border-radius:8px;border:2px solid #ff9a00;background:#ff9a00;color:#1c1c1c;font:inherit;font-size:1.1em">Accepter</button>'+
      '</div></div>';
    document.body.appendChild(b);
    document.getElementById("ckYes").onclick=function(){set("yes");b.remove();startAds()};
    document.getElementById("ckNo").onclick=function(){set("no");b.remove()};
  }

  window.addEventListener("load",function(){
    var box=document.getElementById("ad1");
    if(box)box.style.display="none";

    var d=document.getElementById("directLink");
    if(d)d.href="https://uplcm.com/4/12311820";

    var cs=document.getElementById("cookieSet");
    if(cs)cs.onclick=function(){clear();location.reload()};

    var c=get();
    if(c==="yes")startAds();
    else if(c!=="no")banner();
  });
})();
