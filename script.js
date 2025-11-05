let map;
let flyZonesGeoJSON = null;
let rblaMode = false;
let mblaMode = false;
let pblaMode = false;
let currentMode = null;
let centerPoint = null;
let tempLine = null;
let tempLabel = null;
let tempCircle = null;
let radiusMeters = null;
let coordinatesDisplay = null;
let operatorMarker = null;
let elevationCache = {};
let lastElevationRequest = 0;
const ELEVATION_REQUEST_DELAY = 1000;
let pendingElevationRequest = null;
let isTrackingCenter = true;

// Глобальные переменные для зон
let zoneLayers = {};
const ZONE_PREFIXES = ["RB", "MIL", "UMU", "UMP", "UMD", "UMR", "ARD", "ARZ"];

// Переменные для режимов
let mblaPoints = [];
let mblaPolyline = null;
let mblaMarkers = [];
let pblaPoints = [];
let pblaPolygon = null;
let pblaMarkers = [];
let currentDraggingMarker = null;
let dragStartTimeout = null;

function getZoneStyle(feature) {
  const name = feature.properties?.Name || feature.properties?.name || '';
  const baseStyle = { weight: 2, opacity: 0.9, fillOpacity: 0.3 };
  if (name.startsWith('UMU_')) return { ...baseStyle, color: '#800080', fillColor: '#800080' };
  else if (name.startsWith('UMD_')) return { ...baseStyle, color: '#654321', fillColor: '#b57e54' };
  else if (name.startsWith('UMP_')) return { ...baseStyle, color: '#cc8400', fillColor: '#ffa500' };
  else if (name.startsWith('UMR_')) return { ...baseStyle, color: '#cc0000', fillColor: '#ff0000' };
  else if (name.startsWith('MIL_')) return { ...baseStyle, color: '#43cd07', fillColor: '#d5e9cc' };
  else if (name.startsWith('RB_')) return { ...baseStyle, color: '#3d5f2e', fillColor: '#dde2db' };
  else if (name.startsWith('ARD_') || name.startsWith('ARZ_')) return { ...baseStyle, color: '#666666', fillColor: '#c8c8c8' };
  else return { ...baseStyle, color: '#cc0000', fillColor: '#ff0000' };
}

async function getElevation(lat, lng) {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (elevationCache[cacheKey] !== undefined) return elevationCache[cacheKey];
  const now = Date.now();
  if (now - lastElevationRequest < ELEVATION_REQUEST_DELAY) {
    if (pendingElevationRequest) return pendingElevationRequest;
    return getApproximateElevation(lat, lng);
  }
  lastElevationRequest = now;
  pendingElevationRequest = new Promise(async (resolve) => {
    try {
      const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.results?.[0]) {
        const elevation = data.results[0].elevation;
        elevationCache[cacheKey] = elevation;
        resolve(elevation);
      } else throw new Error('No elevation data');
    } catch (error) {
      console.warn('Ошибка получения высоты:', error);
      const approx = getApproximateElevation(lat, lng);
      elevationCache[cacheKey] = approx;
      resolve(approx);
    } finally {
      pendingElevationRequest = null;
    }
  });
  return pendingElevationRequest;
}

function getApproximateElevation(lat, lng) {
  const baseHeight = 160;
  const variation = Math.sin(lat * 10) * 50 + Math.cos(lng * 10) * 30;
  return Math.max(100, baseHeight + variation);
}

function initCoordinatesDisplay() {
  coordinatesDisplay = document.createElement('div');
  coordinatesDisplay.className = 'coordinates-display';
  coordinatesDisplay.innerHTML = '<div class="coordinates-content"><strong>Координаты:</strong> 53.900000, 27.566700 / <strong>Высота:</strong> 160 м.</div>';
  document.body.appendChild(coordinatesDisplay);
}

function updateCoordinatesDisplay(coords, elevation = 0) {
  if (!coordinatesDisplay) return;
  const lat = coords[0].toFixed(6);
  const lng = coords[1].toFixed(6);
  coordinatesDisplay.innerHTML = `<div class="coordinates-content"><strong>Координаты:</strong> ${lat}, ${lng} / <strong>Высота:</strong> ${Math.round(elevation)} м.</div>`;
}

function updateCenterCoordinates() {
  if (!coordinatesDisplay || !map) return;
  const center = map.getCenter();
  getElevation(center.lat, center.lng).then(elevation => {
    updateCoordinatesDisplay([center.lat, center.lng], elevation);
  });
}

let cursorUpdateTimeout = null;
function updateCursorCoordinates(e) {
  if (cursorUpdateTimeout) clearTimeout(cursorUpdateTimeout);
  cursorUpdateTimeout = setTimeout(() => {
    isTrackingCenter = false;
    getElevation(e.latlng.lat, e.latlng.lng).then(elevation => {
      updateCoordinatesDisplay([e.latlng.lat, e.latlng.lng], elevation);
    });
  }, 100);
}

function resetToCenterTracking() {
  isTrackingCenter = true;
  updateCenterCoordinates();
}

function initMap() {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
    tap: isMobile,
    tapTolerance: isMobile ? 15 : 10
  }).setView([53.9, 27.5667], 10);

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { detectRetina: isMobile });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { detectRetina: isMobile });
  const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { detectRetina: isMobile });
  const hybrid = L.layerGroup([satellite, labels]);

  L.control.layers({
    'OSM': osm,
    'Спутник': satellite,
    'Гибрид': hybrid
  }, {}, { position: 'topright' }).addTo(map);

  osm.addTo(map);
  initCoordinatesDisplay();

  map.on('moveend', () => { if (isTrackingCenter) updateCenterCoordinates(); });
  map.on('zoomend', () => { if (isTrackingCenter) updateCenterCoordinates(); });
  map.on('mousemove', updateCursorCoordinates);
  map.on('mouseout', resetToCenterTracking);
  if (isMobile) {
    map.on('touchmove', updateCursorCoordinates);
    map.on('touchend', resetToCenterTracking);
  }

  updateCenterCoordinates();
  loadZones();
  initButtons();
  createZoneToggleControl();
}

function loadZones() {
  fetch('Fly_Zones_BY.geojson')
    .then(res => {
      if (!res.ok) throw new Error(`GeoJSON не найден: ${res.status}`);
      return res.json();
    })
    .then(geojson => {
      flyZonesGeoJSON = geojson;

      ZONE_PREFIXES.forEach(prefix => {
        zoneLayers[prefix] = L.featureGroup();
      });

      geojson.features.forEach(feature => {
        const name = feature.properties?.Name || feature.properties?.name || '';
        let assigned = false;
        for (const prefix of ZONE_PREFIXES) {
          if (name.startsWith(prefix)) {
            const layer = L.geoJSON(feature, {
              onEachFeature: (feat, l) => {
                const n = feat.properties.Name || feat.properties.name || 'Зона';
                const desc = feat.properties.description || '';
                l.bindPopup(`<b>${n}</b><br>${desc}`);
              },
              style: getZoneStyle
            });
            zoneLayers[prefix].addLayer(layer);
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          console.warn('Не распознана зона:', name);
        }
      });

      ZONE_PREFIXES.forEach(prefix => {
        map.addLayer(zoneLayers[prefix]);
      });

      console.log('✅ GeoJSON загружен. Зоны распределены.');
    })
    .catch(err => {
      console.error('❌ Ошибка загрузки GeoJSON:', err);
      alert('⚠️ Не удалось загрузить зоны.');
    });
}

function checkIntersections() {
  if (!tempCircle || !flyZonesGeoJSON) return [];
  const circleCenter = tempCircle.getLatLng();
  const circleRadius = tempCircle.getRadius();
  const intersectingNames = [];
  flyZonesGeoJSON.features.forEach(feature => {
    const tempLayer = L.geoJSON(feature);
    try {
      const bounds = tempLayer.getBounds();
      const zoneCenter = bounds.getCenter();
      const zoneDiagonal = map.distance(bounds.getNorthWest(), bounds.getSouthEast());
      const zoneRadius = zoneDiagonal / 2;
      const distance = map.distance(circleCenter, zoneCenter);
      if (distance <= (circleRadius + zoneRadius)) {
        const name = feature.properties.Name || feature.properties.name || 'Зона';
        if (!intersectingNames.includes(name)) {
          intersectingNames.push(name);
        }
      }
    } catch (e) {
      console.warn('Ошибка при проверке зоны:', e);
    }
    tempLayer.remove();
  });
  return intersectingNames;
}

// Проверка пересечения линии с зонами с учетом ширины линии
function checkLineIntersections(linePoints, lineWidthMeters = 20) {
  if (!flyZonesGeoJSON) return [];
  
  const intersectingNames = [];
  const bufferRadius = lineWidthMeters / 2;
  
  // Создаем буфер вокруг линии
  const bufferPoints = [];
  for (let i = 0; i < linePoints.length - 1; i++) {
    const pointA = linePoints[i];
    const pointB = linePoints[i + 1];
    
    // Вычисляем направление линии
    const angle = Math.atan2(pointB.lng - pointA.lng, pointB.lat - pointA.lat);
    
    // Создаем точки буфера
    const perpendicularAngle = angle + Math.PI/2;
    const bufferPoint1 = {
      lat: pointA.lat + (Math.sin(perpendicularAngle) * bufferRadius / 111000),
      lng: pointA.lng + (Math.cos(perpendicularAngle) * bufferRadius / (111000 * Math.cos(pointA.lat * Math.PI/180)))
    };
    const bufferPoint2 = {
      lat: pointA.lat - (Math.sin(perpendicularAngle) * bufferRadius / 111000),
      lng: pointA.lng - (Math.cos(perpendicularAngle) * bufferRadius / (111000 * Math.cos(pointA.lat * Math.PI/180)))
    };
    
    bufferPoints.push(bufferPoint1, bufferPoint2);
  }
  
  // Проверяем пересечение с зонами
  flyZonesGeoJSON.features.forEach(feature => {
    const name = feature.properties.Name || feature.properties.name || 'Зона';
    const zoneLayer = L.geoJSON(feature);
    
    // Проверяем каждую точку буфера
    for (const point of bufferPoints) {
      if (zoneLayer.getBounds().contains(L.latLng(point.lat, point.lng))) {
        if (!intersectingNames.includes(name)) {
          intersectingNames.push(name);
        }
        break;
      }
    }
    
    zoneLayer.remove();
  });
  
  return intersectingNames;
}

// Проверка точек внутри полигона
function checkPolygonIntersections(polygonPoints) {
  if (!flyZonesGeoJSON) return [];
  
  const intersectingNames = [];
  
  // Проверяем каждую зону
  flyZonesGeoJSON.features.forEach(feature => {
    const name = feature.properties.Name || feature.properties.name || 'Зона';
    const zoneLayer = L.geoJSON(feature);
    
    // Проверяем каждую точку полигона
    let allInside = true;
    let anyInside = false;
    
    for (const point of polygonPoints) {
      const latLng = L.latLng(point.lat, point.lng);
      if (zoneLayer.getBounds().contains(latLng)) {
        anyInside = true;
        if (!isPointInPolygon(latLng, zoneLayer.getLayers()[0].getLatLngs()[0])) {
          allInside = false;
        }
      } else {
        allInside = false;
      }
    }
    
    // Проверяем пересечение границ
    let edgesIntersect = false;
    if (polygonPoints.length > 2) {
      const zonePolygon = zoneLayer.getLayers()[0].getLatLngs()[0];
      for (let i = 0; i < polygonPoints.length; i++) {
        const p1 = polygonPoints[i];
        const p2 = polygonPoints[(i + 1) % polygonPoints.length];
        
        for (let j = 0; j < zonePolygon.length; j++) {
          const z1 = zonePolygon[j];
          const z2 = zonePolygon[(j + 1) % zonePolygon.length];
          
          if (doLinesIntersect(p1, p2, z1, z2)) {
            edgesIntersect = true;
            break;
          }
        }
        
        if (edgesIntersect) break;
      }
    }
    
    if (anyInside || allInside || edgesIntersect) {
      if (!intersectingNames.includes(name)) {
        intersectingNames.push(name);
      }
    }
    
    zoneLayer.remove();
  });
  
  return intersectingNames;
}

// Вспомогательная функция для проверки, находится ли точка внутри полигона
function isPointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    
    const intersect = ((yi > point.lat) !== (yj > point.lat))
        && (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Вспомогательная функция для проверки пересечения двух отрезков
function doLinesIntersect(p1, p2, p3, p4) {
  const orientation = (p, q, r) => {
    const val = (q.lng - p.lng) * (r.lat - q.lat) - (q.lat - p.lat) * (r.lng - q.lng);
    if (val === 0) return 0;
    return (val > 0) ? 1 : 2;
  };
  
  const onSegment = (p, q, r) => {
    return (q.lat <= Math.max(p.lat, r.lat) && q.lat >= Math.min(p.lat, r.lat) &&
            q.lng <= Math.max(p.lng, r.lng) && q.lng >= Math.min(p.lng, r.lng));
  };
  
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;
  
  return false;
}

function setOperatorMarker(latlng) {
  if (operatorMarker) map.removeLayer(operatorMarker);
  operatorMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'operator-marker',
      html: '<div class="operator-marker-inner">О</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  }).addTo(map);
  getElevation(latlng.lat, latlng.lng).then(elevation => {
    operatorMarker.bindPopup(`
      <b>Позиция оператора</b><br>
      Координаты: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}<br>
      Высота: ${Math.round(elevation)} м.
    `).openPopup();
  });
}

function initButtons() {
  // Кнопка GPS
  document.getElementById('btn-gps')?.addEventListener('click', () => {
    map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, timeout: 10000 });
    map.once('locationfound', e => {
      document.getElementById('btn-operator').style.display = 'block';
      L.marker(e.latlng).addTo(map).bindPopup("Ваше местоположение").openPopup();
      setTimeout(() => { isTrackingCenter = true; updateCenterCoordinates(); }, 1000);
    });
    map.once('locationerror', () => alert('Не удалось определить местоположение.'));
  });

  // Кнопка оператора
  document.getElementById('btn-operator')?.addEventListener('click', () => {
    const center = map.getCenter();
    setOperatorMarker(center);
    getElevation(center.lat, center.lng).then(elevation => {
      alert(`Маркер оператора установлен!\nКоординаты: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}\nВысота: ${Math.round(elevation)} м.`);
    });
  });

  // Кнопка Р-БЛА
  document.getElementById('btn-rbla')?.addEventListener('click', () => {
    resetAllModes();
    rblaMode = true;
    currentMode = 'rbla';
    document.getElementById('btn-rbla').disabled = true;
    centerPoint = map.getCenter();
    map.dragging.disable();
    map.on('mousemove', drawTempLine);
    map.once('click', finishRadius);
  });

  // Кнопка М-БЛА
  document.getElementById('btn-mbla')?.addEventListener('click', () => {
    resetAllModes();
    mblaMode = true;
    currentMode = 'mbla';
    document.getElementById('btn-mbla').disabled = true;
    mblaPoints = [];
    clearMbla();
    document.getElementById('btn-calculate').style.display = 'none';
    
    map.on('click', addMblaPoint);
    document.getElementById('btn-calculate').style.display = 'none';
  });

  // Кнопка П-БЛА
  document.getElementById('btn-pbla')?.addEventListener('click', () => {
    resetAllModes();
    pblaMode = true;
    currentMode = 'pbla';
    document.getElementById('btn-pbla').disabled = true;
    pblaPoints = [];
    clearPbla();
    document.getElementById('btn-calculate').style.display = 'none';
    
    map.on('click', addPblaPoint);
    document.getElementById('btn-calculate').style.display = 'none';
  });

  // Кнопка Рассчитать
  document.getElementById('btn-calculate')?.addEventListener('click', () => {
    if (rblaMode && tempCircle) {
      calculateRbla();
    } else if (mblaMode && mblaPoints.length > 1) {
      calculateMbla();
    } else if (pblaMode && pblaPoints.length > 2) {
      calculatePbla();
    } else {
      alert('Недостаточно точек для расчета');
    }
  });

  // Кнопка CNL (отмена действий)
  document.getElementById('btn-cnl')?.addEventListener('click', () => {
    if (rblaMode) {
      resetRBLA();
    } else if (mblaMode) {
      if (mblaPoints.length > 0) {
        removeLastMblaPoint();
      } else {
        resetMbla();
      }
    } else if (pblaMode) {
      if (pblaPoints.length > 0) {
        removeLastPblaPoint();
      } else {
        resetPbla();
      }
    }
  });

  // Кнопка RLD (очистка)
  document.getElementById('btn-rld')?.addEventListener('click', () => {
    resetAllModes();
    clearMbla();
    clearPbla();
    resetRBLA();
    if (operatorMarker) {
      map.removeLayer(operatorMarker);
      operatorMarker = null;
      document.getElementById('btn-operator').style.display = 'none';
    }
  });
}

function resetAllModes() {
  rblaMode = false;
  mblaMode = false;
  pblaMode = false;
  currentMode = null;
  
  document.getElementById('btn-rbla').disabled = false;
  document.getElementById('btn-mbla').disabled = false;
  document.getElementById('btn-pbla').disabled = false;
  
  // Сбросить все временные слои
  if (tempLine) {
    map.removeLayer(tempLine);
    tempLine = null;
  }
  if (tempLabel) {
    map.removeLayer(tempLabel);
    tempLabel = null;
  }
  
  // Включить перетаскивание карты
  map.dragging.enable();
  map.off('mousemove', drawTempLine);
  map.off('click', addMblaPoint);
  map.off('click', addPblaPoint);
}

function addMblaPoint(e) {
  const latlng = e.latlng;
  mblaPoints.push(latlng);
  
  // Добавляем маркер
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'mbla-marker',
      html: `<div class="marker-number">${mblaPoints.length}</div>`,
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    })
  }).addTo(map);
  
  // Добавляем обработчик долгого нажатия для перемещения
  marker.on('mousedown', function() {
    dragStartTimeout = setTimeout(() => {
      this._icon.classList.add('editing-point');
      currentDraggingMarker = this;
    }, 500);
  });
  
  marker.on('mouseup', function() {
    if (dragStartTimeout) {
      clearTimeout(dragStartTimeout);
      dragStartTimeout = null;
    }
    this._icon.classList.remove('editing-point');
    currentDraggingMarker = null;
  });
  
  mblaMarkers.push(marker);
  
  // Обновляем линию
  if (mblaPoints.length > 1) {
    if (mblaPolyline) {
      map.removeLayer(mblaPolyline);
    }
    mblaPolyline = L.polyline(mblaPoints, { color: '#0000FF', weight: 3 }).addTo(map);
  }
  
  // Показываем кнопку расчета, если есть достаточно точек
  if (mblaPoints.length >= 2) {
    document.getElementById('btn-calculate').style.display = 'block';
  }
  
  // Получаем высоту для точки
  getElevation(latlng.lat, latlng.lng).then(elevation => {
    marker.bindPopup(`Точка ${mblaPoints.length}<br>Высота: ${Math.round(elevation)} м.`);
  });
}

function removeLastMblaPoint() {
  if (mblaPoints.length > 0) {
    mblaPoints.pop();
    
    if (mblaMarkers.length > 0) {
      map.removeLayer(mblaMarkers.pop());
    }
    
    if (mblaPolyline) {
      map.removeLayer(mblaPolyline);
      mblaPolyline = null;
    }
    
    if (mblaPoints.length > 1) {
      mblaPolyline = L.polyline(mblaPoints, { color: '#0000FF', weight: 3 }).addTo(map);
    }
    
    // Скрыть кнопку расчета, если недостаточно точек
    if (mblaPoints.length < 2) {
      document.getElementById('btn-calculate').style.display = 'none';
    }
  }
}

function clearMbla() {
  mblaPoints.forEach(point => {
    // Удаляем маркеры
    if (mblaMarkers.length > 0) {
      mblaMarkers.forEach(marker => {
        map.removeLayer(marker);
      });
      mblaMarkers = [];
    }
    
    // Удаляем линию
    if (mblaPolyline) {
      map.removeLayer(mblaPolyline);
      mblaPolyline = null;
    }
    
    mblaPoints = [];
  });
  
  document.getElementById('btn-calculate').style.display = 'none';
}

function resetMbla() {
  mblaMode = false;
  document.getElementById('btn-mbla').disabled = false;
  clearMbla();
  map.off('click', addMblaPoint);
  map.dragging.enable();
}

function addPblaPoint(e) {
  const latlng = e.latlng;
  pblaPoints.push(latlng);
  
  // Добавляем маркер
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'pbla-marker',
      html: `<div class="marker-number">${pblaPoints.length}</div>`,
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    })
  }).addTo(map);
  
  // Добавляем обработчик долгого нажатия для перемещения
  marker.on('mousedown', function() {
    dragStartTimeout = setTimeout(() => {
      this._icon.classList.add('editing-point');
      currentDraggingMarker = this;
    }, 500);
  });
  
  marker.on('mouseup', function() {
    if (dragStartTimeout) {
      clearTimeout(dragStartTimeout);
      dragStartTimeout = null;
    }
    this._icon.classList.remove('editing-point');
    currentDraggingMarker = null;
  });
  
  pblaMarkers.push(marker);
  
  // Обновляем линию
  if (pblaPoints.length > 1) {
    if (pblaPolygon) {
      map.removeLayer(pblaPolygon);
    }
    
    // Для временного отображения рисуем линию, но не замыкаем
    const polylinePoints = [...pblaPoints];
    pblaPolygon = L.polyline(polylinePoints, { color: '#FF00FF', weight: 3 }).addTo(map);
  }
  
  // Показываем кнопку расчета, если есть достаточно точек
  if (pblaPoints.length >= 3) {
    document.getElementById('btn-calculate').style.display = 'block';
  }
}

function removeLastPblaPoint() {
  if (pblaPoints.length > 0) {
    pblaPoints.pop();
    
    if (pblaMarkers.length > 0) {
      map.removeLayer(pblaMarkers.pop());
    }
    
    if (pblaPolygon) {
      map.removeLayer(pblaPolygon);
      pblaPolygon = null;
    }
    
    if (pblaPoints.length > 1) {
      pblaPolygon = L.polyline(pblaPoints, { color: '#FF00FF', weight: 3 }).addTo(map);
    }
    
    // Скрыть кнопку расчета, если недостаточно точек
    if (pblaPoints.length < 3) {
      document.getElementById('btn-calculate').style.display = 'none';
    }
  }
}

function clearPbla() {
  pblaPoints.forEach(point => {
    // Удаляем маркеры
    if (pblaMarkers.length > 0) {
      pblaMarkers.forEach(marker => {
        map.removeLayer(marker);
      });
      pblaMarkers = [];
    }
    
    // Удаляем полигон
    if (pblaPolygon) {
      map.removeLayer(pblaPolygon);
      pblaPolygon = null;
    }
    
    pblaPoints = [];
  });
  
  document.getElementById('btn-calculate').style.display = 'none';
}

function resetPbla() {
  pblaMode = false;
  document.getElementById('btn-pbla').disabled = false;
  clearPbla();
  map.off('click', addPblaPoint);
  map.dragging.enable();
}

function drawTempLine(e) {
  if (!rblaMode || !centerPoint) return;
  const distance = map.distance(centerPoint, e.latlng);
  if (isNaN(distance)) return;
  if (tempLine) map.removeLayer(tempLine);
  if (tempLabel) map.removeLayer(tempLabel);
  tempLine = L.polyline([centerPoint, e.latlng], { color: '#ffff00', weight: 3, dashArray: '8,8' }).addTo(map);
  tempLabel = L.marker(e.latlng, {
    icon: L.divIcon({
      className: 'distance-label',
      html: `<div>${Math.round(distance)} м</div>`,
      iconSize: [0, 0]
    })
  }).addTo(map);
}

function finishRadius(e) {
  if (!rblaMode) return;
  const distance = map.distance(centerPoint, e.latlng);
  if (isNaN(distance)) {
    resetRBLA();
    return;
  }
  radiusMeters = Math.ceil(distance / 50) * 50;
  if (tempLine) map.removeLayer(tempLine);
  if (tempLabel) map.removeLayer(tempLabel);
  if (tempCircle) map.removeLayer(tempCircle);
  tempCircle = L.circle(centerPoint, { radius: radiusMeters, color: 'red', fillOpacity: 0.2, weight: 2 }).addTo(map);
  document.getElementById('btn-calculate').style.display = 'block';
  resetRBLA();
}

function resetRBLA() {
  rblaMode = false;
  const btn = document.getElementById('btn-rbla');
  if (btn) btn.disabled = false;
  map.dragging.enable();
  map.off('mousemove', drawTempLine);
}

function calculateRbla() {
  if (!tempCircle) return alert('Сначала создайте круг с помощью Р-БЛА');
  if (!flyZonesGeoJSON) return alert('Зоны не загружены');
  
  const intersectingNames = checkIntersections();
  
  getElevation(centerPoint.lat, centerPoint.lng).then(elevation => {
    let content = `<b>Р-БЛА: Радиусный план</b><br><b>Центр:</b> ${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)}<br><b>Высота:</b> ${Math.round(elevation)} м.<br><b>Радиус:</b> ${radiusMeters} м<br>`;
    
    if (intersectingNames.length > 0) {
      content += `<b>Пересекает зоны:</b><br>• ${intersectingNames.join('<br>• ')}`;
    } else {
      content += `<b>Пересечений нет</b>`;
    }
    
    if (!tempCircle.getPopup()) tempCircle.bindPopup(content);
    else tempCircle.setPopupContent(content);
    tempCircle.openPopup();
  });
  
  document.getElementById('btn-calculate').style.display = 'none';
}

function calculateMbla() {
  if (mblaPoints.length < 2) return;
  
  // Вычисляем пересечения с зонами
  const intersectingNames = checkLineIntersections(mblaPoints, 20);
  
  // Получаем высоты для всех точек
  const elevationPromises = mblaPoints.map(point => getElevation(point.lat, point.lng));
  
  Promise.all(elevationPromises).then(elevations => {
    let content = `<b>М-БЛА: Маршрутный план</b><br><b>Маршрутных точек:</b> ${mblaPoints.length}<br>`;
    
    // Формируем информацию о высотах для каждой точки
    content += '<b>Высоты рельефа:</b><br>';
    elevations.forEach((elevation, index) => {
      content += `• Точка ${index + 1}: ${Math.round(elevation)} м<br>`;
    });
    
    if (intersectingNames.length > 0) {
      content += `<b>Пересекает зоны:</b><br>• ${intersectingNames.join('<br>• ')}`;
    } else {
      content += `<b>Пересечений нет</b>`;
    }
    
    // Создаем popup для линии
    if (mblaPolyline) {
      if (!mblaPolyline.getPopup()) {
        mblaPolyline.bindPopup(content);
      } else {
        mblaPolyline.setPopupContent(content);
      }
      mblaPolyline.openPopup();
    }
  });
  
  document.getElementById('btn-calculate').style.display = 'none';
}

function calculatePbla() {
  if (pblaPoints.length < 3) return;
  
  // Добавляем первую точку в конец для замыкания полигона
  const polygonPoints = [...pblaPoints, pblaPoints[0]];
  
  // Вычисляем пересечения с зонами
  const intersectingNames = checkPolygonIntersections(polygonPoints);
  
  // Получаем высоты для всех точек
  const elevationPromises = pblaPoints.map(point => getElevation(point.lat, point.lng));
  
  Promise.all(elevationPromises).then(elevations => {
    // Вычисляем среднюю высоту
    const avgElevation = elevations.reduce((sum, elevation) => sum + elevation, 0) / elevations.length;
    
    let content = `<b>П-БЛА: Плановый полигон</b><br><b>Точек полигона:</b> ${pblaPoints.length}<br><b>Средняя высота:</b> ${Math.round(avgElevation)} м.<br>`;
    
    if (intersectingNames.length > 0) {
      content += `<b>Пересекает зоны:</b><br>• ${intersectingNames.join('<br>• ')}`;
    } else {
      content += `<b>Пересечений нет</b>`;
    }
    
    // Создаем полигон вместо линии
    if (pblaPolygon) {
      map.removeLayer(pblaPolygon);
    }
    
    pblaPolygon = L.polygon(polygonPoints, { 
      color: '#FF00FF', 
      weight: 3,
      fillColor: '#FF00FF',
      fillOpacity: 0.1
    }).addTo(map);
    
    // Добавляем popup
    pblaPolygon.bindPopup(content);
    pblaPolygon.openPopup();
    
    // Удаляем маркеры, так как полигон завершен
    pblaMarkers.forEach(marker => {
      map.removeLayer(marker);
    });
    pblaMarkers = [];
  });
  
  document.getElementById('btn-calculate').style.display = 'none';
}

// ✅ ЕДИНСТВЕННАЯ ФУНКЦИЯ МЕНЮ — ВНИЗУ СПРАВА
function createZoneToggleControl() {
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    bottom: 10px;
    right: 10px;
    z-index: 1000;
  `;

  const btn = document.createElement('button');
  btn.className = 'zone-toggle-btn';
  btn.innerHTML = '⋮';
  btn.title = 'Фильтр зон';

  const menu = document.createElement('div');
  menu.className = 'zone-menu-container';

  ZONE_PREFIXES.forEach(prefix => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = prefix;
    checkbox.checked = true;
    checkbox.onchange = () => {
      if (checkbox.checked) map.addLayer(zoneLayers[prefix]);
      else map.removeLayer(zoneLayers[prefix]);
    };
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' ' + prefix));
    menu.appendChild(label);
  });

  btn.onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle('active');
  };

  document.addEventListener('click', () => {
    menu.classList.remove('active');
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  container.appendChild(btn);
  container.appendChild(menu);
  document.body.appendChild(container);
}

// Обработка перемещения маркеров при долгом нажатии
function setupDragHandlers() {
  map.on('mousemove', function(e) {
    if (currentDraggingMarker) {
      currentDraggingMarker.setLatLng(e.latlng);
      
      // Обновляем данные в зависимости от режима
      if (mblaMode) {
        const index = mblaMarkers.indexOf(currentDraggingMarker);
        if (index !== -1) {
          mblaPoints[index] = e.latlng;
          
          // Обновляем линию
          if (mblaPolyline) {
            map.removeLayer(mblaPolyline);
          }
          mblaPolyline = L.polyline(mblaPoints, { color: '#0000FF', weight: 3 }).addTo(map);
        }
      } else if (pblaMode) {
        const index = pblaMarkers.indexOf(currentDraggingMarker);
        if (index !== -1) {
          pblaPoints[index] = e.latlng;
          
          // Обновляем линию
          if (pblaPolygon) {
            map.removeLayer(pblaPolygon);
          }
          
          // Для временного отображения рисуем линию, но не замыкаем
          const polylinePoints = [...pblaPoints];
          pblaPolygon = L.polyline(polylinePoints, { color: '#FF00FF', weight: 3 }).addTo(map);
        }
      }
    }
  });
  
  map.on('mouseup', function() {
    if (currentDraggingMarker) {
      // Обновляем высоту для перемещенной точки
      const latlng = currentDraggingMarker.getLatLng();
      getElevation(latlng.lat, latlng.lng).then(elevation => {
        if (mblaMode) {
          const index = mblaMarkers.indexOf(currentDraggingMarker);
          if (index !== -1) {
            currentDraggingMarker.bindPopup(`Точка ${index + 1}<br>Высота: ${Math.round(elevation)} м.`);
          }
        }
        // Для П-БЛА высота отображается только в итоговом расчете
      });
      
      currentDraggingMarker._icon.classList.remove('editing-point');
      currentDraggingMarker = null;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupDragHandlers();
});
