/* Apparence choisie par le client : Clair (par défaut), Sombre ou Automatique (suit le téléphone).
   Chargé dans le <head>, avant les feuilles de style, pour poser data-theme sur <html> sans flash.
   Ce fichier ne contient aucune couleur : les règles [data-mode=dark] sont dans design-system.css. */
(function(){
 'use strict';
 var KEY='fg-apparence',CHOICES=['light','dark','auto'];
 function valid(v){return CHOICES.indexOf(v)>=0?v:'light';}
 function read(){try{return valid(localStorage.getItem(KEY));}catch(_){return 'light';}}
 var media=null;try{media=window.matchMedia('(prefers-color-scheme: dark)');}catch(_){}
 // data-theme = le choix (light, dark, auto) ; data-mode = ce qui s'affiche vraiment (light ou dark).
 function mode(v){return v==='dark'||(v==='auto'&&!!(media&&media.matches))?'dark':'light';}
 function apply(v){v=valid(v);try{var r=document.documentElement;r.setAttribute('data-theme',v);r.setAttribute('data-mode',mode(v));}catch(_){}return v;}
 // Espace Moov : l'écran de chargement reste clair, comme l'espace lui-même.
 try{if(/[?&]portal=moov(&|$)/.test(location.search))document.documentElement.setAttribute('data-portail','moov');}catch(_){}
 function save(v){v=valid(v);try{localStorage.setItem(KEY,v);}catch(_){}return apply(v);}
 window.FGApparence={KEY:KEY,CHOICES:CHOICES,read:read,save:save,apply:apply,mode:mode};
 // Automatique : on suit le téléphone s'il change de mode pendant que l'app est ouverte.
 if(media){var follow=function(){if(read()==='auto')apply('auto');};if(media.addEventListener)media.addEventListener('change',follow);else if(media.addListener)media.addListener(follow);}
 apply(read());
})();
