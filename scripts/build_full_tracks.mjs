import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = [
  { code: 'ATL', file: path.join(root, 'data', 'hurdat2_atlantic_1851_2025.txt') },
  { code: 'PAC', file: path.join(root, 'data', 'hurdat2_pacific_1949_2025.txt') }
];

const parseCoordinate = value => {
  const text = String(value).trim();
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return null;
  return /[SW]$/i.test(text) ? -number : number;
};

const category = wind => wind >= 137 ? 5 : wind >= 113 ? 4 : wind >= 96 ? 3 : wind >= 83 ? 2 : wind >= 64 ? 1 : wind >= 34 ? 0 : -1;

const timestamp = (date, time) => Date.UTC(
  Number(date.slice(0, 4)),
  Number(date.slice(4, 6)) - 1,
  Number(date.slice(6, 8)),
  Number(time.slice(0, 2)),
  Number(time.slice(2, 4))
);

const haversine = (a, b) => {
  const radius = 6371;
  const radians = Math.PI / 180;
  const deltaLat = (b[1] - a[1]) * radians;
  const deltaLon = (b[0] - a[0]) * radians;
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
};

function parseSource(source) {
  const lines = fs.readFileSync(source.file, 'utf8').split(/\r?\n/).filter(Boolean);
  const systems = [];
  let current = null;

  for (const line of lines) {
    const columns = line.split(',').map(value => value.trim());
    if (/^[A-Z]{2}\d{6}$/.test(columns[0])) {
      current = { id: columns[0], name: columns[1] || 'SIN NOMBRE', basin: source.code, observations: [] };
      systems.push(current);
      continue;
    }
    if (!current || !/^\d{8}$/.test(columns[0])) continue;
    const lon = parseCoordinate(columns[5]);
    const lat = parseCoordinate(columns[4]);
    const wind = Number(columns[6]);
    const pressure = Number(columns[7]);
    if (![lon, lat, wind].every(Number.isFinite)) continue;
    current.observations.push({
      date: columns[0],
      time: columns[1],
      record: columns[2],
      status: columns[3],
      lon,
      lat,
      wind,
      pressure: pressure > 0 ? pressure : null,
      timestamp: timestamp(columns[0], columns[1])
    });
  }
  return systems;
}

const synopticHours = new Set(['0000', '0600', '1200', '1800']);
const systems = sources.flatMap(parseSource).map(system => {
  const observations = system.observations;
  const peak = observations.reduce((best, row) => row.wind > best.wind ? row : best, observations[0]);
  const pressures = observations.map(row => row.pressure).filter(Number.isFinite);
  let distance = 0;
  let ace = 0;
  let maximum24HourChange = 0;

  for (let index = 1; index < observations.length; index += 1) {
    const step = haversine([observations[index - 1].lon, observations[index - 1].lat], [observations[index].lon, observations[index].lat]);
    if (step < 1200) distance += step;
  }
  for (const row of observations) {
    if (synopticHours.has(row.time) && ['TS', 'HU'].includes(row.status) && row.wind >= 34) ace += row.wind ** 2 / 10000;
  }
  for (let index = 0; index < observations.length; index += 1) {
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const hours = (observations[index].timestamp - observations[previous].timestamp) / 36e5;
      if (hours > 30) break;
      if (hours >= 18) maximum24HourChange = Math.max(maximum24HourChange, observations[index].wind - observations[previous].wind);
    }
  }

  const first = observations[0]?.timestamp ?? 0;
  const last = observations.at(-1)?.timestamp ?? first;
  const durationHours = Math.max(0, (last - first) / 36e5);
  return {
    i: system.id,
    n: system.name,
    b: system.basin,
    y: Number(system.id.slice(4)),
    w: peak?.wind ?? 0,
    c: category(peak?.wind ?? 0),
    p: pressures.length ? Math.min(...pressures) : null,
    a: Number(ace.toFixed(2)),
    d: Math.round(distance),
    h: Math.round(durationHours),
    v: durationHours ? Number((distance / durationHours).toFixed(1)) : 0,
    k: maximum24HourChange,
    r: maximum24HourChange >= 30 ? 1 : 0,
    l: observations.some(row => row.record === 'L') ? 1 : 0,
    o: observations.map(row => [
      Number(`${row.date}${row.time}`),
      Number(row.lon.toFixed(1)),
      Number(row.lat.toFixed(1)),
      row.wind,
      row.pressure,
      row.status,
      row.record || ''
    ])
  };
});

const output = path.join(root, 'data', 'cyclone_tracks.json');
fs.writeFileSync(output, JSON.stringify({ generated: '2026-11-24', systems }));
console.log(JSON.stringify({ output, systems: systems.length, observations: systems.reduce((sum, system) => sum + system.o.length, 0), bytes: fs.statSync(output).size }, null, 2));
