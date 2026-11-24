# HURDAT2 — Análisis espacial interactivo

Informe web estático sobre la estacionalidad, distribución espacial, trayectorias e intensificación rápida de ciclones tropicales registrados en HURDAT2.

## Qué incluye

- Alcance metodológico y advertencias de interpretación.
- Filtros por cuenca, año inicial y mes de génesis.
- Mapa mundial con OpenStreetMap y Esri World Imagery.
- Puntos de génesis, picos de intensidad y génesis de sistemas con intensificación rápida (RI).
- Calendario mensual y tabla mensual.
- Selección de sistemas desde el mapa y las tablas; al elegir una anomalía, el mapa encuadra su trayectoria.
- Métricas descriptivas de trayectorias disponibles.
- Comparación entre sistemas con y sin intensificación rápida.
- Evolución por década dentro del recorte seleccionado.
- Capítulos narrativos en secuencia, con navegación fija y filtros compartidos.
- Alternancia Tabla/Gráfico para tablas mensuales, casos extremos, anomalías y décadas.
- Ranking descriptivo de formas de trayectoria, con resultados restringidos por los filtros activos.
- Perfil histórico de amenaza por un punto elegido en el mapa costero: trayectorias cercanas, distancia mínima e intensidad máxima del ciclo.
- Síntesis y limitaciones.

Para explorar el informe localmente, abrí una terminal en esta carpeta y ejecutá `python -m http.server 8000`; luego ingresá a `http://localhost:8000`. Abrir el archivo con `file://` puede hacer que OpenStreetMap bloquee sus teselas por falta de un referente web. El mapa requiere conexión a Internet.

## Datos y metodología

Fuente: NOAA/National Hurricane Center, HURDAT2.

- Atlántico: 1851–2025.
- Pacífico NE/NC: 1949–2025.
- Unidad de análisis: cada ciclón.
- Trayectorias disponibles: 1.109 de 3.250 sistemas; la cobertura es incompleta y no uniforme.
- Intensificación rápida: aumento de al menos 30 kt en una ventana cercana a 24 horas.
- Distancias y desplazamientos: estimación haversine.
- Duración y velocidad aproximadas: se infieren con (número de posiciones − 1) intervalos de seis horas; el archivo compacto no conserva las horas de cada punto.
- Índice de anomalía: trayectorias resampleadas a 13 posiciones, alineadas por el primer avance y normalizadas por longitud. El puntaje compara la forma con una referencia global de las trayectorias disponibles; no mide rareza climatológica, intensidad ni riesgo.

Las frecuencias históricas deben interpretarse con cautela porque la calidad y resolución observacional varían. El perfil por ubicación describe amenaza histórica, no vulnerabilidad, riesgo total ni pronóstico. El viento mostrado es el máximo del ciclo completo, no necesariamente el viento en el punto de paso.

## Publicación en GitHub Pages

El sitio no requiere compilación ni dependencias locales:

1. Subí `index.html` y `README.md` a la rama que publica el sitio.
2. En GitHub, abrí **Settings → Pages**.
3. Seleccioná **Deploy from a branch**.
4. Elegí la rama principal y la carpeta `/ (root)`.
5. Guardá la configuración y esperá a que GitHub genere la URL.

Leaflet y las capas cartográficas se cargan mediante CDN. OpenStreetMap utiliza su endpoint estándar; las teselas pueden no estar disponibles en redes que bloquean el servicio.
