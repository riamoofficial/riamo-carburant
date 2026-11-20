(function(){
  function addTag(src,zone){
    var s=document.createElement("script");
    s.src=src;
    if(zone)s.dataset.zone=zone;
    s.async=true;
    s.setAttribute("data-cfasync","false");
    document.body.appendChild(s);
  }
  function ok(k,min){
    try{var t=+localStorage.getItem(k)||0;return Date.now()-t>min*60000}catch(e){return true}
  }
  function mark(k){try{localStorage.setItem(k,String(Date.now()))}catch(e){}}

  window.addEventListener("load",function(){
    var box=document.getElementById("ad1");
    if(box)box.style.display="none";

    var d=document.getElementById("directLink");
    if(d)d.href="https://uplcm.com/4/12311820";

    setTimeout(function(){addTag("https://5gvci.com/act/files/tag.min.js?z=12311830")},15000);
    setTimeout(function(){addTag("https://nap5k.com/tag.min.js","12311821")},8000);

    var t0=Date.now(),iv=setInterval(function(){
      var searched=document.querySelectorAll("#list .st").length>0;
      if(searched&&Date.now()-t0>30000&&ok("lastVig",10)){
        clearInterval(iv);
        mark("lastVig");
        addTag("https://n6wxm.com/vignette.min.js","12311826");
      }
    },5000);
  });
})();
