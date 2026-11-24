import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_FILES = [
  { basin: 'Atlántico', code: 'ATL', file: path.join(ROOT, 'data', 'hurdat2_atlantic_1851_2025.txt') },
  { basin: 'Pacífico NE/NC', code: 'PAC', file: path.join(ROOT, 'data', 'hurdat2_pacific_1949_2025.txt') }
];

const parseCoord = (value) => {
  const v = String(value).trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return /[SW]$/i.test(v) ? -n : n;
};

const haversine = (a, b) => {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const category = (wind) => wind >= 137 ? 5 : wind >= 113 ? 4 : wind >= 96 ? 3 : wind >= 83 ? 2 : wind >= 64 ? 1 : wind >= 34 ? 0 : -1;
const fmtDate = (d, t) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4)));

function parseFile(meta) {
  const lines = fs.readFileSync(meta.file, 'utf8').split(/\r?\n/).filter(Boolean);
  const storms = [];
  let current = null;
  for (const line of lines) {
    const cols = line.split(',').map(v => v.trim());
    if (/^[A-Z]{2}\d{6}$/.test(cols[0])) {
      current = { id: cols[0], name: cols[1] || 'SIN NOMBRE', expected: +cols[2], basin: meta.basin, basinCode: meta.code, obs: [] };
      storms.push(current);
      continue;
    }
    if (!current || !/^\d{8}$/.test(cols[0])) continue;
    const wind = +cols[6];
    const pressure = +cols[7];
    current.obs.push({
      date: cols[0], time: cols[1], record: cols[2], status: cols[3],
      lat: parseCoord(cols[4]), lon: parseCoord(cols[5]), wind,
      pressure: pressure > 0 ? pressure : null
    });
  }
  return storms;
}

const rawStorms = DATA_FILES.flatMap(parseFile);
const synoptic = new Set(['0000', '0600', '1200', '1800']);

const storms = rawStorms.map(s => {
  const obs = s.obs.filter(o => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.wind));
  const times = obs.map(o => fmtDate(o.date, o.time));
  const peak = obs.reduce((best, o) => o.wind > best.wind ? o : best, obs[0]);
  const pressures = obs.filter(o => o.pressure);
  let trackKm = 0;
  for (let i = 1; i < obs.length; i++) {
    const step = haversine(obs[i - 1], obs[i]);
    if (step < 1200) trackKm += step;
  }
  let ace = 0;
  for (const o of obs) if (synoptic.has(o.time) && ['TS', 'HU'].includes(o.status) && o.wind >= 34) ace += o.wind ** 2 / 10000;
  let max24 = 0;
  for (let i = 0; i < obs.length; i++) {
    const ti = fmtDate(obs[i].date, obs[i].time).getTime();
    for (let j = i - 1; j >= 0; j--) {
      const tj = fmtDate(obs[j].date, obs[j].time).getTime();
      const hours = (ti - tj) / 36e5;
      if (hours > 30) break;
      if (hours >= 18) max24 = Math.max(max24, obs[i].wind - obs[j].wind);
    }
  }
  const genesis = obs.find(o => ['TD', 'TS', 'HU', 'SD', 'SS'].includes(o.status)) || obs[0];
  const first = times[0], last = times.at(-1);
  return {
    id: s.id, name: s.name, basin: s.basin, basinCode: s.basinCode,
    year: +s.id.slice(4), month: +(genesis?.date.slice(4, 6) || 0),
    maxWind: peak?.wind || 0, category: category(peak?.wind || 0),
    minPressure: pressures.length ? Math.min(...pressures.map(o => o.pressure)) : null,
    ace: +ace.toFixed(2), durationDays: first && last ? +((last - first) / 864e5).toFixed(2) : 0,
    trackKm: Math.round(trackKm), max24, rapid: max24 >= 30,
    landfall: obs.some(o => o.record === 'L'),
    genesis: genesis ? [genesis.lon, genesis.lat] : null,
    peak: peak ? [peak.lon, peak.lat] : null,
    track: obs.map(o => [o.lon, o.lat, o.wind, +o.date.slice(4, 6)])
  };
});

const years = [];
for (const basin of ['ATL', 'PAC']) {
  const minYear = basin === 'ATL' ? 1851 : 1949;
  for (let year = minYear; year <= 2025; year++) {
    const ss = storms.filter(s => s.basinCode === basin && s.year === year);
    years.push({
      basin, year, storms: ss.length,
      hurricanes: ss.filter(s => s.maxWind >= 64).length,
      majors: ss.filter(s => s.maxWind >= 96).length,
      ace: +ss.reduce((a, s) => a + s.ace, 0).toFixed(2),
      ri: ss.filter(s => s.rapid).length,
      landfalls: ss.filter(s => s.landfall).length
    });
  }
}

// Payload espacial compacto: claves cortas y solo las variables usadas por la página.
// Las trayectorias se guardan desde 1950, redondeadas a 0.1° y con muestreo 3:1.
const spatialStorms = storms.map(s => ({
  i: s.id, n: s.name, b: s.basinCode, y: s.year, m: s.month,
  w: s.maxWind, c: s.category, p: s.minPressure, a: s.ace,
  d: s.trackKm, k: s.max24, r: s.rapid ? 1 : 0, l: s.landfall ? 1 : 0,
  g: s.genesis?.map(v => +v.toFixed(1)) ?? null,
  q: s.peak?.map(v => +v.toFixed(1)) ?? null
}));
const spatialTracks = storms.filter(s => s.maxWind >= 64 && s.year >= 1950).map(s => ({
  i: s.id,
  p: s.track
    .filter((_, i, a) => i === 0 || i === a.length - 1 || i % 3 === 0)
    .map(p => [+p[0].toFixed(1), +p[1].toFixed(1)])
}));

const json = JSON.stringify({ s: spatialStorms, t: spatialTracks }).replaceAll('</script', '<\\/script');

const commonCss = `
:root{--bg:#07111d;--panel:#0d1c2b;--panel2:#12263a;--text:#eef7ff;--muted:#91a7bb;--accent:#55d6be;--accent2:#ffb86b;--danger:#ff6688;--line:#244058;--shadow:0 18px 60px rgba(0,0,0,.28)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}button,select,input{font:inherit}a{color:inherit}.wrap{width:min(1440px,94vw);margin:auto}.hero{padding:64px 0 34px;border-bottom:1px solid var(--line);background:radial-gradient(circle at 85% 10%,rgba(85,214,190,.15),transparent 32%)}.eyebrow{font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:800}.hero h1{font-size:clamp(2.35rem,5vw,5.4rem);line-height:.94;max-width:1000px;margin:.25em 0}.hero p{color:var(--muted);max-width:760px;font-size:1.08rem}.meta{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.chip{border:1px solid var(--line);border-radius:999px;padding:7px 12px;color:var(--muted);font-size:.85rem}.section{padding:34px 0}.controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;padding:15px;background:var(--panel);border:1px solid var(--line);border-radius:18px;position:sticky;top:10px;z-index:5;box-shadow:var(--shadow)}.control{display:grid;gap:5px}.control label{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}.control select,.control input{color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 12px}.btn{color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 13px;cursor:pointer}.btn.active{background:var(--accent);color:#03110e;border-color:var(--accent);font-weight:800}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px}.kpi .v{font-size:clamp(1.7rem,3vw,2.8rem);font-weight:850;line-height:1}.kpi .l{color:var(--muted);margin-top:8px;font-size:.88rem}.grid2{display:grid;grid-template-columns:1.6fr 1fr;gap:16px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:var(--shadow);min-width:0}.panel h2,.panel h3{margin:0 0 5px}.sub{color:var(--muted);font-size:.9rem;margin:0 0 15px}.chart{width:100%;min-height:320px;position:relative}.mapCanvas{width:100%;height:550px;display:block;border-radius:14px;background:#061725;cursor:crosshair}.tooltip{position:fixed;pointer-events:none;opacity:0;z-index:20;background:#02080e;color:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-size:.82rem;box-shadow:var(--shadow);max-width:240px}.report{margin-top:18px;background:linear-gradient(135deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:24px;padding:clamp(24px,4vw,50px)}.report h2{font-size:clamp(1.8rem,3vw,3rem);margin:.2em 0}.report-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}.report p{color:#c4d1dc}.note{border-left:3px solid var(--accent2);padding:10px 14px;background:rgba(255,184,107,.08);color:#d9c6ac}.source{font-size:.82rem;color:var(--muted);padding:28px 0 52px}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;border-bottom:1px solid var(--line);padding:9px 7px;font-size:.88rem}.table th{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.07em}.table tbody tr{cursor:pointer}.table tbody tr:hover{background:rgba(85,214,190,.08)}svg{overflow:visible}.axis{stroke:var(--line);stroke-width:1}.gridline{stroke:var(--line);stroke-width:1;opacity:.55}.svgText{fill:var(--muted);font-size:12px}.legend{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:.8rem;margin:8px 0}.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:4px}.heat-grid{display:grid;gap:3px}.heat-cell{aspect-ratio:1.4;border-radius:3px;display:grid;place-items:center;font-size:.7rem;color:transparent;cursor:help}.heat-cell:hover{color:#fff;outline:1px solid #fff}.story-stat{font-size:3.4rem;font-weight:900;line-height:1;color:var(--accent)}
@media(max-width:900px){.grid2,.report-grid{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}.mapCanvas{height:430px}.controls{position:relative;top:auto}}@media(max-width:560px){.kpis{grid-template-columns:1fr}.hero{padding-top:38px}.wrap{width:min(94vw,100%)}.panel{padding:13px}}
`;

const commonJs = `
const RAW = JSON.parse(document.getElementById('data').textContent);
const DATA = {
  storms: RAW.s.map(s=>({id:s.i,name:s.n,basinCode:s.b,year:s.y,month:s.m,maxWind:s.w,category:s.c,minPressure:s.p,ace:s.a,trackKm:s.d,max24:s.k,rapid:!!s.r,landfall:!!s.l,genesis:s.g,peak:s.q})),
  tracks: RAW.t.map(t=>({id:t.i,track:t.p}))
};
const fmt = new Intl.NumberFormat('es-AR',{maximumFractionDigits:1});
const colors=['#6d8193','#5fd0ff','#55d6be','#ffdc7a','#ff9f68','#ff5577'];
const tip=document.querySelector('.tooltip');
function showTip(e,html){tip.innerHTML=html;tip.style.opacity=1;tip.style.left=Math.min(innerWidth-250,e.clientX+14)+'px';tip.style.top=Math.min(innerHeight-120,e.clientY+14)+'px'}
function hideTip(){tip.style.opacity=0}
function catLabel(c){return c<0?'Depresión':c===0?'Tormenta':'Categoría '+c}
function linReg(rows,key){const a=rows.filter(d=>Number.isFinite(d[key]));if(a.length<2)return 0;const mx=a.reduce((s,d)=>s+d.year,0)/a.length,my=a.reduce((s,d)=>s+d[key],0)/a.length;const den=a.reduce((s,d)=>s+(d.year-mx)**2,0);return den?a.reduce((s,d)=>s+(d.year-mx)*(d[key]-my),0)/den:0}
function svgLine(el,rows,key,color='#55d6be',moving=1){
  const w=Math.max(620,el.clientWidth||620),h=330,p={l:48,r:18,t:18,b:35};el.innerHTML='';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',\`0 0 \${w} \${h}\`);svg.style.width='100%';
  const vals=rows.map((d,i)=>{let v=d[key];if(moving>1){const s=rows.slice(Math.max(0,i-moving+1),i+1);v=s.reduce((a,b)=>a+b[key],0)/s.length}return {...d,v}});const max=Math.max(1,...vals.map(d=>d.v))*1.08,minY=Math.min(...vals.map(d=>d.year)),maxY=Math.max(...vals.map(d=>d.year));const x=y=>(p.l+(y-minY)/(maxY-minY||1)*(w-p.l-p.r)),yy=v=>(h-p.b-v/max*(h-p.t-p.b));
  for(let i=0;i<=4;i++){const y=p.t+i*(h-p.t-p.b)/4;svg.innerHTML+=\`<line class="gridline" x1="\${p.l}" x2="\${w-p.r}" y1="\${y}" y2="\${y}"/><text class="svgText" x="4" y="\${y+4}">\${fmt.format(max*(1-i/4))}</text>\`}
  const pts=vals.map(d=>\`\${x(d.year)},\${yy(d.v)}\`).join(' ');svg.innerHTML+=\`<polyline fill="none" stroke="\${color}" stroke-width="3" points="\${pts}"/>\`;
  vals.forEach((d,i)=>{const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',x(d.year));c.setAttribute('cy',yy(d.v));c.setAttribute('r','6');c.setAttribute('fill','transparent');c.addEventListener('mousemove',e=>showTip(e,\`<b>\${d.year}</b><br>\${fmt.format(d.v)}\`));c.addEventListener('mouseleave',hideTip);svg.appendChild(c)});
  [minY,Math.round((minY+maxY)/2),maxY].forEach(v=>svg.innerHTML+=\`<text class="svgText" x="\${x(v)}" y="\${h-8}" text-anchor="middle">\${v}</text>\`);el.appendChild(svg)
}
`;

function shell({ title, className='', body, script, extraCss='', extraHead='' }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Análisis espacial interactivo de ciclones HURDAT2"><title>${title}</title>${extraHead}<style>${commonCss}${extraCss}</style></head><body class="${className}">${body}<div class="tooltip"></div><script id="data" type="application/json">${json}</script><script>${commonJs}${script}</script></body></html>`;
}

const body1 = `
<header class="hero"><div class="wrap"><div class="eyebrow">HURDAT2 · Atlas interactivo</div><h1>Dos océanos, 175 años de ciclones.</h1><p>Una lectura cartográfica del archivo oficial de trayectorias del National Hurricane Center. Filtrá el mapa, recorré las temporadas y compará los sistemas más extremos.</p><div class="meta"><span class="chip">Atlántico 1851–2025</span><span class="chip">Pacífico NE/NC 1949–2025</span><span class="chip">Viento en nudos</span><span class="chip">Trayectorias de huracanes</span></div></div></header>
<main class="wrap section"><div class="controls"><div class="control"><label>Cuenca</label><select id="basin"><option value="ALL">Ambas cuencas</option><option value="ATL">Atlántico</option><option value="PAC">Pacífico NE/NC</option></select></div><div class="control"><label>Período</label><select id="era"><option value="1851-2025">Todo el registro</option><option value="1851-1949">1851–1949</option><option value="1950-1989">1950–1989</option><option value="1990-2025">1990–2025</option></select></div><div class="control"><label>Intensidad mínima</label><select id="mincat"><option value="1">Huracán</option><option value="3">Huracán mayor</option><option value="4">Categoría 4+</option><option value="5">Categoría 5</option></select></div></div>
<section class="kpis"><div class="kpi"><div class="v" id="kStorms">—</div><div class="l">ciclones registrados</div></div><div class="kpi"><div class="v" id="kHurr">—</div><div class="l">alcanzaron fuerza de huracán</div></div><div class="kpi"><div class="v" id="kMajors">—</div><div class="l">fueron huracanes mayores</div></div><div class="kpi"><div class="v" id="kMax">—</div><div class="l">máximo viento sostenido</div></div></section>
<section class="grid2"><div class="panel"><h2>Mapa de trayectorias</h2><p class="sub">Cada línea es un huracán. El color representa su categoría máxima. Pasá el cursor para identificarlo.</p><canvas class="mapCanvas" id="trackMap"></canvas><div class="legend"><span><i class="dot" style="background:#5fd0ff"></i>Cat. 1</span><span><i class="dot" style="background:#55d6be"></i>Cat. 2</span><span><i class="dot" style="background:#ffdc7a"></i>Cat. 3</span><span><i class="dot" style="background:#ff9f68"></i>Cat. 4</span><span><i class="dot" style="background:#ff5577"></i>Cat. 5</span></div></div><div class="panel"><h2>Sistemas destacados</h2><p class="sub">Ordenados por energía ciclónica acumulada aproximada (ACE).</p><table class="table"><thead><tr><th>Sistema</th><th>Año</th><th>Cat.</th><th>ACE</th></tr></thead><tbody id="topRows"></tbody></table></div></section>
<section class="panel" style="margin-top:16px"><h2>Ritmo histórico</h2><p class="sub">Serie anual de la métrica elegida.</p><div class="legend"><button class="btn active metric" data-key="storms">Ciclones</button><button class="btn metric" data-key="hurricanes">Huracanes</button><button class="btn metric" data-key="majors">Mayores</button><button class="btn metric" data-key="ace">ACE</button></div><div class="chart" id="timeline"></div></section>
<section class="report"><div class="eyebrow">Informe de lectura</div><h2>El archivo muestra intensidad, pero también cambios en la capacidad de observar.</h2><div class="report-grid"><div><p id="reportA"></p><p id="reportB"></p></div><div><p>Las trayectorias más energéticas combinan vientos fuertes y larga duración. Por eso el ranking por ACE no coincide necesariamente con el ranking de viento máximo: un ciclón muy intenso pero breve puede quedar por debajo de otro más persistente.</p><div class="note">Precaución: antes de los satélites, muchos sistemas de corta duración o alejados de tierra podían no ser detectados. Las comparaciones temporales son más sólidas desde mediados de la década de 1960.</div></div></div></section>
<footer class="source">Fuente: NOAA/National Hurricane Center, HURDAT2 (versiones actualizadas en septiembre de 2026, datos hasta 2025). ACE aproximado calculado en observaciones sinópticas de 6 horas con estado TS/HU. Elaboración propia.</footer></main>`;

const script1 = `
const map=document.getElementById('trackMap'),ctx=map.getContext('2d');let visible=[],metric='storms',hoverPaths=[];
const land=[[[ -168,72],[-140,70],[-125,55],[-124,42],[-117,32],[-105,24],[-97,20],[-84,25],[-81,31],[-75,40],[-66,46],[-53,48],[-60,57],[-80,67],[-110,72]], [[-81,12],[-74,10],[-70,0],[-61,-10],[-51,-25],[-55,-40],[-68,-55],[-76,-40],[-80,-20],[-81,12]], [[-18,36],[-8,35],[4,37],[12,34],[16,22],[8,5],[-5,4],[-16,15],[-18,36]], [[-10,36],[-5,43],[3,50],[15,56],[25,60],[30,70],[5,72],[-10,60],[-10,36]]];
function size(){const d=devicePixelRatio||1,r=map.getBoundingClientRect();map.width=r.width*d;map.height=r.height*d;ctx.setTransform(d,0,0,d,0,0)}function proj(p){const r=map.getBoundingClientRect();return[(p[0]+180)/205*r.width,(76-p[1])/86*r.height]}
function draw(){size();const r=map.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);ctx.fillStyle='#061725';ctx.fillRect(0,0,r.width,r.height);ctx.strokeStyle='#18384f';ctx.lineWidth=1;for(let lon=-180;lon<=20;lon+=20){let a=proj([lon,-10]),b=proj([lon,76]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke()}for(let lat=0;lat<=60;lat+=15){let a=proj([-180,lat]),b=proj([20,lat]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke()}ctx.fillStyle='#112f38';ctx.strokeStyle='#28525a';land.forEach(poly=>{ctx.beginPath();poly.forEach((p,i)=>i?ctx.lineTo(...proj(p)):ctx.moveTo(...proj(p)));ctx.closePath();ctx.fill();ctx.stroke()});hoverPaths=[];visible.forEach(t=>{ctx.strokeStyle=colors[t.category];ctx.globalAlpha=.28+.1*t.category;ctx.lineWidth=t.category>=4?1.6:1;ctx.beginPath();const pp=t.track.map(proj);pp.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();hoverPaths.push({t,pp})});ctx.globalAlpha=1}
function distSeg(p,a,b){const x=b[0]-a[0],y=b[1]-a[1],l=x*x+y*y||1,t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/l));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y)}
map.addEventListener('mousemove',e=>{const r=map.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top];let best=null,bd=9;hoverPaths.forEach(o=>{for(let i=1;i<o.pp.length;i++){const d=distSeg(p,o.pp[i-1],o.pp[i]);if(d<bd){bd=d;best=o.t}}});best?showTip(e,\`<b>\${best.name} · \${best.year}</b><br>\${catLabel(best.category)} · \${best.maxWind} kt<br>ACE aprox. \${fmt.format(best.ace)}\`):hideTip()});map.addEventListener('mouseleave',hideTip);
function update(){const basin=document.getElementById('basin').value,[a,b]=document.getElementById('era').value.split('-').map(Number),mc=+document.getElementById('mincat').value;const ss=DATA.storms.filter(s=>(basin==='ALL'||s.basinCode===basin)&&s.year>=a&&s.year<=b);visible=DATA.tracks.filter(s=>(basin==='ALL'||s.basin===basin)&&s.year>=a&&s.year<=b&&s.category>=mc);document.getElementById('kStorms').textContent=fmt.format(ss.length);document.getElementById('kHurr').textContent=fmt.format(ss.filter(s=>s.maxWind>=64).length);document.getElementById('kMajors').textContent=fmt.format(ss.filter(s=>s.maxWind>=96).length);const strongest=ss.reduce((x,s)=>s.maxWind>(x?.maxWind||0)?s:x,null);document.getElementById('kMax').textContent=strongest?strongest.maxWind+' kt':'—';document.getElementById('topRows').innerHTML=ss.slice().sort((x,y)=>y.ace-x.ace).slice(0,12).map(s=>\`<tr><td><b>\${s.name}</b><br><small>\${s.basinCode}</small></td><td>\${s.year}</td><td>\${s.category>0?s.category:'TS'}</td><td>\${fmt.format(s.ace)}</td></tr>\`).join('');const ys=DATA.years.filter(y=>(basin==='ALL'||y.basin===basin)&&y.year>=a&&y.year<=b);const merged=basin==='ALL'?[...new Set(ys.map(y=>y.year))].map(year=>{const z=ys.filter(y=>y.year===year);return {year,...['storms','hurricanes','majors','ace'].reduce((o,k)=>(o[k]=z.reduce((q,d)=>q+d[k],0),o),{})}}):ys;svgLine(document.getElementById('timeline'),merged,metric,metric==='ace'?'#ffb86b':'#55d6be');document.getElementById('reportA').innerHTML=\`En el recorte seleccionado aparecen <b>\${fmt.format(ss.length)} ciclones</b>; \${fmt.format(ss.filter(s=>s.maxWind>=64).length)} alcanzaron fuerza de huracán y \${fmt.format(ss.filter(s=>s.maxWind>=96).length)} llegaron a categoría mayor. El máximo corresponde a <b>\${strongest?.name||'—'} (\${strongest?.year||'—'})</b>, con \${strongest?.maxWind||'—'} kt.\`;const long=ss.reduce((x,s)=>s.trackKm>(x?.trackKm||0)?s:x,null);document.getElementById('reportB').innerHTML=long?\`La trayectoria estimada más extensa del recorte es la de <b>\${long.name}</b>, con aproximadamente \${fmt.format(long.trackKm)} km. La distancia se calculó uniendo posiciones consecutivas sobre la esfera.\`:'';draw()}
['basin','era','mincat'].forEach(id=>document.getElementById(id).addEventListener('change',update));document.querySelectorAll('.metric').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.metric').forEach(x=>x.classList.remove('active'));b.classList.add('active');metric=b.dataset.key;update()}));addEventListener('resize',draw);update();
`;

const body2 = `
<header class="hero"><div class="wrap"><div class="eyebrow">HURDAT2 · Laboratorio temporal</div><h1>¿Cambió la actividad ciclónica?</h1><p>Una comparación honesta entre señal climática y calidad del registro. Explorá frecuencia, intensidad acumulada y huracanes mayores sin perder de vista los límites de observación.</p><div class="meta"><span class="chip">Series anuales</span><span class="chip">Medias móviles</span><span class="chip">Comparación de períodos</span><span class="chip">Advertencias metodológicas</span></div></div></header>
<main class="wrap section"><div class="controls"><div class="control"><label>Cuenca</label><select id="v2basin"><option value="ATL">Atlántico</option><option value="PAC">Pacífico NE/NC</option></select></div><div class="control"><label>Métrica</label><select id="v2metric"><option value="ace">ACE aproximado</option><option value="storms">Cantidad de ciclones</option><option value="hurricanes">Huracanes</option><option value="majors">Huracanes mayores</option></select></div><div class="control"><label>Inicio del análisis</label><select id="v2start"><option value="1950">1950</option><option value="1966" selected>1966 · era satelital</option><option value="1980">1980</option></select></div><div class="control"><label>Suavizado</label><select id="v2smooth"><option value="1">Sin suavizado</option><option value="5">Media de 5 años</option><option value="10" selected>Media de 10 años</option></select></div></div>
<section class="kpis"><div class="kpi"><div class="v" id="trend">—</div><div class="l">cambio lineal por década</div></div><div class="kpi"><div class="v" id="early">—</div><div class="l">promedio 1966–1995</div></div><div class="kpi"><div class="v" id="late">—</div><div class="l">promedio 1996–2025</div></div><div class="kpi"><div class="v" id="record">—</div><div class="l">temporada récord del período</div></div></section>
<section class="panel"><h2>Serie anual y tendencia visual</h2><p class="sub">La línea suavizada ayuda a ver ciclos multianuales; no reemplaza una prueba de atribución climática.</p><div class="chart" id="trendChart"></div></section>
<section class="grid2" style="margin-top:16px"><div class="panel"><h2>Actividad por mes y década</h2><p class="sub">Cantidad de génesis. La intensidad del color indica concentración estacional.</p><div id="heatmap"></div></div><div class="panel"><h2>Ventanas comparables</h2><p class="sub">Dos períodos de 30 años dentro de la era de observación moderna.</p><div id="compare"></div></div></section>
<section class="report"><div class="eyebrow">Informe temporal</div><h2>Más registros no significan automáticamente más peligro.</h2><div class="report-grid"><div><p id="timeReport"></p><p>El ACE integra intensidad y duración. Es una medida más informativa que contar tormentas, aunque tampoco describe por sí sola el daño: la exposición de población, infraestructura y la trayectoria de entrada a tierra son determinantes.</p></div><div><p>En series ciclónicas hay gran variabilidad de un año a otro. Las medias móviles revelan períodos activos y calmos, pero una tendencia lineal resume demasiado: no captura oscilaciones oceánicas, cambios de medición ni revisiones históricas.</p><div class="note">Conclusión prudente: HURDAT2 permite describir cómo cambió el registro. Para atribuir esos cambios al calentamiento global se necesitan modelos climáticos, correcciones de homogeneidad y literatura especializada.</div></div></div></section>
<footer class="source">Fuente: NOAA/National Hurricane Center, HURDAT2. Período moderno comparado: 1966–2025. Las pendientes son descriptivas y no implican causalidad. Elaboración propia.</footer></main>`;

const css2 = `body{--bg:#f3f6f4;--panel:#fff;--panel2:#e8f0ec;--text:#10251e;--muted:#5c7169;--accent:#007d67;--accent2:#c35e14;--danger:#b52c54;--line:#cfded7;--shadow:0 16px 50px rgba(19,55,42,.09)}.hero{background:linear-gradient(120deg,#edf8f2,#f7efe5)}.kpi .v{color:var(--accent)}.heat-cell{color:transparent}.heat-cell:hover{color:#10251e}.note{color:#5c3b23}.table tbody tr:hover{background:#edf8f2}`;

const script2 = `
function heat(ss){const decs=[...new Set(ss.map(s=>Math.floor(s.year/10)*10))].sort((a,b)=>a-b),months=['E','F','M','A','M','J','J','A','S','O','N','D'];const vals=decs.flatMap(d=>months.map((_,i)=>ss.filter(s=>Math.floor(s.year/10)*10===d&&s.month===i+1).length));const max=Math.max(...vals,1);const el=document.getElementById('heatmap');el.innerHTML=\`<div class="heat-grid" style="grid-template-columns:64px repeat(12,1fr)"><span></span>\${months.map(m=>\`<b style="font-size:.72rem;text-align:center;color:var(--muted)">\${m}</b>\`).join('')}\${decs.map(d=>\`<b style="font-size:.72rem;color:var(--muted);align-self:center">\${d}s</b>\${months.map((m,i)=>{const v=ss.filter(s=>Math.floor(s.year/10)*10===d&&s.month===i+1).length,a=.08+.92*v/max;return \`<div class="heat-cell" title="\${d}s · mes \${i+1}: \${v}" style="background:rgba(0,125,103,\${a})">\${v}</div>\`}).join('')}\`).join('')}</div>\`}
function update2(){const basin=document.getElementById('v2basin').value,key=document.getElementById('v2metric').value,start=+document.getElementById('v2start').value,smooth=+document.getElementById('v2smooth').value;const rows=DATA.years.filter(d=>d.basin===basin&&d.year>=start),ss=DATA.storms.filter(s=>s.basinCode===basin&&s.year>=start);svgLine(document.getElementById('trendChart'),rows,key,key==='ace'?'#c35e14':'#007d67',smooth);const slope=linReg(rows,key)*10;document.getElementById('trend').textContent=(slope>=0?'+':'')+fmt.format(slope);const avg=(a,b)=>{const z=DATA.years.filter(d=>d.basin===basin&&d.year>=a&&d.year<=b);return z.reduce((q,d)=>q+d[key],0)/z.length};document.getElementById('early').textContent=fmt.format(avg(1966,1995));document.getElementById('late').textContent=fmt.format(avg(1996,2025));const rec=rows.reduce((x,d)=>d[key]>(x?.[key]??-1)?d:x,null);document.getElementById('record').textContent=rec?rec.year+' · '+fmt.format(rec[key]):'—';heat(ss);const names={ace:'ACE',storms:'ciclones',hurricanes:'huracanes',majors:'huracanes mayores'};const a=avg(1966,1995),b=avg(1996,2025),pct=a?100*(b-a)/a:0;document.getElementById('compare').innerHTML=\`<div style="display:grid;gap:14px"><div class="kpi"><div class="eyebrow">1966–1995</div><div class="story-stat">\${fmt.format(a)}</div><div class="l">\${names[key]} por año</div></div><div class="kpi"><div class="eyebrow">1996–2025</div><div class="story-stat">\${fmt.format(b)}</div><div class="l">\${names[key]} por año · <b>\${pct>=0?'+':''}\${fmt.format(pct)}%</b> respecto del período anterior</div></div></div>\`;document.getElementById('timeReport').innerHTML=\`En la cuenca seleccionada, la pendiente descriptiva desde \${start} es de <b>\${slope>=0?'+':''}\${fmt.format(slope)} unidades de \${names[key]} por década</b>. Entre las dos ventanas modernas, el promedio pasó de \${fmt.format(a)} a \${fmt.format(b)} (\${pct>=0?'+':''}\${fmt.format(pct)}%). La temporada récord del recorte fue <b>\${rec.year}</b>.\`}
['v2basin','v2metric','v2start','v2smooth'].forEach(id=>document.getElementById(id).addEventListener('change',update2));addEventListener('resize',update2);update2();
`;

const body3 = `
<header class="hero"><div class="wrap"><div class="eyebrow">HURDAT2 · Anatomía espacial</div><h1>Dónde nacen, cuándo crecen, cómo se intensifican.</h1><p>Un laboratorio sobre génesis, picos de intensidad y cambios rápidos de viento. La unidad de análisis es cada ciclón y su recorrido de seis horas.</p><div class="meta"><span class="chip">Densidad espacial</span><span class="chip">Estacionalidad</span><span class="chip">Intensificación en 24 h</span><span class="chip">Ciclo de vida</span></div></div></header>
<main class="wrap section"><div class="controls"><div class="control"><label>Cuenca</label><select id="v3basin"><option value="ATL">Atlántico</option><option value="PAC">Pacífico NE/NC</option><option value="ALL">Ambas</option></select></div><div class="control"><label>Capa espacial</label><select id="layer"><option value="genesis">Puntos de génesis</option><option value="peak">Picos de intensidad</option><option value="rapid">Intensificación rápida</option></select></div><div class="control"><label>Desde</label><select id="v3start"><option value="1950">1950</option><option value="1966" selected>1966</option><option value="1990">1990</option><option value="2010">2010</option></select></div><div class="control"><label>Mes de génesis</label><select id="month"><option value="0">Todos</option><option value="6">Junio</option><option value="7">Julio</option><option value="8">Agosto</option><option value="9">Septiembre</option><option value="10">Octubre</option><option value="11">Noviembre</option></select></div></div>
<section class="kpis"><div class="kpi"><div class="v" id="riShare">—</div><div class="l">con intensificación rápida</div></div><div class="kpi"><div class="v" id="peakMonth">—</div><div class="l">mes de mayor génesis</div></div><div class="kpi"><div class="v" id="medianTrack">—</div><div class="l">trayectoria mediana</div></div><div class="kpi"><div class="v" id="landfall">—</div><div class="l">con marca de entrada a tierra</div></div></section>
<section class="grid2"><div class="panel"><h2>Mapa mundial de eventos</h2><p class="sub">Mapa geográfico real con calles o imagen satelital. Cada punto corresponde a un ciclón del archivo HURDAT2; hacé clic para inspeccionarlo.</p><div class="worldMap" id="worldMap" aria-label="Mapa mundial interactivo de ciclones"></div><div class="mapLegend"><span><i></i>Evento seleccionado</span><span>El tamaño representa intensidad máxima</span><span>Podés alternar Calles / Satélite arriba a la derecha</span></div></div><div class="panel"><h2>Calendario ciclónico</h2><p class="sub">Distribución mensual de la génesis en el recorte.</p><div class="chart" id="season"></div><h3 style="margin-top:18px">Lectura inmediata</h3><p id="seasonText" class="sub"></p></div></section>
<section class="grid2" style="margin-top:16px"><div class="panel"><h2>Intensificación vs. intensidad máxima</h2><p class="sub">Cada punto es un ciclón. El eje horizontal muestra el mayor aumento de viento observado en una ventana cercana a 24 horas.</p><div class="chart" id="scatter"></div></div><div class="panel"><h2>Casos extremos</h2><p class="sub">Los mayores saltos de viento en 24 horas del recorte.</p><table class="table"><thead><tr><th>Sistema</th><th>Año</th><th>Δ viento</th><th>Pico</th></tr></thead><tbody id="riTable"></tbody></table></div></section>
<section class="report"><div class="eyebrow">Informe espacial</div><h2>La temporada tiene geografía: el lugar de nacimiento condiciona el recorrido.</h2><div class="report-grid"><div><p id="spaceReport"></p><p>La densidad de génesis revela corredores preferentes asociados a temperatura superficial del mar, cizalladura vertical y perturbaciones precursoras. Los picos de intensidad se desplazan respecto de la génesis porque el ciclón necesita tiempo y condiciones oceánicas favorables para organizarse.</p></div><div><p>Se clasifica como intensificación rápida un aumento de al menos 30 kt en aproximadamente 24 horas. Este indicador importa operacionalmente porque reduce el tiempo disponible para prepararse, pero depende de la resolución temporal y de la calidad de las estimaciones de viento.</p><div class="note">El mapa es descriptivo: una celda con muchas génesis no equivale a mayor riesgo costero. El riesgo combina amenaza, exposición y vulnerabilidad.</div></div></div></section>
<footer class="source">Fuente de datos: NOAA/National Hurricane Center, HURDAT2. Cartografía: OpenStreetMap y Esri World Imagery. Distancias por haversine; intensificación rápida: Δv ≥ 30 kt en ~24 h. Elaboración propia.</footer></main>`;

const css3 = `body{--bg:#100b18;--panel:#1a1226;--panel2:#241733;--text:#fff8f2;--muted:#baa9c7;--accent:#f2c14e;--accent2:#f78154;--danger:#f45b69;--line:#3b284d;--shadow:0 18px 60px rgba(0,0,0,.35)}.hero{background:radial-gradient(circle at 80% 20%,rgba(242,193,78,.18),transparent 30%),linear-gradient(160deg,#100b18,#1b0c29)}.kpi .v{color:var(--accent)}.note{color:#ead9c6}.worldMap{height:590px;width:100%;border-radius:14px;background:#0d0715;overflow:hidden}.leaflet-container{font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#1a1226;color:#fff8f2}.leaflet-control-layers,.leaflet-bar a{background:#1a1226;color:#fff8f2;border-color:#3b284d}.leaflet-control-layers label{color:#fff8f2}.mapLegend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;color:var(--muted);font-size:.8rem}.mapLegend i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#f2c14e;margin-right:5px}.leaflet-tooltip{background:#100b18;color:#fff8f2;border-color:#3b284d;box-shadow:var(--shadow)}@media(max-width:900px){.worldMap{height:480px}}`;

const script3 = `
const monthNames=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:9,attribution:'&copy; OpenStreetMap contributors'});
const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:9,attribution:'Tiles &copy; Esri'});
const worldMap=L.map('worldMap',{center:[25,-82],zoom:3,minZoom:2,maxZoom:9,preferCanvas:true,worldCopyJump:true,layers:[street]});
L.control.layers({'Calles · OpenStreetMap':street,'Satélite · Esri':satellite},null,{collapsed:false}).addTo(worldMap);
const trackLayer=L.layerGroup().addTo(worldMap);
const PointCanvas=L.Layer.extend({
  onAdd(map){this.map=map;this.canvas=L.DomUtil.create('canvas','leaflet-zoom-animated hurdat-points');this.canvas.style.pointerEvents='none';map.getPanes().overlayPane.appendChild(this.canvas);map.on('moveend zoomend resize',this.redraw,this);this.redraw()},
  onRemove(map){L.DomUtil.remove(this.canvas);map.off('moveend zoomend resize',this.redraw,this)},
  setData(rows,layer){this.rows=rows;this.layer=layer;this.redraw()},
  redraw(){if(!this.map||!this.canvas)return;const size=this.map.getSize(),d=Math.min(devicePixelRatio||1,2),origin=this.map.containerPointToLayerPoint([0,0]);L.DomUtil.setPosition(this.canvas,origin);this.canvas.width=size.x*d;this.canvas.height=size.y*d;this.canvas.style.width=size.x+'px';this.canvas.style.height=size.y+'px';const c=this.canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,size.x,size.y);this.screen=[];(this.rows||[]).forEach(s=>{const p=this.layer==='peak'?s.peak:s.genesis;if(!p)return;const xy=this.map.latLngToContainerPoint([p[1],p[0]]),r=Math.max(2.5,Math.min(8,2+s.maxWind/32)),color=s.rapid?'#f45b69':this.layer==='peak'?'#f78154':'#f2c14e';c.beginPath();c.arc(xy.x,xy.y,r,0,Math.PI*2);c.fillStyle=color;c.globalAlpha=.68;c.fill();c.strokeStyle='#100b18';c.lineWidth=.6;c.globalAlpha=.9;c.stroke();this.screen.push({x:xy.x,y:xy.y,r:r+5,s,color})});c.globalAlpha=1},
  nearest(pt){let best=null,bd=12;for(const o of this.screen||[]){const d=Math.hypot(pt.x-o.x,pt.y-o.y);if(d<Math.max(bd,o.r)){bd=d;best=o}}return best}
});
const pointCanvas=new PointCanvas().addTo(worldMap);
function popupHtml(s){return \`<div style="min-width:190px"><b style="font-size:16px">\${s.name}</b><br>Temporada: \${s.year}<br>Viento máximo: <b>\${s.maxWind} kt</b><br>Presión mínima: <b>\${s.minPressure??'sin dato'} hPa</b><br>ACE aproximado: <b>\${fmt.format(s.ace)}</b><br>Recorrido estimado: <b>\${fmt.format(s.trackKm)} km</b><br>Δ máximo en 24 h: <b>+\${s.max24} kt</b></div>\`}
worldMap.on('mousemove',e=>{const o=pointCanvas.nearest(e.containerPoint);worldMap.getContainer().style.cursor=o?'pointer':'';o?showTip(e.originalEvent,\`<b>\${o.s.name} · \${o.s.year}</b><br>\${o.s.basinCode} · \${catLabel(o.s.category)}\`):hideTip()});
worldMap.on('mouseout',()=>{worldMap.getContainer().style.cursor='';hideTip()});
worldMap.on('click',e=>{const o=pointCanvas.nearest(e.containerPoint);if(!o)return;trackLayer.clearLayers();const t=DATA.tracks.find(t=>t.id===o.s.id);if(t)L.polyline(t.track.map(p=>[p[1],p[0]]),{color:o.color,weight:3,opacity:.9}).addTo(trackLayer);L.popup().setLatLng(e.latlng).setContent(popupHtml(o.s)).openOn(worldMap)});
function drawWorldMap(ss,layer){trackLayer.clearLayers();const shown=ss.filter(s=>layer!=='rapid'||s.rapid);pointCanvas.setData(shown,layer);document.querySelector('.mapLegend span:first-child').lastChild.textContent=\` \${shown.length} eventos visibles\`;}
function seasonChart(ss){const vals=Array.from({length:12},(_,i)=>ss.filter(s=>s.month===i+1).length),max=Math.max(...vals,1),el=document.getElementById('season'),w=Math.max(380,el.clientWidth||380),h=330,cx=w/2,cy=h/2,R=Math.min(w,h)*.38;el.innerHTML='';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',\`0 0 \${w} \${h}\`);svg.style.width='100%';vals.forEach((v,i)=>{const a=-Math.PI/2+i*Math.PI*2/12,r=35+R*v/max,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r,x0=cx+Math.cos(a)*35,y0=cy+Math.sin(a)*35;svg.innerHTML+=\`<line x1="\${x0}" y1="\${y0}" x2="\${x}" y2="\${y}" stroke="\${i>=7&&i<=9?'#f45b69':'#f2c14e'}" stroke-width="18" stroke-linecap="round"/><text class="svgText" x="\${cx+Math.cos(a)*(R+54)}" y="\${cy+Math.sin(a)*(R+54)+4}" text-anchor="middle">\${monthNames[i].slice(0,3)}</text>\`});svg.innerHTML+=\`<circle cx="\${cx}" cy="\${cy}" r="42" fill="#241733"/><text x="\${cx}" y="\${cy-3}" text-anchor="middle" fill="#fff" font-size="22" font-weight="800">\${ss.length}</text><text x="\${cx}" y="\${cy+17}" text-anchor="middle" fill="#baa9c7" font-size="11">ciclones</text>\`;el.appendChild(svg)}
function scatter(ss){const el=document.getElementById('scatter'),w=Math.max(500,el.clientWidth||500),h=340,p={l:48,r:18,t:18,b:35},xmax=Math.max(40,...ss.map(s=>s.max24)),ymax=Math.max(80,...ss.map(s=>s.maxWind));el.innerHTML='';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',\`0 0 \${w} \${h}\`);svg.style.width='100%';const x=v=>p.l+v/xmax*(w-p.l-p.r),y=v=>h-p.b-v/ymax*(h-p.t-p.b);svg.innerHTML=\`<line class="axis" x1="\${p.l}" x2="\${w-p.r}" y1="\${h-p.b}" y2="\${h-p.b}"/><line class="axis" x1="\${p.l}" x2="\${p.l}" y1="\${p.t}" y2="\${h-p.b}"/><line x1="\${x(30)}" x2="\${x(30)}" y1="\${p.t}" y2="\${h-p.b}" stroke="#f45b69" stroke-dasharray="5 5"/><text class="svgText" x="\${x(30)+4}" y="30">umbral RI</text><text class="svgText" x="\${w/2}" y="\${h-5}" text-anchor="middle">máximo aumento en 24 h (kt)</text>\`;ss.forEach(s=>{const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',x(s.max24));c.setAttribute('cy',y(s.maxWind));c.setAttribute('r',Math.max(2,Math.min(8,2+s.trackKm/2500)));c.setAttribute('fill',s.rapid?'#f45b69':'#f2c14e');c.setAttribute('opacity','.62');c.addEventListener('mousemove',e=>showTip(e,\`<b>\${s.name} · \${s.year}</b><br>Δ24 h: \${s.max24} kt<br>Pico: \${s.maxWind} kt<br>Recorrido: \${fmt.format(s.trackKm)} km\`));c.addEventListener('mouseleave',hideTip);svg.appendChild(c)});el.appendChild(svg)}
function update3(){const basin=document.getElementById('v3basin').value,layer=document.getElementById('layer').value,start=+document.getElementById('v3start').value,month=+document.getElementById('month').value;const ss=DATA.storms.filter(s=>(basin==='ALL'||s.basinCode===basin)&&s.year>=start&&(!month||s.month===month));drawWorldMap(ss,layer);seasonChart(ss);scatter(ss);const ri=ss.filter(s=>s.rapid),months=Array.from({length:12},(_,i)=>ss.filter(s=>s.month===i+1).length),pm=months.indexOf(Math.max(...months))+1,sorted=ss.map(s=>s.trackKm).sort((a,b)=>a-b),median=sorted.length?sorted[Math.floor(sorted.length/2)]:0;document.getElementById('riShare').textContent=ss.length?fmt.format(100*ri.length/ss.length)+'%':'—';document.getElementById('peakMonth').textContent=pm?monthNames[pm-1]:'—';document.getElementById('medianTrack').textContent=fmt.format(median)+' km';document.getElementById('landfall').textContent=ss.length?fmt.format(100*ss.filter(s=>s.landfall).length/ss.length)+'%':'—';document.getElementById('seasonText').textContent=\`El máximo de génesis se concentra en \${monthNames[pm-1]||'—'}. El gráfico radial permite ver cuán estrecha o extendida es la temporada.\`;document.getElementById('riTable').innerHTML=ss.slice().sort((a,b)=>b.max24-a.max24).slice(0,12).map(s=>\`<tr><td><b>\${s.name}</b><br><small>\${s.basinCode}</small></td><td>\${s.year}</td><td>+\${s.max24} kt</td><td>\${s.maxWind} kt</td></tr>\`).join('');const strongest=ss.reduce((x,s)=>s.maxWind>(x?.maxWind||0)?s:x,null),riTop=ri.reduce((x,s)=>s.max24>(x?.max24||0)?s:x,null);document.getElementById('spaceReport').innerHTML=\`Desde \${start}, el recorte contiene <b>\${ss.length} ciclones</b>. Un \${ss.length?fmt.format(100*ri.length/ss.length):0}% mostró intensificación rápida; el mayor salto fue <b>\${riTop?.name||'—'} (\${riTop?.year||'—'})</b>, con +\${riTop?.max24||0} kt. El sistema más intenso del recorte fue <b>\${strongest?.name||'—'}</b>, con \${strongest?.maxWind||0} kt.\`}
['v3basin','layer','v3start','month'].forEach(id=>document.getElementById(id).addEventListener('change',update3));update3();setTimeout(()=>worldMap.invalidateSize(),100);
`;

const outputs = [
  ['index.html', shell({ title: 'HURDAT2 · Análisis espacial', body: body3, script: script3, extraCss: css3, extraHead: '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' })]
];

for (const [name, content] of outputs) fs.writeFileSync(path.join(ROOT, name), content, 'utf8');
console.log(JSON.stringify({ storms: storms.length, tracks: spatialTracks.length, files: outputs.map(([name, content]) => ({ name, bytes: Buffer.byteLength(content) })) }, null, 2));
