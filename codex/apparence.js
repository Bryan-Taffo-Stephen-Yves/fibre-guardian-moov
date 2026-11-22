/* Apparence choisie par le client : Clair (par défaut), Sombre ou Automatique (suit le téléphone).
   Chargé dans le <head>, avant les feuilles de style, pour poser data-theme sur <html> sans flash.
   Ce fichier ne contient aucune couleur : les règles [data-theme=dark] et [data-theme=auto] sont dans le CSS. */
(function(){
 'use strict';
 var KEY='fg-apparence',CHOICES=['light','dark','auto'];
 function valid(v){return CHOICES.indexOf(v)>=0?v:'light';}
 function read(){try{return valid(localStorage.getItem(KEY));}catch(_){return 'light';}}
 function apply(v){v=valid(v);try{document.documentElement.setAttribute('data-theme',v);}catch(_){}return v;}
 function save(v){v=valid(v);try{localStorage.setItem(KEY,v);}catch(_){}return apply(v);}
 window.FGApparence={KEY:KEY,CHOICES:CHOICES,read:read,save:save,apply:apply};
 apply(read());
})();
