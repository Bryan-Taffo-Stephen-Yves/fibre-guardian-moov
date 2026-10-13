/* Accessible, local SVG analytics. No chart service and no invented missing samples. */
(function(root){
 const h=React.createElement,{useState,useEffect,useRef}=React;
 const fmt=(v,p=2)=>v.toLocaleString('fr-FR',{maximumFractionDigits:p});
 const volume=b=>b>=1e9?fmt(b/1e9)+' Go':fmt(b/1e6)+' Mo';
 const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
 function Analytics({state:s}){
  const [chosen,setChosen]=useState('today'),[device,setDevice]=useState('all'),[metric,setMetric]=useState('bytes'),[hour,setHour]=useState(12);
  const chartRef=useRef(null),[chartWidth,setChartWidth]=useState(920);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setChartWidth(Math.max(260,Math.round(entries[0].contentRect.width))));observer.observe(chartRef.current);return()=>observer.disconnect();},[]);
  const date=chosen==='today'?s.day:chosen,dates=s.month.filter(d=>d.hours).map(d=>d.date).concat(s.day).sort();
  const points=FGHouse.analytics(s,date,device),observed=points.filter(p=>p.observed),sample=points[hour];
  const total=observed.reduce((sum,p)=>sum+p.bytes,0),peak=observed.length?Math.max(...observed.map(p=>p.connected)):null;
  const breakdown=s.devices.map(d=>({id:d.id,name:d.name,bytes:observed.reduce((sum,p)=>sum+(p.devices.find(x=>x.id===d.id)?.bytes||0),0)})).sort((a,b)=>b.bytes-a.bytes),allTotal=breakdown.reduce((a,d)=>a+d.bytes,0);
  const max=Math.max(metric==='connected'?1:1e6,...observed.map(p=>p[metric])),scale=metric==='connected'?1:max>=1e9?1e9:1e6,unit=metric==='connected'?'Appareils':scale===1e9?'Go':'Mo';
  const W=chartWidth,H=W<500?220:270,left=W<500?42:58,right=20,top=20,bottom=36,x=i=>left+i*(W-left-right)/23,y=v=>H-bottom-v/max*(H-top-bottom);
  let line='',area='',run=[];
  function flush(){if(!run.length)return;line+=run.map((p,i)=>(i?'L':'M')+x(p.hour)+','+y(p[metric])).join(' ');area+='M'+x(run[0].hour)+','+(H-bottom)+' '+run.map(p=>'L'+x(p.hour)+','+y(p[metric])).join(' ')+' L'+x(run.at(-1).hour)+','+(H-bottom)+' Z ';run=[];}
  points.forEach(p=>{if(p.observed)run.push(p);else flush();});flush();
  function selectPointer(e){const rect=e.currentTarget.getBoundingClientRect();setHour(Math.max(0,Math.min(23,Math.round(((e.clientX-rect.left)/rect.width*W-left)/(W-left-right)*23))));}
  const value=v=>metric==='connected'?fmt(v,0)+' appareils':volume(v);
  return h('section',{className:'panel ha-dashboard','aria-label':'Tableau de bord de consommation'},
   h('div',{className:'ha-heading'},h('div',null,h('span',{className:'eyebrow'},'VOTRE ACTIVITÉ EN UN COUP D’ŒIL'),h('h2',null,'Consommation de la maison'),h('p',null,'Volumes, appareils et habitudes · données simulées')),h('div',{className:'ha-filters'},h('label',null,'Date du tableau de bord',h('input',{type:'date',min:dates[0],max:s.day,value:date,onChange:e=>{if(e.target.value)setChosen(e.target.value===s.day?'today':e.target.value);}})),h('label',null,'Appareil analysé',h('select',{value:device,onChange:e=>setDevice(e.target.value)},h('option',{value:'all'},'Tous les appareils'),s.devices.map(d=>h('option',{key:d.id,value:d.id},d.name)))))),
   h('div',{className:'ha-kpis'},h('div',null,h('span',null,device==='all'?'Volume de la journée':'Volume de cet appareil'),h('strong',{'data-testid':'analytics-total'},volume(total)),h('small',null,dateLabel(date))),h('div',null,h('span',null,'Pic d’appareils connectés'),h('strong',null,peak===null?'—':peak),h('small',null,'Dans le foyer · derniers relevés horaires')),h('div',null,h('span',null,'Plus gros consommateur'),h('strong',{className:'ha-name'},allTotal?breakdown[0].name:'Aucune donnée'),h('small',null,allTotal?volume(breakdown[0].bytes)+' · '+fmt(breakdown[0].bytes/allTotal*100,0)+' % du foyer':'Sur la journée sélectionnée'))),
   h('div',{className:'ha-chart-tools'},h('div',{className:'hh-actions'},[['bytes','Volume par heure'],['cumulative','Cumul de la journée'],['connected','Appareils connectés']].map(([key,label])=>h('button',{key,type:'button',className:'hh-button','aria-pressed':metric===key,onClick:()=>setMetric(key)},label))),h('span',null,unit,' · ',date===s.day?'Journée en cours':'Journée archivée')),
   h('div',{className:'ha-chart',ref:chartRef},h('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':'Courbe : '+({bytes:'volume consommé par heure',cumulative:'volume cumulé',connected:'appareils connectés dans le foyer'}[metric])+'. Utilisez le curseur horaire pour lire les valeurs.',onPointerMove:selectPointer,onPointerDown:selectPointer},
    [0,.25,.5,.75,1].map((f,i)=>h('g',{key:i},h('line',{x1:left,y1:y(max*f),x2:W-right,y2:y(max*f),stroke:'#dfe5dc',strokeDasharray:'3 5'}),h('text',{x:left-10,y:y(max*f)+4,textAnchor:'end',className:'ha-axis'},fmt(max*f/scale,metric==='connected'?1:2)))),
    (W<500?[0,6,12,18,23]:[0,3,6,9,12,15,18,21,23]).map(i=>h('text',{key:i,x:x(i),y:H-10,textAnchor:'middle',className:'ha-axis'},i+' h')),
    h('path',{d:area,fill:'#d8efb6',opacity:.55}),h('path',{d:line,fill:'none',stroke:'#4c7137',strokeWidth:3,strokeLinejoin:'round'}),
    h('line',{x1:x(hour),x2:x(hour),y1:top,y2:H-bottom,stroke:'#516649',strokeDasharray:'4 4'}),sample.observed&&h('circle',{cx:x(hour),cy:y(sample[metric]),r:6,fill:'#263b21',stroke:'#fff',strokeWidth:3}))),
   !observed.length&&h('p',{className:'hh-empty'},'Aucun relevé pour cette date. Aucune courbe n’est inventée.'),
   h('label',{className:'ha-slider'},'Explorer une heure : '+hour+' h – '+(hour+1)+' h',h('input',{type:'range',min:0,max:23,step:1,value:hour,'aria-label':'Heure analysée',onChange:e=>setHour(Number(e.target.value))})),
   h('div',{className:'ha-detail','data-testid':'analytics-detail'},h('div',null,h('span',{className:'eyebrow'},hour+' H — '+(hour+1)+' H'),h('strong',null,sample.observed?value(sample[metric]):'Non observé'),h('p',null,sample.observed?sample.connected+' appareils dans le foyer au dernier relevé de cette heure.':'Cette heure n’a pas de mesure ; elle n’est pas comptée comme zéro.'),sample.observed&&h('small',null,sample.seconds<3600?'Heure partielle · '+sample.seconds+' secondes observées.':'Heure complète.')),h('div',{className:'ha-hour-devices'},h('strong',null,'Volume par appareil sur cette heure'),sample.observed?sample.devices.map(d=>h('div',{key:d.id,className:device===d.id?'ha-selected':''},h('span',null,d.name),h('b',null,volume(d.bytes)))):h('p',null,'Pas de détail disponible.'))),
   h('div',{className:'ha-ranking'},h('h3',null,'Répartition de la journée par appareil'),breakdown.map(d=>h('button',{type:'button',key:d.id,'aria-pressed':device===d.id,onClick:()=>setDevice(device===d.id?'all':d.id)},h('span',null,d.name),h('i',null,h('em',{style:{width:(allTotal?d.bytes/allTotal*100:0)+'%'}})),h('b',null,volume(d.bytes)),h('small',null,allTotal?fmt(d.bytes/allTotal*100,0)+' %':'—')))),
   h('p',{className:'ha-note'},'Survolez ou touchez la courbe ; au clavier, utilisez le curseur. Les volumes sont des agrégats horaires, pas un débit instantané. La courbe d’appareils concerne toujours tout le foyer. Les heures futures ou sans relevé ne sont pas tracées. Historique de départ fictif, conservé en mémoire pour cette session.')
  );
 }
 root.FGHouseholdAnalytics=Analytics;
})(window);
