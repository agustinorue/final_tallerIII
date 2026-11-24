# HURDAT2 — Análisis espacial interactivo

Informe web estático sobre la estacionalidad, distribución espacial, trayectorias e intensificación rápida de ciclones tropicales registrados en HURDAT2.

## Qué incluye

- Alcance metodológico y advertencias de interpretación.
- Filtros por cuenca, año inicial y mes de génesis.
- Mapa mundial con OpenStreetMap y Esri World Imagery.
- Sidebar con cuatro vistas: mapa general, ciclones más fuertes, grupos de trayectorias y amenaza por ubicación.
- Puntos de génesis, picos de intensidad y génesis de sistemas con intensificación rápida (RI).
- Capa y página de corredores históricos que agrupa automáticamente las trayectorias en seis patrones, permite aislar cada grupo, destaca un recorrido real representativo y reproduce los ciclones pertenecientes al corredor seleccionado.
- Ranking filtrable por viento, presión, ACE, distancia, velocidad media y aumento de viento en 24 horas.
- Animación completa de cada ciclón con fecha, estado, viento, presión, velocidad de desplazamiento y recorrido coloreado por intensidad.
- Calendario mensual y tabla mensual.
- Selección de sistemas desde el mapa y las tablas; al elegir una anomalía, el mapa encuadra su trayectoria.
- Métricas descriptivas de trayectorias disponibles.
- Comparación entre sistemas con y sin intensificación rápida.
- Evolución por década dentro del recorte seleccionado.
- Capítulos narrativos en secuencia, con navegación fija y filtros compartidos.
- Alternancia Tabla/Gráfico para tablas mensuales, casos extremos, anomalías y décadas.
- Ranking descriptivo de formas de trayectoria, con resultados restringidos por los filtros activos.
- Superficie continua de riesgo histórico por ciudad o punto elegido, recortada a tierra con Natural Earth; pondera con mayor fuerza la exposición costera, incluye un círculo fijo de 100 km y permite filtrar las observaciones por mes del año. Los ciclones cercanos se pueden seleccionar para reproducir su recorrido completo, coloreado por intensidad, sin perder el punto analizado.
- Síntesis y limitaciones.

Para explorar el informe localmente, abrí una terminal en esta carpeta y ejecutá `python -m http.server 8000`; luego ingresá a `http://localhost:8000`. Abrir el archivo con `file://` puede hacer que OpenStreetMap bloquee sus teselas por falta de un referente web. El mapa requiere conexión a Internet.

## Datos y metodología

Fuente: NOAA/National Hurricane Center, HURDAT2.

- Atlántico: 1851–2025.
- Pacífico NE/NC: 1949–2025.
- Unidad de análisis: cada ciclón.
- Trayectorias completas disponibles en la nueva navegación: 3.250 sistemas y 87.584 observaciones.
- Intensificación rápida: aumento de al menos 30 kt en una ventana cercana a 24 horas.
- Distancias y desplazamientos: estimación haversine.
- Duración y velocidad aproximadas: se calculan con la fecha y hora de cada observación.
- Índice de anomalía: trayectorias resampleadas a 13 posiciones, alineadas por el primer avance y normalizadas por longitud. El puntaje compara la forma con una referencia global de las trayectorias disponibles; no mide rareza climatológica, intensidad ni riesgo.
- Corredores de trayectoria: cada recorrido se interpola en siete momentos equivalentes y se agrupa por proximidad geográfica mediante k-means; las categorías describen patrones de esta base y no son una clasificación oficial de ciclones.

Las frecuencias históricas deben interpretarse con cautela porque la calidad y resolución observacional varían. El perfil por ubicación describe amenaza histórica, no vulnerabilidad, riesgo total ni pronóstico. En ese perfil, el viento se interpola sobre el segmento de trayectoria más cercano al punto elegido.

Para regenerar `data/cyclone_tracks.json` desde los archivos HURDAT2 originales, ejecutá `node scripts/build_full_tracks.mjs`.

## Publicación en GitHub Pages

El sitio no requiere compilación ni dependencias locales:

1. Subí `index.html`, `app_pages.js`, `data/cyclone_tracks.json` y `README.md` a la rama que publica el sitio.
2. En GitHub, abrí **Settings → Pages**.
3. Seleccioná **Deploy from a branch**.
4. Elegí la rama principal y la carpeta `/ (root)`.
5. Guardá la configuración y esperá a que GitHub genere la URL.

Leaflet y las capas cartográficas se cargan mediante CDN. OpenStreetMap utiliza su endpoint estándar; las teselas pueden no estar disponibles en redes que bloquean el servicio.
