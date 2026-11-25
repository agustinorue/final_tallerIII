(() => {
  'use strict';

  const numberFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit' });
  const metricLabels = {
    w: ['Viento m&aacute;ximo', value => `${value} kt`],
    p: ['Presi&oacute;n m&iacute;nima', value => value == null ? 'Sin dato' : `${value} hPa`],
    a: ['ACE acumulado', value => numberFormat.format(value)],
    d: ['Distancia recorrida', value => `${numberFormat.format(value)} km`],
    v: ['Velocidad media', value => `${numberFormat.format(value)} km/h`],
    k: ['Aumento m&aacute;ximo en 24 h', value => `+${value} kt`]
  };
  const statusLabels = {
    TD: 'Depresi&oacute;n tropical', TS: 'Tormenta tropical', HU: 'Hurac&aacute;n',
    SD: 'Depresi&oacute;n subtropical', SS: 'Tormenta subtropical', EX: 'Extratropical',
    LO: 'Baja', DB: 'Perturbaci&oacute;n', WV: 'Onda tropical', ET: 'Transici&oacute;n extratropical'
  };

  let fullSystems = null;
  let fullDataPromise = null;
  let strongestMap = null;
  let strongestTrack = null;
  let strongestProgress = null;
  let strongestMarker = null;
  let selectedStrongSystem = null;
  let animationIndex = 0;
  let animationTimer = null;
  let threatMap = null;
  let threatHeatLayer = null;
  let threatLocationLayer = null;
  let threatTrackLayer = null;
  let selectedThreatSystem = null;
  let threatAnimationIndex = 0;
  let threatAnimationTimer = null;
  let threatPoint = [-80.1918, 25.7617];
  let choosingThreatPoint = false;
  let landPolygons = null;
  let landDataPromise = null;
  let observationBins = null;
  let lastRiskRender = null;
  let riskMoveTimer = null;
  let trajectoryClusterModel = null;
  let corridorFocus = 'ALL';
  let corridorRenderToken = 0;
  let groupMap = null;
  let groupTrackLayer = null;
  let groupAnimationLayer = null;
  let groupFocus = 'ALL';
  let selectedGroupSystem = null;
  let groupAnimationIndex = 0;
  let groupAnimationTimer = null;
  const corridorColors = ['#f2c14e', '#55d6be', '#f45b69', '#8eb7d8', '#c43cff', '#f78154'];
  const coastLandCache = new Map();
  const coastalWeightCache = new Map();
  const threatMonthNames = ['Todos los meses', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];


  function addThreatControls() {
    if (document.getElementById('threatMonth')) return;
    const radiusControl = document.getElementById('threatRadius').closest('.control');
    const monthControl = document.createElement('div');
    monthControl.className = 'control monthSelect';
    monthControl.innerHTML = `<label for="threatMonth">Mes del a&ntilde;o</label><select id="threatMonth">${threatMonthNames.map((name, month) => `<option value="${month}">${name}</option>`).join('')}</select>`;
    radiusControl.before(monthControl);
    const note = document.createElement('span');
    note.className = 'radiusNote';
    note.textContent = 'El círculo del mapa muestra 100 km';
    document.getElementById('chooseThreatPoint').after(note);
    document.querySelector('#threatContent .panel .sub').innerHTML = 'El color aparece solo sobre tierra y combina frecuencia, cercan&iacute;a, intensidad y proximidad a la costa. El agua queda sin colorear.';
    document.querySelector('#threatContent .riskMethod').innerHTML = 'Escala relativa equilibrada: destaca con claridad las costas m&aacute;s expuestas, evita saturar demasiadas zonas en 100 y reduce gradualmente el puntaje hacia el interior. No es una probabilidad futura.';
    document.querySelector('#threatContent .riskRamp').style.background = 'linear-gradient(90deg,#18308c 0%,#00b4a0 38%,#ff912d 70%,#ff2660 100%)';
    const trackPanel = document.createElement('div');
    trackPanel.className = 'threatTrackPanel';
    trackPanel.innerHTML = `<div id="threatTrackStatus">Toc&aacute; un cicl&oacute;n de la lista para ver su recorrido completo.</div><div class="threatTrackControls"><button type="button" class="btn" id="playThreatTrack">Reproducir</button><button type="button" class="btn" id="pauseThreatTrack">Pausar</button><button type="button" class="btn" id="restartThreatTrack">Reiniciar</button></div>`;
    document.getElementById('threatResults').before(trackPanel);
    const style = document.createElement('style');
    style.textContent = '.threatItem{width:100%;display:block;text-align:left;color:var(--text);font:inherit;cursor:pointer;border-top:0;border-right:0;border-bottom:0}.threatItem:hover,.threatItem[aria-selected="true"]{background:rgba(242,193,78,.12);outline:1px solid rgba(242,193,78,.55)}.threatTrackPanel{padding:10px 0 14px;margin-bottom:10px;border-bottom:1px solid var(--line)}#threatTrackStatus{min-height:42px;color:var(--muted);font-size:.82rem}.threatTrackControls{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.threatTrackControls .btn{padding:6px 9px;font-size:.76rem}';
    document.head.appendChild(style);
  }

  addThreatControls();

  function addTrajectoryGroupingUI() {
    const layerSelect = document.getElementById('layer');
    if (!layerSelect || layerSelect.querySelector('option[value="clusters"]')) return;
    const option = document.createElement('option');
    option.value = 'clusters';
    option.textContent = 'Grupos de trayectorias';
    layerSelect.appendChild(option);
    const panel = document.createElement('div');
    panel.id = 'corridorPanel';
    panel.className = 'corridorPanel';
    panel.hidden = true;
    panel.innerHTML = `<div class="corridorHead"><div><div class="eyebrow">Agrupaci&oacute;n autom&aacute;tica</div><h3>Seis grupos hist&oacute;ricos</h3><p>Los recorridos se comparan en siete momentos equivalentes y se agrupan por cercan&iacute;a geogr&aacute;fica. Las l&iacute;neas finas son casos reales; la l&iacute;nea gruesa representa el recorrido m&aacute;s central de cada grupo.</p></div><button type="button" class="btn" id="showAllCorridors">Mostrar todos</button></div><div class="corridorCards" id="corridorCards"><div class="loadingState">Calculando grupos de trayectorias&hellip;</div></div>`;
    document.querySelector('#worldMap').closest('.panel').appendChild(panel);
    const style = document.createElement('style');
    style.textContent = '.corridorPanel{margin-top:16px;padding:16px;background:var(--panel2);border:1px solid var(--line);border-radius:16px}.corridorHead{display:flex;align-items:start;justify-content:space-between;gap:16px}.corridorHead h3{margin:2px 0}.corridorHead p{margin:4px 0 12px;color:var(--muted);font-size:.82rem;max-width:820px}.corridorCards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.corridorCard{display:grid;grid-template-columns:12px 1fr;gap:9px;text-align:left;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:10px;cursor:pointer}.corridorCard:hover,.corridorCard[aria-selected="true"]{border-color:var(--corridor-color);background:rgba(242,193,78,.08)}.corridorSwatch{width:11px;height:100%;min-height:42px;border-radius:99px;background:var(--corridor-color)}.corridorCard b,.corridorCard span{display:block}.corridorCard span{font-size:.75rem;color:var(--muted)}@media(max-width:900px){.corridorCards{grid-template-columns:1fr 1fr}}@media(max-width:560px){.corridorHead{display:block}.corridorCards{grid-template-columns:1fr}}';
    document.head.appendChild(style);
  }

  addTrajectoryGroupingUI();

  function addTrajectoryPageUI() {
    if (document.getElementById('groupPage')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.appTarget = 'groups';
    button.setAttribute('aria-selected', 'false');
    button.textContent = 'Grupos de trayectorias';
    document.querySelector('[data-app-target="threat"]').before(button);
    const page = document.createElement('section');
    page.className = 'appPage';
    page.id = 'groupPage';
    page.setAttribute('aria-labelledby', 'groupTitle');
    page.innerHTML = `<div class="pageHero"><div><div class="eyebrow">Patrones hist&oacute;ricos de movimiento</div><h1 id="groupTitle">Grupos de trayectorias</h1><p>Comparamos el recorrido completo de cada cicl&oacute;n y lo asignamos a uno de seis grupos geogr&aacute;ficos. Eleg&iacute; un grupo para aislarlo y ver su ruta real m&aacute;s representativa.</p></div></div><div class="pageControls"><div class="control"><label for="groupBasin">Cuenca</label><select id="groupBasin"><option value="ALL">Ambas</option><option value="ATL">Atl&aacute;ntico</option><option value="PAC">Pac&iacute;fico NE/NC</option></select></div><div class="control"><label for="groupStart">Desde</label><select id="groupStart"><option value="1851">1851</option><option value="1950">1950</option><option value="1966">1966 · era satelital</option><option value="1990">1990</option><option value="2010">2010</option></select></div><div class="control"><label for="groupMonth">Mes de g&eacute;nesis</label><select id="groupMonth">${threatMonthNames.map((name, month) => `<option value="${month}">${name}</option>`).join('')}</select></div><button type="button" class="btn active" id="showAllGroups">Mostrar los seis</button></div><div class="selectedSummary" id="groupSummary"><div class="metric"><b id="groupVisible">&mdash;</b><span>trayectorias visibles</span></div><div class="metric"><b id="groupLargest">&mdash;</b><span>grupo m&aacute;s frecuente</span></div><div class="metric"><b id="groupWind">&mdash;</b><span>viento m&aacute;ximo medio</span></div><div class="metric"><b>6</b><span>patrones calculados</span></div></div><div id="groupLoading" class="loadingState">Calculando los grupos hist&oacute;ricos&hellip;</div><div class="trajectoryPageLayout" id="groupContent" hidden><div class="panel"><div class="eyebrow">Mapa comparativo</div><h2 id="groupMapTitle">Los seis grupos</h2><p class="sub" id="groupMapSub">Cada color representa un patr&oacute;n. Las l&iacute;neas finas son ciclones reales y la gruesa es el caso m&aacute;s central del grupo.</p><div class="groupMap" id="groupMap" aria-label="Mapa de grupos de trayectorias hist&oacute;ricas"></div><div class="groupColorLegend" id="groupColorLegend"></div><div class="groupPlayback" id="groupPlayback" hidden><div id="groupPlaybackStatus">Eleg&iacute; un cicl&oacute;n para reproducirlo.</div><div class="animationBar"><button type="button" class="btn active" id="playGroupStorm">Reproducir</button><button type="button" class="btn" id="pauseGroupStorm">Pausar</button><button type="button" class="btn" id="restartGroupStorm">Reiniciar</button></div></div></div><div class="panel groupListPanel"><div class="eyebrow">Seleccionar grupo</div><h2>Tipos de recorrido</h2><p class="sub">La clasificaci&oacute;n surge de estos datos; no es una categor&iacute;a oficial meteorol&oacute;gica.</p><div class="groupCards" id="groupCards"></div><div class="groupCyclonePicker" id="groupCyclonePicker" hidden><div class="eyebrow">Ciclones del grupo</div><h3 id="groupCycloneTitle">Eleg&iacute; un cicl&oacute;n</h3><p class="sub">Ordenados por viento m&aacute;ximo. Toc&aacute; uno para reproducir su recorrido.</p><div class="groupCycloneList" id="groupCycloneList"></div></div></div></div>`;
    document.getElementById('threatPage').before(page);
    const style = document.createElement('style');
    style.textContent = '.trajectoryPageLayout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,.45fr);gap:18px}.groupMap{height:min(70vh,760px);min-height:620px;border-radius:16px;overflow:hidden;background:#0d0715}.groupCards{display:grid;gap:10px}.groupCard{width:100%;display:grid;grid-template-columns:13px 1fr;gap:10px;text-align:left;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px;cursor:pointer}.groupCard:hover,.groupCard[aria-selected="true"]{border-color:var(--group-color);box-shadow:inset 0 0 0 1px var(--group-color)}.groupCard i{display:block;width:12px;height:100%;min-height:50px;border-radius:99px;background:var(--group-color)}.groupCard b,.groupCard span{display:block}.groupCard span{font-size:.78rem;color:var(--muted);margin-top:3px}.groupColorLegend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:12px;color:var(--muted);font-size:.78rem}.groupColorLegend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}.groupListPanel{align-self:start}.groupCyclonePicker{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}.groupCycloneList{display:grid;gap:7px;max-height:440px;overflow:auto}.groupCyclone{width:100%;display:grid;grid-template-columns:1fr auto;gap:8px;text-align:left;color:var(--text);background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:10px;padding:9px 10px;cursor:pointer}.groupCyclone:hover,.groupCyclone[aria-selected="true"]{border-color:var(--accent);background:rgba(242,193,78,.1)}.groupCyclone b,.groupCyclone span{display:block}.groupCyclone span{color:var(--muted);font-size:.74rem}.groupCyclone strong{color:var(--accent);white-space:nowrap}.groupPlayback{margin-top:14px;padding:12px;background:var(--panel2);border:1px solid var(--line);border-radius:12px}.groupPlayback #groupPlaybackStatus{min-height:42px;color:var(--muted);font-size:.84rem}.sidebarNav{grid-auto-rows:min-content}@media(max-width:1100px){.trajectoryPageLayout{grid-template-columns:1fr}.groupMap{height:600px;min-height:520px}.groupCards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:800px){.sidebarNav{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:580px){.groupCards{grid-template-columns:1fr}.groupMap{height:500px;min-height:440px}}';
    document.head.appendChild(style);
  }

  addTrajectoryPageUI();

  const loadFullData = () => {
    if (fullSystems) return Promise.resolve(fullSystems);
    if (!fullDataPromise) {
      fullDataPromise = fetch('data/cyclone_tracks.json')
        .then(response => {
          if (!response.ok) throw new Error(`No se pudo cargar la base completa (${response.status})`);
          return response.json();
        })
        .then(payload => {
          fullSystems = payload.systems;
          return fullSystems;
        });
    }
    return fullDataPromise;
  };

  const loadLandData = () => {
    if (landPolygons) return Promise.resolve(landPolygons);
    if (!landDataPromise) {
      landDataPromise = fetch('data/ne_110m_land.geojson')
        .then(response => {
          if (!response.ok) throw new Error(`No se pudo cargar la máscara terrestre (${response.status})`);
          return response.json();
        })
        .then(collection => {
          landPolygons = [];
          collection.features.forEach(feature => {
            const groups = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
            groups.forEach(rings => {
              const outer = rings[0];
              const longitudes = outer.map(point => point[0]);
              const latitudes = outer.map(point => point[1]);
              landPolygons.push({
                rings,
                bounds: [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)]
              });
            });
          });
          return landPolygons;
        });
    }
    return landDataPromise;
  };

  function setAppPage(page) {
    document.body.dataset.appPage = page;
    document.querySelectorAll('[data-app-target]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.appTarget === page));
    });
    document.querySelectorAll('.appPage').forEach(section => section.classList.remove('is-active'));
    if (page === 'strongest') {
      document.getElementById('strongestPage').classList.add('is-active');
      openStrongestPage();
    } else if (page === 'groups') {
      document.getElementById('groupPage').classList.add('is-active');
      openGroupPage();
    } else if (page === 'threat') {
      document.getElementById('threatPage').classList.add('is-active');
      openThreatPage();
    } else {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function categoryLabel(category) {
    if (category < 0) return 'Depresi&oacute;n tropical';
    if (category === 0) return 'Tormenta tropical';
    return `Hurac&aacute;n categor&iacute;a ${category}`;
  }

  function categoryColor(wind) {
    if (wind >= 137) return '#c43cff';
    if (wind >= 113) return '#f45b69';
    if (wind >= 96) return '#f78154';
    if (wind >= 64) return '#f2c14e';
    if (wind >= 34) return '#55d6be';
    return '#8eb7d8';
  }

  function parseObservationDate(value) {
    const text = String(value).padStart(12, '0');
    return new Date(Date.UTC(
      Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)),
      Number(text.slice(8, 10)), Number(text.slice(10, 12))
    ));
  }

  function sampleTrajectoryFeature(system, sampleCount = 7) {
    if (!system?.o?.length) return null;
    const points = system.o
      .map(row => [Number(row[1]), Number(row[2])])
      .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (points.length < 4) return null;
    const unwrapped = [points[0].slice()];
    for (let index = 1; index < points.length; index += 1) {
      let longitude = points[index][0];
      const previousLongitude = unwrapped[index - 1][0];
      while (longitude - previousLongitude > 180) longitude -= 360;
      while (longitude - previousLongitude < -180) longitude += 360;
      unwrapped.push([longitude, points[index][1]]);
    }
    const feature = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const position = sample * (unwrapped.length - 1) / (sampleCount - 1);
      const left = Math.floor(position);
      const right = Math.min(unwrapped.length - 1, Math.ceil(position));
      const mix = position - left;
      feature.push(
        unwrapped[left][0] + (unwrapped[right][0] - unwrapped[left][0]) * mix,
        unwrapped[left][1] + (unwrapped[right][1] - unwrapped[left][1]) * mix
      );
    }
    return feature;
  }

  function squaredDistance(left, right) {
    return left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0);
  }

  function buildTrajectoryClusterModel() {
    if (trajectoryClusterModel || !fullSystems) return trajectoryClusterModel;
    const entries = fullSystems
      .map(system => ({ system, raw: sampleTrajectoryFeature(system) }))
      .filter(entry => entry.raw);
    const dimensions = entries[0].raw.length;
    const means = Array.from({ length: dimensions }, (_, dimension) => entries.reduce((sum, entry) => sum + entry.raw[dimension], 0) / entries.length);
    const deviations = means.map((mean, dimension) => Math.sqrt(entries.reduce((sum, entry) => sum + (entry.raw[dimension] - mean) ** 2, 0) / entries.length) || 1);
    entries.forEach(entry => {
      entry.feature = entry.raw.map((value, dimension) => Math.max(-3, Math.min(3, (value - means[dimension]) / deviations[dimension])));
    });
    const centers = ['ATL', 'PAC'].flatMap(basin => {
      const basinEntries = entries.filter(entry => entry.system.b === basin).sort((left, right) => {
        const movementScore = entry => {
          const last = entry.raw.length - 2;
          return (entry.raw[last + 1] - entry.raw[1]) + .35 * (entry.raw[last] - entry.raw[0]);
        };
        return movementScore(left) - movementScore(right);
      });
      return [1 / 6, 3 / 6, 5 / 6].map(quantile => basinEntries[Math.min(basinEntries.length - 1, Math.floor(basinEntries.length * quantile))].feature.slice());
    });
    let assignments = [];
    for (let iteration = 0; iteration < 24; iteration += 1) {
      assignments = entries.map(entry => centers.reduce((best, center, cluster) => {
        const distance = squaredDistance(entry.feature, center);
        return distance < best.distance ? { cluster, distance } : best;
      }, { cluster: 0, distance: Infinity }).cluster);
      centers.forEach((center, cluster) => {
        const members = entries.filter((entry, index) => assignments[index] === cluster);
        if (!members.length) return;
        center.forEach((value, dimension) => {
          center[dimension] = members.reduce((sum, entry) => sum + entry.feature[dimension], 0) / members.length;
        });
      });
    }
    const assignmentById = new Map();
    const featureById = new Map();
    entries.forEach((entry, index) => {
      assignmentById.set(entry.system.i, assignments[index]);
      featureById.set(entry.system.i, entry.feature);
    });
    trajectoryClusterModel = { centers, assignmentById, featureById };
    return trajectoryClusterModel;
  }

  function corridorDescription(systems) {
    const basinCounts = systems.reduce((counts, system) => ({ ...counts, [system.b]: (counts[system.b] || 0) + 1 }), {});
    const basin = (basinCounts.ATL || 0) >= (basinCounts.PAC || 0) ? 'Atlántico' : 'Pacífico';
    const displacements = systems.map(system => {
      const feature = sampleTrajectoryFeature(system);
      const last = feature.length - 2;
      return [feature[last] - feature[0], feature[last + 1] - feature[1]];
    });
    const east = displacements.reduce((sum, displacement) => sum + displacement[0], 0) / displacements.length;
    const north = displacements.reduce((sum, displacement) => sum + displacement[1], 0) / displacements.length;
    let movement = null;
    if (north > 14 && east > 8) movement = 'recurvatura al noreste';
    else if (north > 16) movement = 'avance hacia el norte';
    else if (east < -16) movement = 'avance hacia el oeste';
    else if (east > 16) movement = 'avance hacia el este';
    else if (north < -10) movement = 'avance hacia el sur';
    if (!movement) {
      const directionNames = ['este', 'noreste', 'norte', 'noroeste', 'oeste', 'sudoeste', 'sur', 'sudeste'];
      const angle = (Math.atan2(north, east) * 180 / Math.PI + 360) % 360;
      movement = `avance hacia el ${directionNames[Math.round(angle / 45) % 8]}`;
    }
    return `${basin} · ${movement}`;
  }

  function filteredCorridorSystems() {
    const basin = document.getElementById('v3basin').value;
    const start = Number(document.getElementById('v3start').value);
    const month = Number(document.getElementById('month').value);
    return fullSystems.filter(system => {
      const genesisMonth = parseObservationDate(system.o[0][0]).getUTCMonth() + 1;
      return (basin === 'ALL' || system.b === basin) && system.y >= start && (!month || genesisMonth === month);
    });
  }

  function restoreMainMapLegend() {
    document.querySelectorAll('.mapLegend span').forEach(span => { span.hidden = false; });
  }

  function setCorridorMode(enabled) {
    document.getElementById('corridorPanel').hidden = !enabled;
    if (!enabled) {
      corridorRenderToken += 1;
      restoreMainMapLegend();
    }
  }

  function splitTrack(system) {
    const parts = [[]];
    let previousLongitude = null;
    system.o.forEach(row => {
      const longitude = Number(row[1]);
      const latitude = Number(row[2]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      if (previousLongitude != null && Math.abs(longitude - previousLongitude) > 180) parts.push([]);
      parts[parts.length - 1].push([latitude, longitude]);
      previousLongitude = longitude;
    });
    return parts.filter(part => part.length > 1);
  }

  async function renderTrajectoryCorridors({ fitFocus = false } = {}) {
    if (document.getElementById('layer').value !== 'clusters') return;
    const token = ++corridorRenderToken;
    setCorridorMode(true);
    try {
      await loadFullData();
      if (token !== corridorRenderToken || document.getElementById('layer').value !== 'clusters') return;
      const model = buildTrajectoryClusterModel();
      const eligible = filteredCorridorSystems().filter(system => model.assignmentById.has(system.i));
      const groups = Array.from({ length: 6 }, (_, cluster) => eligible.filter(system => model.assignmentById.get(system.i) === cluster));
      pointCanvas.setData([], 'genesis');
      trackLayer.clearLayers();
      const visibleGroups = corridorFocus === 'ALL' ? groups : groups.map((group, cluster) => cluster === Number(corridorFocus) ? group : []);
      const visible = visibleGroups.flat();
      const sampleStep = Math.max(1, Math.ceil(visible.length / 720));
      visible.forEach((system, index) => {
        if (index % sampleStep) return;
        const cluster = model.assignmentById.get(system.i);
        splitTrack(system).forEach(part => L.polyline(part, { color: corridorColors[cluster], weight: 1.25, opacity: .18, interactive: false }).addTo(trackLayer));
      });
      visibleGroups.forEach((group, cluster) => {
        if (!group.length) return;
        const representative = group.reduce((best, system) => {
          const distance = squaredDistance(model.featureById.get(system.i), model.centers[cluster]);
          return distance < best.distance ? { system, distance } : best;
        }, { system: group[0], distance: Infinity }).system;
        splitTrack(representative).forEach(part => L.polyline(part, { color: corridorColors[cluster], weight: 5, opacity: .96 })
          .bindPopup(`<b>Corredor ${cluster + 1} · ${corridorDescription(group)}</b><br>Recorrido representativo: ${representative.n} · ${representative.y}<br>${group.length} ciclones visibles`)
          .addTo(trackLayer));
      });
      const cards = groups.map((systems, cluster) => ({ systems, cluster })).filter(group => group.systems.length).sort((left, right) => left.cluster - right.cluster);
      document.getElementById('corridorCards').innerHTML = cards.map(({ systems, cluster }) => {
        const share = eligible.length ? Math.round(systems.length * 100 / eligible.length) : 0;
        const meanWind = Math.round(systems.reduce((sum, system) => sum + system.w, 0) / systems.length);
        return `<button type="button" class="corridorCard" data-corridor="${cluster}" aria-selected="${String(Number(corridorFocus) === cluster)}" style="--corridor-color:${corridorColors[cluster]}"><i class="corridorSwatch"></i><span><b>Corredor ${cluster + 1} · ${corridorDescription(systems)}</b><span>${numberFormat.format(systems.length)} ciclones · ${share}% · viento máximo medio ${meanWind} kt</span></span></button>`;
      }).join('') || '<div class="emptyState">No hay trayectorias completas para este recorte.</div>';
      document.querySelectorAll('[data-corridor]').forEach(button => button.addEventListener('click', () => {
        corridorFocus = Number(button.dataset.corridor);
        renderTrajectoryCorridors({ fitFocus: true });
      }));
      const legendItems = document.querySelectorAll('.mapLegend span');
      legendItems.forEach((span, index) => { span.hidden = index > 0; });
      legendItems[0].textContent = `${numberFormat.format(visible.length)} trayectorias visibles · ${corridorFocus === 'ALL' ? '6 grupos' : `Corredor ${Number(corridorFocus) + 1} · ${corridorDescription(visible)}`}`;
      if (fitFocus && visible.length) {
        const bounds = L.latLngBounds(visible.flatMap(system => splitTrack(system).flat()));
        if (bounds.isValid()) worldMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 4, animate: true });
      }
    } catch (error) {
      document.getElementById('corridorCards').innerHTML = `<div class="emptyState">${error.message}</div>`;
    }
  }

  function initializeGroupMap() {
    if (groupMap) return;
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Tiles &copy; Esri'
    });
    groupMap = L.map('groupMap', { center: [22, -75], zoom: 2, minZoom: 2, worldCopyJump: true, layers: [satellite], preferCanvas: true });
    groupTrackLayer = L.layerGroup().addTo(groupMap);
    groupAnimationLayer = L.layerGroup().addTo(groupMap);
  }

  function filteredGroupPageSystems() {
    const basin = document.getElementById('groupBasin').value;
    const start = Number(document.getElementById('groupStart').value);
    const month = Number(document.getElementById('groupMonth').value);
    return fullSystems.filter(system => {
      const genesisMonth = parseObservationDate(system.o[0][0]).getUTCMonth() + 1;
      return (basin === 'ALL' || system.b === basin) && system.y >= start && (!month || genesisMonth === month);
    });
  }

  async function openGroupPage() {
    initializeGroupMap();
    setTimeout(() => groupMap.invalidateSize(), 80);
    try {
      await loadFullData();
      buildTrajectoryClusterModel();
      document.getElementById('groupLoading').hidden = true;
      document.getElementById('groupContent').hidden = false;
      renderGroupPage();
      setTimeout(() => groupMap.invalidateSize(), 80);
    } catch (error) {
      document.getElementById('groupLoading').textContent = error.message;
    }
  }

  function renderGroupPage({ fit = false } = {}) {
    if (!fullSystems || !groupMap) return;
    clearInterval(groupAnimationTimer);
    selectedGroupSystem = null;
    groupAnimationIndex = 0;
    groupAnimationLayer.clearLayers();
    document.getElementById('groupPlayback').hidden = true;
    const model = buildTrajectoryClusterModel();
    const eligible = filteredGroupPageSystems().filter(system => model.assignmentById.has(system.i));
    const groups = Array.from({ length: 6 }, (_, cluster) => eligible.filter(system => model.assignmentById.get(system.i) === cluster));
    const visibleGroups = groupFocus === 'ALL' ? groups : groups.map((group, cluster) => cluster === Number(groupFocus) ? group : []);
    const visible = visibleGroups.flat();
    groupTrackLayer.clearLayers();
    const sampleStep = Math.max(1, Math.ceil(visible.length / 850));
    visible.forEach((system, index) => {
      if (index % sampleStep) return;
      const cluster = model.assignmentById.get(system.i);
      splitTrack(system).forEach(part => L.polyline(part, {
        color: corridorColors[cluster], weight: 1.35, opacity: groupFocus === 'ALL' ? .19 : .26,
        interactive: false
      }).addTo(groupTrackLayer));
    });
    visibleGroups.forEach((systems, cluster) => {
      if (!systems.length) return;
      const representative = systems.reduce((best, system) => {
        const distance = squaredDistance(model.featureById.get(system.i), model.centers[cluster]);
        return distance < best.distance ? { system, distance } : best;
      }, { system: systems[0], distance: Infinity }).system;
      splitTrack(representative).forEach(part => L.polyline(part, { color: corridorColors[cluster], weight: 6, opacity: 1 })
        .bindPopup(`<b>Corredor ${cluster + 1}</b><br>${corridorDescription(systems)}<br>Ruta representativa: ${representative.n} · ${representative.y}`)
        .addTo(groupTrackLayer));
    });
    const populated = groups.map((systems, cluster) => ({ systems, cluster })).filter(group => group.systems.length).sort((left, right) => left.cluster - right.cluster);
    document.getElementById('groupCards').innerHTML = populated.map(({ systems, cluster }) => {
      const share = eligible.length ? Math.round(systems.length * 100 / eligible.length) : 0;
      const meanWind = Math.round(systems.reduce((sum, system) => sum + system.w, 0) / systems.length);
      const selected = Number(groupFocus) === cluster;
      return `<button type="button" class="groupCard" data-group-cluster="${cluster}" aria-selected="${selected}" style="--group-color:${corridorColors[cluster]}"><i></i><span><b>Corredor ${cluster + 1}</b><span>${corridorDescription(systems)}</span><span>${numberFormat.format(systems.length)} ciclones · ${share}% · ${meanWind} kt de viento máximo medio</span></span></button>`;
    }).join('') || '<div class="emptyState">No hay trayectorias completas para este recorte.</div>';
    document.querySelectorAll('[data-group-cluster]').forEach(button => button.addEventListener('click', () => {
      groupFocus = Number(button.dataset.groupCluster);
      renderGroupPage({ fit: true });
    }));
    const picker = document.getElementById('groupCyclonePicker');
    if (groupFocus === 'ALL') {
      picker.hidden = true;
      document.getElementById('groupCycloneList').innerHTML = '';
    } else {
      picker.hidden = false;
      const activeSystems = groups[Number(groupFocus)].slice().sort((left, right) => right.w - left.w || right.y - left.y);
      document.getElementById('groupCycloneTitle').textContent = `Ciclones del Corredor ${Number(groupFocus) + 1}`;
      document.getElementById('groupCycloneList').innerHTML = activeSystems.map(system => `<button type="button" class="groupCyclone" data-group-system="${system.i}" aria-selected="false"><span><b>${system.n} · ${system.y}</b><span>${categoryLabel(system.c)} · ${system.o.length} observaciones</span></span><strong>${system.w} kt</strong></button>`).join('') || '<div class="emptyState">No hay ciclones para este recorte.</div>';
      document.querySelectorAll('[data-group-system]').forEach(button => button.addEventListener('click', () => {
        selectGroupSystem(activeSystems.find(system => system.i === button.dataset.groupSystem));
      }));
    }
    document.getElementById('groupColorLegend').innerHTML = populated.map(({ cluster }) => `<span><i style="background:${corridorColors[cluster]}"></i>Corredor ${cluster + 1}</span>`).join('');
    const largest = populated.reduce((best, group) => !best || group.systems.length > best.systems.length ? group : best, null);
    const meanVisibleWind = visible.length ? Math.round(visible.reduce((sum, system) => sum + system.w, 0) / visible.length) : 0;
    document.getElementById('groupVisible').textContent = numberFormat.format(visible.length);
    document.getElementById('groupLargest').textContent = largest ? `C${largest.cluster + 1} · ${Math.round(largest.systems.length * 100 / eligible.length)}%` : '—';
    document.getElementById('groupWind').textContent = visible.length ? `${meanVisibleWind} kt` : '—';
    document.getElementById('groupMapTitle').textContent = groupFocus === 'ALL' ? 'Los seis corredores históricos' : `Corredor ${Number(groupFocus) + 1} · ${corridorDescription(visible)}`;
    document.getElementById('groupMapSub').textContent = groupFocus === 'ALL'
      ? 'Cada color representa un patrón. Las líneas finas son ciclones reales y la gruesa es el caso más central del grupo.'
      : `${numberFormat.format(visible.length)} ciclones del recorte siguen este patrón. Tocá “Mostrar los seis” para volver a compararlos.`;
    if ((fit || groupFocus === 'ALL') && visible.length) {
      const bounds = L.latLngBounds(visible.flatMap(system => splitTrack(system).flat()));
      if (bounds.isValid()) groupMap.fitBounds(bounds, { padding: [34, 34], maxZoom: groupFocus === 'ALL' ? 3 : 5, animate: fit });
    }
  }

  function selectGroupSystem(system) {
    if (!system?.o?.length) return;
    clearInterval(groupAnimationTimer);
    selectedGroupSystem = system;
    groupAnimationIndex = 0;
    document.getElementById('groupPlayback').hidden = false;
    document.querySelectorAll('[data-group-system]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.groupSystem === system.i)));
    const path = system.o.map(row => [row[2], row[1]]);
    if (path.length > 1) groupMap.fitBounds(L.latLngBounds(path), { padding: [42, 42], maxZoom: 5, animate: true });
    updateGroupAnimationFrame();
    playGroupAnimation();
  }

  function updateGroupAnimationFrame() {
    if (!selectedGroupSystem) return;
    const observations = selectedGroupSystem.o;
    groupAnimationLayer.clearLayers();
    const fullPath = observations.map(row => [row[2], row[1]]);
    L.polyline(fullPath, { color: '#fff8f2', weight: 3, opacity: .3, dashArray: '7 7' }).addTo(groupAnimationLayer);
    for (let index = 1; index <= groupAnimationIndex; index += 1) {
      const previous = observations[index - 1];
      const current = observations[index];
      L.polyline([[previous[2], previous[1]], [current[2], current[1]]], {
        color: categoryColor((previous[3] + current[3]) / 2), weight: 6, opacity: .98, lineCap: 'round'
      }).addTo(groupAnimationLayer);
    }
    const row = observations[groupAnimationIndex];
    L.circleMarker([row[2], row[1]], {
      radius: Math.max(6, Math.min(14, 4 + row[3] / 18)), color: '#fff', weight: 2,
      fillColor: categoryColor(row[3]), fillOpacity: 1
    }).addTo(groupAnimationLayer);
    const date = parseObservationDate(row[0]);
    document.getElementById('groupPlaybackStatus').innerHTML = `<b style="color:${categoryColor(row[3])}">${selectedGroupSystem.n} · ${selectedGroupSystem.y}</b><br>${dateFormat.format(date)} · ${statusLabels[row[5]] || row[5]} · ${row[3]} kt${row[4] ? ` · ${row[4]} hPa` : ''}`;
  }

  function playGroupAnimation() {
    if (!selectedGroupSystem) return;
    clearInterval(groupAnimationTimer);
    if (groupAnimationIndex >= selectedGroupSystem.o.length - 1) groupAnimationIndex = 0;
    updateGroupAnimationFrame();
    groupAnimationTimer = setInterval(() => {
      groupAnimationIndex += 1;
      updateGroupAnimationFrame();
      if (groupAnimationIndex >= selectedGroupSystem.o.length - 1) clearInterval(groupAnimationTimer);
    }, 125);
  }

  function initializeStrongestMap() {
    if (strongestMap) return;
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Tiles &copy; Esri'
    });
    strongestMap = L.map('strongMap', { center: [20, -80], zoom: 3, minZoom: 2, worldCopyJump: true, layers: [satellite] });
    strongestTrack = L.polyline([], { color: '#8062d6', weight: 3, opacity: .42 }).addTo(strongestMap);
    strongestProgress = L.layerGroup().addTo(strongestMap);
  }

  async function openStrongestPage() {
    initializeStrongestMap();
    setTimeout(() => strongestMap.invalidateSize(), 80);
    try {
      await loadFullData();
      document.getElementById('strongLoading').hidden = true;
      document.getElementById('strongContent').hidden = false;
      renderStrongRanking();
      setTimeout(() => strongestMap.invalidateSize(), 80);
    } catch (error) {
      document.getElementById('strongLoading').textContent = error.message;
    }
  }

  function matchesStrongCategory(system, filter) {
    if (filter === 'ALL') return true;
    if (filter === 'TS') return system.c === 0;
    if (filter === 'HU') return system.c >= 1;
    return system.c === Number(filter);
  }

  function renderStrongRanking() {
    if (!fullSystems) return;
    const metric = document.getElementById('strongMetric').value;
    const basin = document.getElementById('strongBasin').value;
    const category = document.getElementById('strongCategory').value;
    const rows = fullSystems
      .filter(system => (basin === 'ALL' || system.b === basin) && matchesStrongCategory(system, category))
      .filter(system => metric !== 'p' || system.p != null)
      .sort((left, right) => metric === 'p' ? left.p - right.p : right[metric] - left[metric])
      .slice(0, 30);
    const [title, formatter] = metricLabels[metric];
    document.getElementById('rankingTitle').innerHTML = title;
    document.getElementById('strongRanking').innerHTML = rows.map((system, index) => `
      <button type="button" class="rankItem" data-strong-id="${system.i}" aria-selected="${selectedStrongSystem?.i === system.i}">
        <span class="rankNumber">${index + 1}</span>
        <span><b>${system.n}</b><span class="rankMeta">${system.y} &middot; ${system.b} &middot; ${categoryLabel(system.c)}</span></span>
        <span class="rankValue">${formatter(system[metric])}</span>
      </button>`).join('') || '<div class="emptyState">No hay ciclones para este recorte.</div>';
    document.querySelectorAll('[data-strong-id]').forEach(button => {
      button.addEventListener('click', () => selectStrongSystem(fullSystems.find(system => system.i === button.dataset.strongId)));
    });
    if (rows.length && !rows.some(system => system.i === selectedStrongSystem?.i)) selectStrongSystem(rows[0]);
  }

  function selectStrongSystem(system) {
    if (!system) return;
    selectedStrongSystem = system;
    clearInterval(animationTimer);
    document.querySelectorAll('[data-strong-id]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.strongId === system.i)));
    const observations = system.o;
    const latLngs = observations.map(row => [row[2], row[1]]);
    strongestTrack.setLatLngs(latLngs);
    strongestProgress.clearLayers();
    if (strongestMarker) strongestMarker.remove();
    strongestMarker = L.circleMarker(latLngs[0], {
      radius: Math.max(6, Math.min(15, 4 + observations[0][3] / 16)),
      color: '#fff', weight: 2, fillColor: categoryColor(observations[0][3]), fillOpacity: 1
    }).addTo(strongestMap);
    if (latLngs.length > 1) strongestMap.fitBounds(L.latLngBounds(latLngs), { padding: [35, 35], maxZoom: 5 });
    document.getElementById('animatedStormTitle').innerHTML = `${system.n} &middot; ${system.y}`;
    document.getElementById('strongSummary').innerHTML = `
      <div class="metric"><b>${system.w} kt</b><span>${categoryLabel(system.c)}</span></div>
      <div class="metric"><b>${system.p ?? '&mdash;'}${system.p ? ' hPa' : ''}</b><span>presi&oacute;n m&iacute;nima</span></div>
      <div class="metric"><b>${numberFormat.format(system.a)}</b><span>ACE acumulado</span></div>
      <div class="metric"><b>${numberFormat.format(system.d)} km</b><span>distancia recorrida</span></div>
      <div class="metric"><b>${numberFormat.format(system.h / 24)} d&iacute;as</b><span>duraci&oacute;n registrada</span></div>`;
    animationIndex = 0;
    renderWindTimeline(system, 0);
    updateAnimationFrame();
    playAnimation();
  }

  function playAnimation() {
    if (!selectedStrongSystem) return;
    clearInterval(animationTimer);
    if (animationIndex >= selectedStrongSystem.o.length - 1) animationIndex = 0;
    const delay = Number(document.getElementById('animationSpeed').value);
    animationTimer = setInterval(() => {
      animationIndex += 1;
      updateAnimationFrame();
      if (animationIndex >= selectedStrongSystem.o.length - 1) clearInterval(animationTimer);
    }, delay);
  }

  function updateAnimationFrame() {
    if (!selectedStrongSystem || !strongestMarker) return;
    const observations = selectedStrongSystem.o;
    const row = observations[animationIndex];
    const latLng = [row[2], row[1]];
    strongestMarker.setLatLng(latLng).setRadius(Math.max(6, Math.min(15, 4 + row[3] / 16))).setStyle({ fillColor: categoryColor(row[3]) });
    strongestProgress.clearLayers();
    for (let index = 1; index <= animationIndex; index += 1) {
      const previous = observations[index - 1];
      const current = observations[index];
      const wind = (previous[3] + current[3]) / 2;
      L.polyline([[previous[2], previous[1]], [current[2], current[1]]], {
        color: categoryColor(wind), weight: 6, opacity: .96, lineCap: 'round'
      }).addTo(strongestProgress);
    }
    const date = parseObservationDate(row[0]);
    let movement = '';
    let windChange = '';
    if (animationIndex > 0) {
      const previous = observations[animationIndex - 1];
      const elapsedHours = Math.max(1, (date - parseObservationDate(previous[0])) / 36e5);
      const speed = distanceKm([previous[1], previous[2]], [row[1], row[2]]) / elapsedHours;
      const deltaWind = row[3] - previous[3];
      movement = ` &middot; movimiento ${numberFormat.format(speed)} km/h`;
      windChange = ` &middot; &Delta; viento ${deltaWind >= 0 ? '+' : ''}${deltaWind} kt`;
    }
    document.getElementById('animationStatus').innerHTML = `${dateFormat.format(date)} &middot; ${statusLabels[row[5]] || row[5]} &middot; <b style="color:${categoryColor(row[3])}">${row[3]} kt</b>${row[4] ? ` &middot; ${row[4]} hPa` : ''}${movement}${windChange}`;
    renderWindTimeline(selectedStrongSystem, animationIndex);
  }

  function renderWindTimeline(system, activeIndex) {
    const element = document.getElementById('windTimeline');
    const width = 900;
    const height = 220;
    const padding = { left: 48, right: 20, top: 20, bottom: 32 };
    const observations = system.o;
    const maximum = Math.max(80, ...observations.map(row => row[3]));
    const x = index => padding.left + index / Math.max(1, observations.length - 1) * (width - padding.left - padding.right);
    const y = value => height - padding.bottom - value / maximum * (height - padding.top - padding.bottom);
    const line = observations.map((row, index) => `${index ? 'L' : 'M'}${x(index)},${y(row[3])}`).join(' ');
    const active = observations[activeIndex];
    const thresholds = [34, 64, 96, 137].filter(value => value <= maximum).map(value => `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y(value)}" y2="${y(value)}" stroke="#3b284d" stroke-dasharray="4 5"/><text x="4" y="${y(value) + 4}" class="svgText">${value} kt</text>`).join('');
    element.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="Viento de ${system.n} durante ${observations.length} observaciones"><line x1="${padding.left}" x2="${width - padding.right}" y1="${height - padding.bottom}" y2="${height - padding.bottom}" class="axis"/>${thresholds}<path d="${line}" fill="none" stroke="#f2c14e" stroke-width="3"/><line x1="${x(activeIndex)}" x2="${x(activeIndex)}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#f45b69" stroke-width="2"/><circle cx="${x(activeIndex)}" cy="${y(active[3])}" r="6" fill="#f45b69" stroke="#fff" stroke-width="2"/><text x="${padding.left}" y="${height - 7}" class="svgText">Inicio</text><text x="${width - padding.right}" y="${height - 7}" text-anchor="end" class="svgText">Fin</text></svg>`;
  }

  function initializeThreatMap() {
    if (threatMap) return;
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Tiles &copy; Esri' });
    threatMap = L.map('threatMap', { center: [25.7617, -80.1918], zoom: 4, minZoom: 3, worldCopyJump: true, layers: [satellite] });
    threatLocationLayer = L.layerGroup().addTo(threatMap);
    threatTrackLayer = L.layerGroup().addTo(threatMap);
    threatMap.on('click', event => {
      if (!choosingThreatPoint) return;
      choosingThreatPoint = false;
      threatPoint = [event.latlng.lng, event.latlng.lat];
      document.getElementById('threatCity').value = 'custom';
      document.getElementById('threatStatus').textContent = 'Punto personalizado seleccionado.';
      analyzeThreatLocation();
    });
    const refreshVisibleRisk = () => {
      if (!fullSystems || !landPolygons || document.body.dataset.appPage !== 'threat') return;
      clearTimeout(riskMoveTimer);
      riskMoveTimer = setTimeout(() => {
        document.getElementById('threatStatus').textContent = 'Actualizando el degradé visible…';
        lastRiskRender = null;
        const surface = renderRiskSurface();
        document.getElementById('threatHighShare').textContent = `${surface.localRisk}/100`;
        document.getElementById('threatStatus').textContent = 'Riesgo actualizado para toda la tierra visible.';
      }, 120);
    };
    threatMap.on('moveend', refreshVisibleRisk);
    threatMap.on('resize', refreshVisibleRisk);
  }

  async function openThreatPage() {
    initializeThreatMap();
    setTimeout(() => threatMap.invalidateSize(), 80);
    try {
      await Promise.all([loadFullData(), loadLandData()]);
      document.getElementById('threatLoading').hidden = true;
      document.getElementById('threatContent').hidden = false;
      buildObservationBins();
      analyzeThreatLocation();
      setTimeout(() => {
        threatMap.invalidateSize({ animate: false });
        const radius = Number(document.getElementById('threatRadius').value);
        threatMap.setView([threatPoint[1], threatPoint[0]], radius >= 500 ? 3 : 4, { animate: false });
        lastRiskRender = null;
        const surface = renderRiskSurface();
        document.getElementById('threatHighShare').textContent = `${surface.localRisk}/100`;
      }, 160);
    } catch (error) {
      document.getElementById('threatLoading').textContent = error.message;
    }
  }

  function distanceKm(left, right) {
    const radians = Math.PI / 180;
    const deltaLat = (right[1] - left[1]) * radians;
    const deltaLon = (right[0] - left[0]) * radians;
    const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(left[1] * radians) * Math.cos(right[1] * radians) * Math.sin(deltaLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(value));
  }

  function closestApproach(point, observations) {
    let best = { distance: Infinity, wind: 0, index: 0 };
    const radius = 6371;
    const radians = Math.PI / 180;
    const cosine = Math.cos(point[1] * radians);
    for (let index = 1; index < observations.length; index += 1) {
      const previous = observations[index - 1];
      const current = observations[index];
      const ax = (previous[1] - point[0]) * radians * radius * cosine;
      const ay = (previous[2] - point[1]) * radians * radius;
      const bx = (current[1] - point[0]) * radians * radius * cosine;
      const by = (current[2] - point[1]) * radians * radius;
      const dx = bx - ax;
      const dy = by - ay;
      const denominator = dx * dx + dy * dy;
      const ratio = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
      const distance = Math.hypot(ax + ratio * dx, ay + ratio * dy);
      if (distance < best.distance) {
        best = {
          distance,
          wind: Math.round(previous[3] + ratio * (current[3] - previous[3])),
          index: ratio < .5 ? index - 1 : index
        };
      }
    }
    if (observations.length === 1) return { distance: distanceKm(point, [observations[0][1], observations[0][2]]), wind: observations[0][3], index: 0 };
    return best;
  }

  function intensifyingNear(system, index) {
    const current = system.o[index];
    const currentTime = parseObservationDate(current[0]).getTime();
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const hours = (currentTime - parseObservationDate(system.o[previous][0]).getTime()) / 36e5;
      if (hours > 30) break;
      if (hours >= 18 && current[3] - system.o[previous][3] >= 30) return true;
    }
    return false;
  }

  function buildObservationBins() {
    if (observationBins || !fullSystems) return;
    observationBins = new Map();
    fullSystems.forEach(system => system.o.forEach(row => {
      const key = `${Math.floor(row[1] * 2)},${Math.floor(row[2] * 2)}`;
      if (!observationBins.has(key)) {
        observationBins.set(key, {
          all: [0, 0, 0],
          months: Array.from({ length: 13 }, () => [0, 0, 0])
        });
      }
      const intensity = Math.pow(Math.max(.08, (row[3] - 20) / 120), 1.45);
      const month = parseObservationDate(row[0]).getUTCMonth() + 1;
      const entry = observationBins.get(key);
      [entry.all, entry.months[month]].forEach(bucket => {
        bucket[0] += row[1] * intensity;
        bucket[1] += row[2] * intensity;
        bucket[2] += intensity;
      });
    }));
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
      const [currentLon, currentLat] = ring[current];
      const [previousLon, previousLat] = ring[previous];
      const crosses = (currentLat > lat) !== (previousLat > lat)
        && lon < (previousLon - currentLon) * (lat - currentLat) / ((previousLat - currentLat) || Number.EPSILON) + currentLon;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function isLand(lon, lat) {
    return landPolygons.some(polygon => {
      const [minLon, minLat, maxLon, maxLat] = polygon.bounds;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat || !pointInRing(lon, lat, polygon.rings[0])) return false;
      return !polygon.rings.slice(1).some(hole => pointInRing(lon, lat, hole));
    });
  }

  function coastalWeight(lon, lat) {
    const cacheKey = `${Math.round(lon * 4)},${Math.round(lat * 4)}`;
    if (coastalWeightCache.has(cacheKey)) return coastalWeightCache.get(cacheKey);
    const cosine = Math.max(.25, Math.cos(lat * Math.PI / 180));
    const samples = [[30, 1], [70, .82], [130, .58], [220, .32]];
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [.707, .707], [.707, -.707], [-.707, .707], [-.707, -.707]];
    let proximity = 0;
    samples.forEach(([distance, weight]) => {
      const latStep = distance / 111;
      const lonStep = distance / (111 * cosine);
      const waterShare = directions.filter(([x, y]) => {
        const sampleLon = lon + x * lonStep;
        const sampleLat = lat + y * latStep;
        const landKey = `${Math.round(sampleLon * 5)},${Math.round(sampleLat * 5)}`;
        if (!coastLandCache.has(landKey)) coastLandCache.set(landKey, isLand(sampleLon, sampleLat));
        return !coastLandCache.get(landKey);
      }).length / directions.length;
      proximity = Math.max(proximity, weight * waterShare);
    });
    const result = .36 + 1.14 * Math.min(1, proximity * 1.65);
    coastalWeightCache.set(cacheKey, result);
    return result;
  }

  function riskAt(lon, lat) {
    const selectedMonth = Number(document.getElementById('threatMonth').value);
    const influenceDistance = 450;
    const binLon = Math.floor(lon * 2);
    const binLat = Math.floor(lat * 2);
    const longitudeRadius = Math.ceil(influenceDistance / Math.max(20, 55.5 * Math.cos(lat * Math.PI / 180)));
    const latitudeRadius = Math.ceil(influenceDistance / 55.5);
    let score = 0;
    for (let x = binLon - longitudeRadius; x <= binLon + longitudeRadius; x += 1) {
      for (let y = binLat - latitudeRadius; y <= binLat + latitudeRadius; y += 1) {
        const entry = observationBins.get(`${x},${y}`);
        if (!entry) continue;
        const aggregate = selectedMonth ? entry.months[selectedMonth] : entry.all;
        if (!aggregate[2]) continue;
        const observation = [aggregate[0] / aggregate[2], aggregate[1] / aggregate[2]];
        const distance = distanceKm([lon, lat], observation);
        if (distance > influenceDistance) continue;
        score += aggregate[2] * Math.exp(-(distance * distance) / (2 * 145 * 145));
      }
    }
    return Math.log1p(score) * coastalWeight(lon, lat);
  }

  function interpolateRiskColor(value) {
    const stops = [
      [0, [24, 48, 140]], [.38, [0, 180, 160]], [.7, [255, 145, 45]], [1, [255, 38, 96]]
    ];
    const upperIndex = stops.findIndex(stop => stop[0] >= value);
    if (upperIndex <= 0) return stops[0][1];
    const lower = stops[upperIndex - 1];
    const upper = stops[upperIndex];
    const ratio = (value - lower[0]) / (upper[0] - lower[0]);
    return lower[1].map((channel, index) => Math.round(channel + ratio * (upper[1][index] - channel)));
  }

  function renderRiskSurface() {
    const visible = threatMap.getBounds();
    const bounds = [
      [Math.max(-75, visible.getSouth()), Math.max(-179.5, visible.getWest())],
      [Math.min(75, visible.getNorth()), Math.min(179.5, visible.getEast())]
    ];
    const mapSize = threatMap.getSize();
    const selectedMonth = Number(document.getElementById('threatMonth').value);
    const signature = [...bounds[0], ...bounds[1], ...threatPoint, selectedMonth, mapSize.x, mapSize.y].map(value => Number(value).toFixed(3)).join('|');
    if (lastRiskRender?.signature === signature && threatHeatLayer) return lastRiskRender;
    const width = 144;
    const height = Math.max(92, Math.min(164, Math.round(width * mapSize.y / Math.max(1, mapSize.x))));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(width, height);
    const scores = new Float32Array(width * height);
    const positive = [];
    const mercatorY = latitude => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, latitude)) * Math.PI / 360));
    const inverseMercatorY = value => Math.atan(Math.sinh(value)) * 180 / Math.PI;
    const northMercator = mercatorY(bounds[1][0]);
    const southMercator = mercatorY(bounds[0][0]);
    for (let y = 0; y < height; y += 1) {
      const projectedY = northMercator + (y + .5) / height * (southMercator - northMercator);
      const lat = inverseMercatorY(projectedY);
      for (let x = 0; x < width; x += 1) {
        const lon = bounds[0][1] + (x + .5) / width * (bounds[1][1] - bounds[0][1]);
        if (!isLand(lon, lat)) continue;
        const score = riskAt(lon, lat);
        scores[y * width + x] = score;
        if (score > 0) positive.push(score);
      }
    }
    positive.sort((left, right) => left - right);
    const extreme = positive[Math.min(positive.length - 1, Math.floor(positive.length * .995))] || 1;
    const scale = extreme * 1.02;
    scores.forEach((score, index) => {
      if (!score) return;
      const value = Math.max(0, Math.min(1, score / scale));
      const color = interpolateRiskColor(value);
      const offset = index * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = Math.round(115 + value * 140);
    });
    context.putImageData(image, 0, 0);
    if (threatHeatLayer) threatHeatLayer.remove();
    threatHeatLayer = L.imageOverlay(canvas.toDataURL('image/png'), bounds, { opacity: .96, interactive: false }).addTo(threatMap);
    threatHeatLayer.bringToFront();
    threatTrackLayer?.eachLayer(layer => layer.bringToFront?.());
    threatLocationLayer?.eachLayer(layer => layer.bringToFront?.());
    const localScore = riskAt(threatPoint[0], threatPoint[1]);
    const localRisk = Math.min(100, Math.round(100 * Math.max(0, localScore / scale)));
    lastRiskRender = { signature, bounds, localRisk };
    return lastRiskRender;
  }

  function analyzeThreatLocation() {
    if (!fullSystems || !threatMap) return;
    const radius = Number(document.getElementById('threatRadius').value);
    const selectedMonth = Number(document.getElementById('threatMonth').value);
    const city = document.getElementById('threatCity');
    if (city.value !== 'custom') threatPoint = city.value.split(',').map(Number);
    const locationName = city.value === 'custom' ? `${Math.abs(threatPoint[1]).toFixed(2)}&deg; ${threatPoint[1] >= 0 ? 'N' : 'S'}, ${Math.abs(threatPoint[0]).toFixed(2)}&deg; ${threatPoint[0] >= 0 ? 'E' : 'O'}` : city.options[city.selectedIndex].text;
    clearInterval(threatAnimationTimer);
    selectedThreatSystem = null;
    threatTrackLayer.clearLayers();
    document.getElementById('threatTrackStatus').innerHTML = 'Toc&aacute; un cicl&oacute;n de la lista para ver su recorrido completo.';
    document.getElementById('threatStatus').textContent = 'Calculando el degradé terrestre…';
    const results = fullSystems.map(system => {
      const observations = selectedMonth ? system.o.filter(row => parseObservationDate(row[0]).getUTCMonth() + 1 === selectedMonth) : system.o;
      if (!observations.length) return null;
      const closest = closestApproach(threatPoint, observations);
      const originalIndex = system.o.indexOf(observations[closest.index]);
      const influence = Math.pow(Math.max(10, closest.wind), 1.35) * Math.exp(-closest.distance / Math.max(45, radius * .7));
      return { system, ...closest, influence, intensifying: intensifyingNear(system, originalIndex) };
    }).filter(result => result && result.distance <= radius).sort((left, right) => right.influence - left.influence);
    threatLocationLayer.clearLayers();
    threatMap.invalidateSize({ animate: false });
    threatMap.setView([threatPoint[1], threatPoint[0]], radius >= 500 ? 3 : 4, { animate: false });
    lastRiskRender = null;
    const surface = renderRiskSurface();
    L.circle([threatPoint[1], threatPoint[0]], { radius: 100000, color: '#fff8f2', weight: 2, dashArray: '7 7', opacity: .95, fillColor: '#f2c14e', fillOpacity: .08, interactive: false }).addTo(threatLocationLayer);
    L.circleMarker([threatPoint[1], threatPoint[0]], { radius: 8, color: '#fff', weight: 3, fillColor: '#f2c14e', fillOpacity: 1 }).addTo(threatLocationLayer).bindPopup(locationName);
    const closest = results.slice().sort((left, right) => left.distance - right.distance)[0];
    const strongest = results.slice().sort((left, right) => right.wind - left.wind)[0];
    document.getElementById('threatCount').textContent = numberFormat.format(results.length);
    document.getElementById('threatHighShare').textContent = `${surface.localRisk}/100`;
    document.getElementById('threatClosest').innerHTML = closest ? `${numberFormat.format(closest.distance)} km` : '&mdash;';
    document.getElementById('threatStrongest').innerHTML = strongest ? `${strongest.wind} kt` : '&mdash;';
    document.getElementById('threatLocation').innerHTML = locationName;
    const monthLabel = selectedMonth ? ` en ${threatMonthNames[selectedMonth]}` : '';
    document.getElementById('threatListTitle').textContent = `Ciclones dentro de ${radius} km${monthLabel}`;
    document.getElementById('threatResults').innerHTML = results.slice(0, 30).map(result => `
      <button type="button" class="threatItem" data-threat-system="${result.system.i}" aria-selected="false" style="border-color:${categoryColor(result.wind)}"><b>${result.system.n} &middot; ${result.system.y}</b><span>${numberFormat.format(result.distance)} km &middot; ${result.wind} kt durante el paso${result.system.l ? ' &middot; tuvo entrada a tierra' : ''}${result.intensifying ? ' &middot; se estaba intensificando' : ''}</span></button>`).join('') || '<div class="emptyState">No hay trayectorias dentro del radio seleccionado.</div>';
    document.querySelectorAll('[data-threat-system]').forEach(button => button.addEventListener('click', () => {
      const system = fullSystems.find(candidate => candidate.i === button.dataset.threatSystem);
      selectThreatSystem(system);
    }));
    document.getElementById('threatStatus').textContent = 'Superficie calculada solo sobre tierra.';
  }

  function selectThreatSystem(system) {
    if (!system?.o?.length) return;
    clearInterval(threatAnimationTimer);
    selectedThreatSystem = system;
    threatAnimationIndex = 0;
    threatTrackLayer.clearLayers();
    document.querySelectorAll('[data-threat-system]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.threatSystem === system.i)));
    const path = system.o.map(row => [row[2], row[1]]);
    L.polyline(path, { color: '#fff8f2', weight: 3, opacity: .32, dashArray: '7 7' }).addTo(threatTrackLayer);
    if (path.length > 1) threatMap.fitBounds(L.latLngBounds(path), { padding: [42, 42], maxZoom: 5, animate: true });
    updateThreatAnimationFrame();
    playThreatAnimation();
  }

  function playThreatAnimation() {
    if (!selectedThreatSystem) return;
    clearInterval(threatAnimationTimer);
    if (threatAnimationIndex >= selectedThreatSystem.o.length - 1) {
      threatAnimationIndex = 0;
      selectThreatSystem(selectedThreatSystem);
      return;
    }
    threatAnimationTimer = setInterval(() => {
      threatAnimationIndex += 1;
      updateThreatAnimationFrame();
      if (threatAnimationIndex >= selectedThreatSystem.o.length - 1) clearInterval(threatAnimationTimer);
    }, 115);
  }

  function updateThreatAnimationFrame() {
    if (!selectedThreatSystem) return;
    const observations = selectedThreatSystem.o;
    const base = threatTrackLayer.getLayers()[0];
    threatTrackLayer.clearLayers();
    if (base) base.addTo(threatTrackLayer);
    for (let index = 1; index <= threatAnimationIndex; index += 1) {
      const previous = observations[index - 1];
      const current = observations[index];
      L.polyline([[previous[2], previous[1]], [current[2], current[1]]], {
        color: categoryColor((previous[3] + current[3]) / 2), weight: 6, opacity: .98, lineCap: 'round'
      }).addTo(threatTrackLayer);
    }
    const row = observations[threatAnimationIndex];
    L.circleMarker([row[2], row[1]], {
      radius: Math.max(6, Math.min(14, 4 + row[3] / 18)), color: '#fff', weight: 2,
      fillColor: categoryColor(row[3]), fillOpacity: 1
    }).addTo(threatTrackLayer);
    threatLocationLayer.eachLayer(layer => layer.bringToFront?.());
    const date = parseObservationDate(row[0]);
    document.getElementById('threatTrackStatus').innerHTML = `<b style="color:${categoryColor(row[3])}">${selectedThreatSystem.n} &middot; ${selectedThreatSystem.y}</b><br>${dateFormat.format(date)} &middot; ${statusLabels[row[5]] || row[5]} &middot; ${row[3]} kt${row[4] ? ` &middot; ${row[4]} hPa` : ''}`;
  }

  document.body.dataset.appPage = 'home';
  const sourceNote = document.querySelector('.source');
  if (sourceNote) sourceNote.textContent = sourceNote.textContent.replace('Cartografía: OpenStreetMap y Esri World Imagery.', 'Cartografía: Esri World Imagery.');
  document.querySelector('.appSidebar').id = 'appSidebar';
  const sidebarToggle = document.createElement('button');
  sidebarToggle.type = 'button';
  sidebarToggle.className = 'sidebarToggle';
  sidebarToggle.id = 'sidebarToggle';
  sidebarToggle.setAttribute('aria-controls', 'appSidebar');
  sidebarToggle.setAttribute('aria-expanded', 'true');
  sidebarToggle.title = 'Mostrar u ocultar navegación';
  sidebarToggle.innerHTML = '☰ <span>Menú</span>';
  document.body.prepend(sidebarToggle);
  sidebarToggle.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    sidebarToggle.querySelector('span').textContent = collapsed ? 'Abrir menú' : 'Menú';
  });
  document.querySelectorAll('[data-app-target]').forEach(button => button.addEventListener('click', () => setAppPage(button.dataset.appTarget)));
  document.getElementById('layer').addEventListener('change', () => {
    const corridorMode = document.getElementById('layer').value === 'clusters';
    setCorridorMode(corridorMode);
    if (corridorMode) {
      corridorFocus = 'ALL';
      renderTrajectoryCorridors();
    }
  });
  ['v3basin', 'v3start', 'month'].forEach(id => document.getElementById(id).addEventListener('change', () => {
    if (document.getElementById('layer').value === 'clusters') renderTrajectoryCorridors();
  }));
  document.getElementById('showAllCorridors').addEventListener('click', () => {
    corridorFocus = 'ALL';
    renderTrajectoryCorridors({ fitFocus: true });
  });
  ['groupBasin', 'groupStart', 'groupMonth'].forEach(id => document.getElementById(id).addEventListener('change', () => {
    groupFocus = 'ALL';
    renderGroupPage({ fit: true });
  }));
  document.getElementById('showAllGroups').addEventListener('click', () => {
    groupFocus = 'ALL';
    renderGroupPage({ fit: true });
  });
  document.getElementById('playGroupStorm').addEventListener('click', playGroupAnimation);
  document.getElementById('pauseGroupStorm').addEventListener('click', () => clearInterval(groupAnimationTimer));
  document.getElementById('restartGroupStorm').addEventListener('click', () => {
    if (!selectedGroupSystem) return;
    groupAnimationIndex = 0;
    updateGroupAnimationFrame();
    playGroupAnimation();
  });
  ['strongMetric', 'strongBasin', 'strongCategory'].forEach(id => document.getElementById(id).addEventListener('change', renderStrongRanking));
  document.getElementById('playStorm').addEventListener('click', playAnimation);
  document.getElementById('pauseStorm').addEventListener('click', () => clearInterval(animationTimer));
  document.getElementById('restartStorm').addEventListener('click', () => { animationIndex = 0; updateAnimationFrame(); playAnimation(); });
  document.getElementById('animationSpeed').addEventListener('change', () => { if (selectedStrongSystem) playAnimation(); });
  document.getElementById('threatCity').addEventListener('change', () => { if (document.getElementById('threatCity').value !== 'custom') analyzeThreatLocation(); });
  document.getElementById('threatRadius').addEventListener('change', analyzeThreatLocation);
  document.getElementById('threatMonth').addEventListener('change', analyzeThreatLocation);
  document.getElementById('playThreatTrack').addEventListener('click', playThreatAnimation);
  document.getElementById('pauseThreatTrack').addEventListener('click', () => clearInterval(threatAnimationTimer));
  document.getElementById('restartThreatTrack').addEventListener('click', () => {
    if (!selectedThreatSystem) return;
    threatAnimationIndex = 0;
    selectThreatSystem(selectedThreatSystem);
  });
  document.getElementById('chooseThreatPoint').addEventListener('click', () => {
    choosingThreatPoint = true;
    document.getElementById('threatCity').value = 'custom';
    document.getElementById('threatStatus').textContent = 'Hacé clic en cualquier punto del mapa.';
  });
})();
