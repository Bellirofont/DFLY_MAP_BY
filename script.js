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
        let prefixFound = null;
        for (const prefix of ZONE_PREFIXES) {
          if (name.startsWith(prefix)) {
            prefixFound = prefix;
            assigned = true;
            break;
          }
        }
        if (assigned) {
          const isLargeZone = prefixFound === 'RB' || prefixFound === 'MIL';
          const layer = L.geoJSON(feature, {
            onEachFeature: (feat, l) => {
              const n = feat.properties.Name || feat.properties.name || 'Зона';
              const desc = feat.properties.description || '';
              if (!isLargeZone) {
                l.bindPopup(`<b>${n}</b><br>${desc}`);
              }
            },
            style: getZoneStyle,
            interactive: !isLargeZone
          });
          zoneLayers[prefixFound].addLayer(layer);
        } else {
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

// Функция для детализированной проверки пересечений с использованием Turf.js
function checkDetailedIntersections(geometryType, geometry) {
  if (!flyZonesGeoJSON) return [];
  
  const intersections = [];
  
  flyZonesGeoJSON.features.forEach(feature => {
    const zoneName = feature.properties.Name || feature.properties.name || 'Зона';
    let zoneGeometry = feature.geometry;
    
    // Если это MultiPolygon, используем его как есть
    const zoneTurf = turf.feature(zoneGeometry);
    
    let details = [];
    
    if (geometryType === 'circle') {
      // Для R-BLA: круг
      const turfCircle = turf.circle([geometry.center.lng, geometry.center.lat], geometry.radius / 1000, {units: 'kilometers'});
      
      // Проверка центра внутри зоны
      const centerPoint = turf.point([geometry.center.lng, geometry.center.lat]);
      if (turf.booleanPointInPolygon(centerPoint, zoneTurf)) {
        details.push('центр внутри зоны');
      }
      
      // Проверка пересечения границ
      const circleBoundary = turf.polygonToLine(turfCircle);
      if (turf.booleanIntersects(circleBoundary, zoneTurf)) {
        details.push('граница круга пересекает зону');
      }
      
    } else if (geometryType === 'line') {
      // Для M-BLA: линия
      const turfLine = turf.lineString(geometry.points.map(p => [p.lng, p.lat]));
      
      // Проверка точек внутри зоны
      geometry.points.forEach((p, index) => {
        const point = turf.point([p.lng, p.lat]);
        if (turf.booleanPointInPolygon(point, zoneTurf)) {
          details.push(`точка ${index + 1} внутри зоны`);
        }
      });
      
      // Проверка пересечения линии
      if (turf.booleanIntersects(turfLine, zoneTurf)) {
        details.push('линия пересекает зону');
      }
      
      // Проверка сегментов между точками
      for (let i = 0; i < geometry.points.length - 1; i++) {
        const segment = turf.lineString([[geometry.points[i].lng, geometry.points[i].lat], [geometry.points[i+1].lng, geometry.points[i+1].lat]]);
        if (turf.booleanIntersects(segment, zoneTurf)) {
          details.push(`сегмент между точками ${i+1} и ${i+2} пересекает зону`);
        }
      }
      
    } else if (geometryType === 'polygon') {
      // Для P-BLA: полигон
      const turfPolygon = turf.polygon([geometry.points.map(p => [p.lng, p.lat])]);
      
      // Проверка полигона на пересечение
      if (turf.booleanIntersects(turfPolygon, zoneTurf)) {
        details.push('полигон пересекает зону');
      }
      
      // Проверка точек внутри зоны
      geometry.points.forEach((p, index) => {
        const point = turf.point([p.lng, p.lat]);
        if (turf.booleanPointInPolygon(point, zoneTurf)) {
          details.push(`точка полигона ${index + 1} внутри зоны`);
        }
      });
      
      // Проверка границ линий полигона
      const polygonBoundary = turf.polygonToLine(turfPolygon);
      if (turf.booleanIntersects(polygonBoundary, zoneTurf)) {
        details.push('граница полигона пересекает зону');
      }
    }
    
    if (details.length > 0) {
      intersections.push({ name: zoneName, details: details });
    }
  });
  
  return intersections;
}

function disableZoneInteractivity() {
  ZONE_PREFIXES.forEach(prefix => {
    zoneLayers[prefix].eachLayer(geoLayer => {
      setInteractiveRecursive(geoLayer, false);
      geoLayer.off('click');
    });
  });
}

function enableZoneInteractivity() {
  ZONE_PREFIXES.forEach(prefix => {
    zoneLayers[prefix].eachLayer(geoLayer => {
      if (geoLayer.getPopup()) {
        setInteractiveRecursive(geoLayer, true);
        geoLayer.on('click', function(e) {
          this.openPopup();
        });
      } else {
        setInteractiveRecursive(geoLayer, false);
      }
    });
  });
}

function initButtons() {
  document.getElementById('btn-rbla').onclick = startRbla;
  document.getElementById('btn-mbla').onclick = startMbla;
  document.getElementById('btn-pbla').onclick = startPbla;
  document.getElementById('btn-gps').onclick = getGpsLocation;
  document.getElementById('btn-operator').onclick = placeOperatorMarker;
  document.getElementById('btn-cnl').onclick = cancelMode;
  document.getElementById('btn-rld').onclick = reloadMap;

  document.getElementById('btn-calculate').onclick = () => {
    if (tempCircle && radiusMeters) {
      calculateRbla();
    } else if (mblaPoints.length >= 2) {
      calculateMbla();
    } else if (pblaPoints.length >= 3) {
      calculatePbla();
    } else {
      alert('Недостаточно данных для расчета. Создайте объект полета сначала.');
    }
  };
}

function startRbla() {
  if (currentMode) cancelMode();
  rblaMode = true;
  currentMode = 'rbla';
  document.getElementById('btn-rbla').disabled = true;
  disableZoneInteractivity();
  map.dragging.disable();
  map.once('click', (e) => {
    centerPoint = e.latlng;
    map.on('mousemove', drawTempLine);
    map.once('click', finishRadius);
  });
}

function startMbla() {
  if (currentMode) cancelMode();
  mblaMode = true;
  currentMode = 'mbla';
  document.getElementById('btn-mbla').disabled = true;
  disableZoneInteractivity();
  map.dragging.disable();
  map.on('click', addMblaPoint);
}

function startPbla() {
  if (currentMode) cancelMode();
  pblaMode = true;
  currentMode = 'pbla';
  document.getElementById('btn-pbla').disabled = true;
  disableZoneInteractivity();
  map.dragging.disable();
  map.on('click', addPblaPoint);
}

function addMblaPoint(e) {
  const latlng = e.latlng;
  mblaPoints.push(latlng);
  
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'mbla-marker',
      html: `<div class="marker-number">${mblaPoints.length}</div>`,
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    })
  }).addTo(map);
  
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
  
  if (mblaPoints.length > 1) {
    if (mblaPolyline) {
      map.removeLayer(mblaPolyline);
    }
    mblaPolyline = L.polyline(mblaPoints, { color: '#0000FF', weight: 3 }).addTo(map);
    document.getElementById('btn-calculate').style.display = 'block';
  }
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
    } else {
      document.getElementById('btn-calculate').style.display = 'none';
    }
  }
}

function clearMbla() {
  mblaPoints = [];
  mblaMarkers.forEach(marker => map.removeLayer(marker));
  mblaMarkers = [];
  if (mblaPolyline) {
    map.removeLayer(mblaPolyline);
    mblaPolyline = null;
  }
}

function resetMbla() {
  mblaMode = false;
  document.getElementById('btn-mbla').disabled = false;
  clearMbla();
  map.off('click', addMblaPoint);
  map.dragging.enable();
  document.getElementById('btn-calculate').style.display = 'none';
  enableZoneInteractivity();
}

function addPblaPoint(e) {
  const latlng = e.latlng;
  pblaPoints.push(latlng);
  
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'pbla-marker',
      html: `<div class="marker-number">${pblaPoints.length}</div>`,
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    })
  }).addTo(map);
  
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
  
  if (pblaPoints.length > 1) {
    if (pblaPolygon) {
      map.removeLayer(pblaPolygon);
    }
    
    const polylinePoints = [...pblaPoints];
    pblaPolygon = L.polyline(polylinePoints, { color: '#FF00FF', weight: 3 }).addTo(map);
  }
  
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
    
    if (pblaPoints.length < 3) {
      document.getElementById('btn-calculate').style.display = 'none';
    }
  }
}

function clearPbla() {
  pblaPoints = [];
  pblaMarkers.forEach(marker => map.removeLayer(marker));
  pblaMarkers = [];
  if (pblaPolygon) {
    map.removeLayer(pblaPolygon);
    pblaPolygon = null;
  }
}

function resetPbla() {
  pblaMode = false;
  document.getElementById('btn-pbla').disabled = false;
  clearPbla();
  map.off('click', addPblaPoint);
  map.dragging.enable();
  document.getElementById('btn-calculate').style.display = 'none';
  enableZoneInteractivity();
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
  enableZoneInteractivity();
}

function calculateRbla() {
  if (!tempCircle) return alert('Сначала создайте круг с помощью Р-БЛА');
  if (!flyZonesGeoJSON) return alert('Зоны не загружены');
  
  const geometry = {
    center: centerPoint,
    radius: radiusMeters
  };
  const intersections = checkDetailedIntersections('circle', geometry);
  
  getElevation(centerPoint.lat, centerPoint.lng).then(elevation => {
    let content = `<b>Р-БЛА: Радиусный план</b><br><b>Центр:</b> ${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)}<br><b>Высота:</b> ${Math.round(elevation)} м.<br><b>Радиус:</b> ${radiusMeters} м<br>`;
    
    if (intersections.length > 0) {
      content += `<b>Пересечения зон:</b><br>`;
      intersections.forEach(inter => {
        content += `• ${inter.name}<br>`;
      });
    } else {
      content += `<b>Пересечений нет</b>`;
    }
    
    if (!tempCircle.getPopup()) tempCircle.bindPopup(content);
    else tempCircle.setPopupContent(content);
    tempCircle.openPopup();
  });
  
  document.getElementById('btn-calculate').style.display = 'none';
  // Блокировка дальнейшего добавления/изменения
  rblaMode = false;
  map.off('mousemove', drawTempLine);
  map.off('click', finishRadius);
  currentMode = null;
  enableZoneInteractivity();
}

function calculateMbla() {
  if (mblaPoints.length < 2) return alert('Недостаточно точек для маршрута');
  
  const geometry = {
    points: mblaPoints
  };
  const intersections = checkDetailedIntersections('line', geometry);
  
  const elevationPromises = mblaPoints.map(point => getElevation(point.lat, point.lng));
  
  Promise.all(elevationPromises).then(elevations => {
    let content = `<b>М-БЛА: Маршрутный план</b><br><b>Маршрутных точек:</b> ${mblaPoints.length}<br>`;
    
    content += '<b>Высоты рельефа:</b><br>';
    elevations.forEach((elevation, index) => {
      content += `• Точка ${index + 1}: ${Math.round(elevation)} м<br>`;
    });
    
    if (intersections.length > 0) {
      content += `<b>Пересечения зон:</b><br>`;
      intersections.forEach(inter => {
        content += `• ${inter.name}<br>`;
      });
    } else {
      content += `<b>Пересечений нет</b>`;
    }
    
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
  // Блокировка дальнейшего добавления/изменения
  mblaMode = false;
  map.off('click', addMblaPoint);
  currentDraggingMarker = null;
  mblaMarkers.forEach(marker => {
    marker.off('mousedown');
    marker.off('mouseup');
  });
  currentMode = null;
  enableZoneInteractivity();
}

function calculatePbla() {
  if (pblaPoints.length < 3) return alert('Недостаточно точек для полигона');
  
  const polygonPoints = [...pblaPoints, pblaPoints[0]];
  
  const geometry = {
    points: polygonPoints
  };
  const intersections = checkDetailedIntersections('polygon', geometry);
  
  const elevationPromises = pblaPoints.map(point => getElevation(point.lat, point.lng));
  
  Promise.all(elevationPromises).then(elevations => {
    const avgElevation = elevations.reduce((sum, elevation) => sum + elevation, 0) / elevations.length;
    
    let content = `<b>П-БЛА: Плановый полигон</b><br><b>Точек полигона:</b> ${pblaPoints.length}<br><b>Средняя высота:</b> ${Math.round(avgElevation)} м.<br>`;
    
    if (intersections.length > 0) {
      content += `<b>Пересечения зон:</b><br>`;
      intersections.forEach(inter => {
        content += `• ${inter.name}<br>`;
      });
    } else {
      content += `<b>Пересечений нет</b>`;
    }
    
    if (pblaPolygon) {
      map.removeLayer(pblaPolygon);
    }
    
    pblaPolygon = L.polygon(polygonPoints, { 
      color: '#FF00FF', 
      weight: 3,
      fillColor: '#FF00FF',
      fillOpacity: 0.1
    }).addTo(map);
    
    pblaPolygon.bindPopup(content);
    pblaPolygon.openPopup();
    
    pblaMarkers.forEach(marker => {
      map.removeLayer(marker);
    });
    pblaMarkers = [];
  });
  
  document.getElementById('btn-calculate').style.display = 'none';
  // Блокировка дальнейшего добавления/изменения
  pblaMode = false;
  map.off('click', addPblaPoint);
  currentDraggingMarker = null;
  pblaMarkers.forEach(marker => {
    marker.off('mousedown');
    marker.off('mouseup');
  });
  currentMode = null;
  enableZoneInteractivity();
}

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

function setupDragHandlers() {
  map.on('mousemove', function(e) {
    if (currentDraggingMarker) {
      currentDraggingMarker.setLatLng(e.latlng);
      
      if (mblaMode) {
        const index = mblaMarkers.indexOf(currentDraggingMarker);
        if (index !== -1) {
          mblaPoints[index] = e.latlng;
          
          if (mblaPolyline) {
            map.removeLayer(mblaPolyline);
          }
          mblaPolyline = L.polyline(mblaPoints, { color: '#0000FF', weight: 3 }).addTo(map);
        }
      } else if (pblaMode) {
        const index = pblaMarkers.indexOf(currentDraggingMarker);
        if (index !== -1) {
          pblaPoints[index] = e.latlng;
          
          if (pblaPolygon) {
            map.removeLayer(pblaPolygon);
          }
          
          const polylinePoints = [...pblaPoints];
          pblaPolygon = L.polyline(polylinePoints, { color: '#FF00FF', weight: 3 }).addTo(map);
        }
      }
    }
  });
  
  map.on('mouseup', function() {
    if (currentDraggingMarker) {
      const latlng = currentDraggingMarker.getLatLng();
      getElevation(latlng.lat, latlng.lng).then(elevation => {
        if (mblaMode) {
          const index = mblaMarkers.indexOf(currentDraggingMarker);
          if (index !== -1) {
            currentDraggingMarker.bindPopup(`Точка ${index + 1}<br>Высота: ${Math.round(elevation)} м.`);
          }
        }
      });
      
      currentDraggingMarker._icon.classList.remove('editing-point');
      currentDraggingMarker = null;
    }
  });
}

function cancelMode() {
  if (currentMode === 'rbla') {
    resetRBLA();
    if (tempCircle) map.removeLayer(tempCircle);
    tempCircle = null;
    centerPoint = null;
    radiusMeters = null;
  } else if (currentMode === 'mbla') {
    resetMbla();
  } else if (currentMode === 'pbla') {
    resetPbla();
  }
  document.getElementById('btn-calculate').style.display = 'none';
  currentMode = null;
  enableZoneInteractivity();
}

function reloadMap() {
  location.reload();
}

function getGpsLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      map.setView([lat, lng], 15);
      L.marker([lat, lng]).addTo(map).bindPopup('Ваше местоположение').openPopup();
    }, error => {
      alert('Не удалось получить GPS: ' + error.message);
    });
  } else {
    alert('GPS не поддерживается');
  }
}

function placeOperatorMarker() {
  const center = map.getCenter();
  if (operatorMarker) map.removeLayer(operatorMarker);
  operatorMarker = L.marker(center, {
    icon: L.divIcon({
      className: 'operator-marker',
      html: '<div class="operator-marker-inner">O</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  }).addTo(map);
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupDragHandlers();
});
