const apiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijk3MTA2OWJmYTk2ZTRjNjNiZjY3ZmNkMjY1NTEwN2I1IiwiaCI6Im11cm11cjY0In0=';
const form = document.getElementById('routeForm');
const results = document.getElementById('results');
const useLocationBtn = document.getElementById('useLocation');

// Stato BLE
let bleState = {
    isConnected: false,
    isScanning: false,
    deviceName: '',
    deviceAddress: ''
};

// Stato navigazione
let navigationState = {
    isNavigating: false,
    currentStepIndex: 0,
    steps: [],
    routeGeometry: [],
    totalDistance: 0,
    totalDuration: 0,
    remainingDistance: 0
};

let currentPoint = null;
let startCoords = null;
let endCoords = null;
let waypoints = [];
let lastPosition = null;
let speed = 0;
let map = L.map('map').setView([41.9028, 12.4964], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let routeLayer = null;

// Mappa manovre OpenRouteService -> Chronos icons
const chronosIconMap = {
    0: 0,   // turn left
    1: 1,   // turn right
    2: 1,   // Turn sharp left
    3: 2,   // Turn sharp right
    4: 2,   // turn left
    5: 3,   // sharp right
    6: 4,   // sharp left
    7: 5,   // roundabout
    8: 6,   // exit roundabout
    9: 7,   // arrive
    10: 8,  // depart
    11: 9,  // ferry
    12: 0   // continue
};

// Icone visual per UI
const maneuverIcons = {
    0: "0.png",//- Turn left
    1: "1.png",//- Turn right
    2: "2.png",//- Turn sharp left
    3: "3.png",//- Turn sharp right
    4: "4.png",//- Turn slight left
    5: "5.png",//- Turn slight right
    6: "6.png",//- Continue
    7: "7.png",//- Enter roundabout
    8: "8.png",//- Exit roundabout
    9: "9.png",//- U-turn
    10: "10.png",//- Finish
    11: "11.png",//- Depart
    12: "12.png",//- Keep left
    13: "13.png",//- Keep right
    14: "14.png"//- Unknown
};

/*****Gestione stato BLE*****/
function updateBLEStatus(status, scanning = false, deviceInfo = null) {
    bleState.isScanning = scanning;
    bleState.isConnected = status === 'connected';

    const container = document.getElementById('ble-container');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('ble-status-text');
    const deviceInfoEl = document.getElementById('ble-device-info');
    const retryBtn = document.getElementById('retry-scan');

    container.classList.remove('ble-connected', 'ble-disconnected', 'ble-scanning');
    statusDot.classList.remove('dot-connected', 'dot-disconnected', 'dot-scanning');

    if (scanning) {
        container.classList.add('ble-scanning');
        statusDot.classList.add('dot-scanning');
        statusText.textContent = '🔍 Cercando ESP32-S3...';
        deviceInfoEl.textContent = '';
        retryBtn.disabled = true;
    } else if (status === 'connected') {
        container.classList.add('ble-connected');
        statusDot.classList.add('dot-connected');
        statusText.textContent = '✅ Connesso a ESP32-S3';
        if (deviceInfo) {
            bleState.deviceName = deviceInfo.name || 'ESP32-S3';
            bleState.deviceAddress = deviceInfo.address || '';
            deviceInfoEl.textContent = `Dispositivo: ${bleState.deviceName} (${bleState.deviceAddress})`;
        }
        retryBtn.disabled = true;
    } else {
        container.classList.add('ble-disconnected');
        statusDot.classList.add('dot-disconnected');
        statusText.textContent = '❌ Dispositivo disconnesso';
        deviceInfoEl.textContent = 'Premi "Riconnetti BLE" per cercare il dispositivo';
        retryBtn.disabled = false;
    }
}

window.showScanningIndicator = function (active) {
    if (active) {
        updateBLEStatus('scanning', true);
    }
};

window.onBLEConnected = function (deviceName, deviceAddress) {
    console.log('✅ BLE Connesso:', deviceName, deviceAddress);
    updateBLEStatus('connected', false, { name: deviceName, address: deviceAddress });
};

window.onDisconnected = function () {
    console.log('⚠️ BLE Disconnesso');
    updateBLEStatus('disconnected', false);
};

window.updateStatusUI = function (message) {
    if (message && message.includes('Connesso')) {
        updateBLEStatus('connected', false);
    } else {
        updateBLEStatus('disconnected', false);
    }
};

window.toggleRetryButton = function (enabled) {
    document.getElementById('retry-scan').disabled = !enabled;
};

updateBLEStatus('disconnected', false);

/*****Gestione form******/
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = document.getElementById('profile').value;

    try {
        if (!startCoords || !endCoords) throw new Error("Seleziona partenza e arrivo dai suggerimenti.");

        const waypointInputs = document.querySelectorAll('.waypoint-input');
        waypoints = [];

        waypointInputs.forEach(input => {
            const lat = parseFloat(input.dataset.lat);
            const lng = parseFloat(input.dataset.lng);
            if (!isNaN(lat) && !isNaN(lng)) {
                waypoints.push([lng, lat]); // ORS usa [lon, lat]
            }
        });
        const route = await getRoute(startCoords, endCoords, profile, waypoints);
        displayRoute(route);
        startNavigation(route);  // ⭐ Prepara ma non avvia
    } catch (err) {
        console.log(err);
        results.innerHTML = `<p style="color:red;">Errore: ${err.message}</p>`;
    }
});

useLocationBtn.addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        updateLocation(lat, lon, 0);
    }, () => {
        alert("Impossibile ottenere la posizione.");
    });
});

document.getElementById('retry-scan').addEventListener('click', () => {
    updateBLEStatus('scanning', true);
    if (window.AndroidBLE && typeof AndroidBLE.retryScan === 'function') {
        AndroidBLE.retryScan();
    } else {
        console.warn('⚠️ Interfaccia AndroidBLE non disponibile');
        setTimeout(() => updateBLEStatus('disconnected', false), 2000);
    }
});

async function fetchSuggestions(query) {
    const res = await fetch(`https://api.openrouteservice.org/geocode/autocomplete?api_key=${apiKey}&text=${encodeURIComponent(query)}&boundary.country=IT`);
    const data = await res.json();
    if (!data || !data.features || data.features.length === 0) return [];
    return data.features.map(f => ({
        label: f.properties.label,
        coordinates: f.geometry.coordinates
    }));
}

function setupAutocomplete(inputId, suggestionsId, setCoordsCallback) {
    const input = document.getElementById(inputId);
    const suggestionsList = document.getElementById(suggestionsId);

    input.addEventListener('input', async () => {
        const query = input.value;
        if (query.length < 3) {
            suggestionsList.innerHTML = '';
            return;
        }

        const suggestions = await fetchSuggestions(query);
        if (suggestions.length === 0) {
            suggestionsList.innerHTML = '<li>Nessun risultato trovato</li>';
            return;
        }

        suggestionsList.innerHTML = '';
        suggestions.forEach(s => {
            const li = document.createElement('li');
            li.textContent = s.label;
            li.addEventListener('click', () => {
                input.value = s.label;
                suggestionsList.innerHTML = '';
                setCoordsCallback(s.coordinates);
            });
            suggestionsList.appendChild(li);
        });
    });

    document.addEventListener('click', (e) => {
        if (!suggestionsList.contains(e.target) && e.target !== input) {
            suggestionsList.innerHTML = '';
        }
    });
}

let waypointIndex = 0;

document.getElementById('add-waypoint').addEventListener('click', () => {
    const container = document.getElementById('waypoints-container');

    const group = document.createElement('div');
    group.className = 'input-group';

    const label = document.createElement('label');
    label.className = 'input-label';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Cerca tappa...';
    input.className = 'waypoint-input';
    input.required = true;

    const suggestions = document.createElement('ul');
    suggestions.className = 'suggestions';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-waypoint';
    removeBtn.textContent = '✖';
    removeBtn.title = 'Rimuovi tappa';
    removeBtn.addEventListener('click', () => {
        container.removeChild(group);
        updateWaypointLabels();
    });

    group.appendChild(label);
    group.appendChild(input);
    group.appendChild(suggestions);
    group.appendChild(removeBtn);
    container.appendChild(group);

    // Assegna ID univoci
    input.id = `waypoint-${waypointIndex}`;
    suggestions.id = `waypointSuggestions-${waypointIndex}`;

    // Callback per salvare le coordinate nel dataset
    const setCoords = (coords) => {
        input.dataset.lat = coords[1];
        input.dataset.lng = coords[0];
    };

    setupAutocomplete(input.id, suggestions.id, setCoords);

    waypointIndex++;
    updateWaypointLabels();
});

// 🔁 Funzione per aggiornare le etichette delle tappe
function updateWaypointLabels() {
    const groups = document.querySelectorAll('#waypoints-container .input-group');
    groups.forEach((group, index) => {
        const label = group.querySelector('.input-label');
        label.textContent = `🛑 Tappa ${index + 1}`;
    });
}

setupAutocomplete('start', 'startSuggestions', coords => startCoords = coords);
setupAutocomplete('end', 'endSuggestions', coords => endCoords = coords);

// Listener pulsanti navigazione
document.getElementById('start-navigation').addEventListener('click', () => {
    if (navigationState.steps.length > 0) {
        navigationState.isNavigating = true;
        navigationState.currentStepIndex = 0;

        document.getElementById('navigation-panel').classList.add('active');
        document.getElementById('start-navigation').style.display = 'none';
        document.getElementById('stop-navigation').style.display = 'inline-block';

        updateNavigationDisplay();
        console.log('🚀 Navigazione avviata');
    }
});

document.getElementById('stop-navigation').addEventListener('click', () => {
    navigationState.isNavigating = false;

    document.getElementById('navigation-panel').classList.remove('active');
    document.getElementById('start-navigation').style.display = 'inline-block';
    document.getElementById('stop-navigation').style.display = 'none';
    speed=0;
    sendChronosNavigationData(null); // Segnala fine navigazione
    console.log('⏹️ Navigazione fermata');
});

/*****Calcolo percorso****/
async function getRoute(start, end, profile, waypoints = []) {
    const preference = document.getElementById('preference').value;

    // Costruisci l'array completo delle coordinate
    const coordinates = [start, ...waypoints, end];

    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}`, {
        method: 'POST',
        headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            coordinates: coordinates,
            instructions: true,
            language: "it",
            maneuvers: true,
            roundabout_exits: true,
            preference: preference,
            attributes: ["avgspeed", "detourfactor", "percentage"]
        })
    });

    return await res.json();
}

function startNavigation(data) {
    const route = data.routes[0];
    const segment = route.segments?.[0];

    navigationState.currentStepIndex = 0;
    navigationState.steps = segment?.steps || [];
    navigationState.routeGeometry = decodePolyline(route.geometry);
    navigationState.totalDistance = route.summary.distance;
    navigationState.totalDuration = route.summary.duration;
    navigationState.remainingDistance = route.summary.distance;

    //document.getElementById('navigation-panel').classList.add('active');

    /*if (navigationState.steps.length > 0) {
        updateNavigationDisplay();
    }*/
}

function displayRoute(data) {
    const route = data.routes[0];
    const segments = route.segments || [];

    let allSteps = [];
    let usedIndexes = new Set();
    let geometry = decodePolyline(route.geometry);

    segments.forEach(segment => {
        if (Array.isArray(segment.steps)) {
            allSteps = allSteps.concat(segment.steps);
        }
    });

    const duration = (route.summary.duration / 60).toFixed(1);
    const distance = (route.summary.distance / 1000).toFixed(2);

    let stepsHtml = '<p>Nessuna istruzione disponibile.</p>';
    if (allSteps.length > 0) {
        stepsHtml = `
        <table>
          <thead>
            <tr>
              <th>🧭</th>
              <th>Istruzione</th>
              <th>Distanza</th>
              <th>Durata</th>
              <th>Uscita rotatoria</th>
            </tr>
          </thead>
          <tbody>
            ${allSteps.map((step, idx) => {
                const icon = maneuverIcons[step.type];
                return `
                <tr style="${idx === navigationState.currentStepIndex ? 'background: #e3f2fd; font-weight: bold;' : ''}">
                  <td><img src="${icon}" width="48" height="48" alt="Icona" /></td>
                  <td>${step.instruction}</td>
                  <td>${step.distance.toFixed(0)} m</td>
                  <td>${step.duration.toFixed(0)} sec</td>
                  <td>${(step.exit_number == null) ? '' : step.exit_number}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    }

    results.innerHTML = `
      <h2>⏱️ Durata: ${duration} min</h2>
      <h3>📍 Distanza: ${distance} km</h3>
      ${stepsHtml}
    `;

    if (window.stepMarkers) {
        window.stepMarkers.forEach(m => map.removeLayer(m));
    }
    window.stepMarkers = [];

    allSteps.forEach((step, idx) => {
        const index = step.way_points?.[0] ?? idx;
        if (usedIndexes.has(index) || !geometry[index]) return;

        usedIndexes.add(index);
        const position = geometry[index];
        const icon = maneuverIcons[step.type];
		const markerIcon = L.icon({	
			iconUrl: "marker.png",		
			iconSize: [10, 10],
			iconAnchor: [0, 0], // centro in basso
			popupAnchor: [0, -48]
		});
        const marker = L.marker(position,{ icon: markerIcon }).addTo(map).bindPopup(`
          <div style="font-size:1.2em;text-align:center;">
            <img src="${icon}" width="48" height="48" alt="Icona" />
          </div>
          <div style="font-size:0.9em;margin-top:4px;">
            <strong>${step.instruction}</strong><br />
            ${step.distance.toFixed(0)} m — ${step.duration.toFixed(0)} sec
          </div>
        `);
        window.stepMarkers.push(marker);
    });

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.layerGroup().addTo(map);

	const segmentColors = ['#007bff']; // colori ciclici

	segments.forEach((segment, idx) => {
		const [startIdx, endIdx] = segment.way_points || [0, geometry.length - 1];
		const segmentCoords = geometry.slice(startIdx, endIdx + 1);
		const color = segmentColors[idx % segmentColors.length];

		const polyline = L.polyline(segmentCoords, {
			color,
			weight: 5,
			opacity: 0.9
		}).addTo(routeLayer);
	});
	
	// Partenza
	L.marker(geometry[0], {
		icon: L.icon({
			iconUrl: 'start.png',
			iconSize: [32, 48],
			iconAnchor: [16, 32]
		})
	}).addTo(map).bindPopup('📍 Partenza');

	// Arrivo
	L.marker(geometry[geometry.length - 1], {
		icon: L.icon({
			iconUrl: 'end.png',
			iconSize: [32, 48],
			iconAnchor: [16, 32]
		})
	}).addTo(map).bindPopup('🏁 Arrivo');

	// Tappe intermedie
	waypoints.forEach(([lng, lat], i) => {
		L.marker([lat, lng], {
			icon: L.icon({
				iconUrl: 'way	.png',
				iconSize: [28, 32],
				iconAnchor: [14, 28]
			})
		}).addTo(map).bindPopup(`🛑 Tappa ${i + 1}`);
	});
	
    document.getElementById('navigation-controls').style.display = 'block';
    document.getElementById('start-navigation').style.display = 'inline-block';
    document.getElementById('stop-navigation').style.display = 'none';
}


/*visualizza risultati*/
document.getElementById('toggle-results').addEventListener('click', () => {
  const results = document.getElementById('results');
  results.classList.toggle('results-hidden');
});


function updateNavigationDisplay() {
    if (!navigationState.isNavigating || navigationState.currentStepIndex >= navigationState.steps.length) {
        document.getElementById('nav-instruction').textContent = '🏁 Destinazione raggiunta!';
        document.getElementById('nav-distance').textContent = '0 m';
        sendChronosNavigationData(null); // Segnala fine navigazione
        return;
    }

    const currentStep = navigationState.steps[navigationState.currentStepIndex];
    // const chronosIcon = chronosIconMap[currentStep.type] || 0;
    const icon = maneuverIcons[currentStep.type];
    document.getElementById('nav-icon').innerHTML = `<img src="${icon}" width="120" height="120" />`;
    document.getElementById('nav-instruction').textContent = currentStep.instruction;
    document.getElementById('nav-distance').textContent = `${currentStep.distance.toFixed(0)} m`;
    document.getElementById('nav-next-distance').textContent = `${currentStep.distance.toFixed(0)} m`;
    document.getElementById('nav-total-distance').textContent = `${(navigationState.remainingDistance / 1000).toFixed(2)} km`;


    const remainingDuration = navigationState.steps
        .slice(navigationState.currentStepIndex)
        .reduce((sum, step) => sum + step.duration, 0);
    document.getElementById('nav-total-time').textContent = `${getArrivalTime(remainingDuration).duration}`;
    document.getElementById('nav-eta').textContent = `${getArrivalTime(remainingDuration).arrivalTime}`;
    const stepProgress = Math.max(0, Math.min(100, 100 - (currentStep.distance / currentStep.distance * 100)));
    const exit_number = (currentStep.exit_number == null) ? '' : currentStep.exit_number;
    document.getElementById('nav-progress').style.width = `${stepProgress}%`;


    // Invia dati in formato Chronos
    sendChronosNavigationData({
        icon: currentStep.type,
        stepDistance: Math.round(currentStep.distance),
        instruction: currentStep.instruction,
        progress: Math.round((navigationState.currentStepIndex / navigationState.steps.length) * 100),
        totalDistance: document.getElementById('nav-total-distance').textContent,
        time: document.getElementById('nav-total-time').textContent,
        eta: document.getElementById('nav-eta').textContent,
        exit_number: exit_number
    });
}

function decodePolyline(encoded) {
    let points = [];
    let index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        points.push([lat / 1e5, lng / 1e5]);
    }

    return points;
}
/*aggiorna la posizione, se isUpdate==1, è automatica, altrimenti è
stato premuto il pulsante di trova posizione*/
function updateLocation(lat, lon, isUpdate) {

   const coords = [lat, lon];

   if (isUpdate === 0 || startCoords == null) {
       startCoords = [lon,lat];
       document.getElementById('start').value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
   }

    document.getElementById('startSuggestions').innerHTML = '';

    /*visualizzo la mappa all'inizio del percorso se non sono in navigazione*/
    map.setView(coords, 16);

	/*speed*/
	const now = Date.now();
	if (lastPosition) {
		const dt = (now - lastPosition.timestamp) / 1000;
		const d = getDistance(lat, lon, lastPosition.lat, lastPosition.lon);
		speed = ((d / dt) * 3.6).toFixed(1); // m/s
		console.log(`🚗 Velocità: ${(speed * 3.6).toFixed(1)} km/h`);
	}
	lastPosition = { lat, lon, timestamp: now };


    if (currentPoint) {
        map.removeLayer(currentPoint);
    }

    currentPoint = L.circleMarker(coords, {
        radius: 8,
        color: 'red',
        fillColor: 'red',
        fillOpacity: 1
    }).addTo(map);

    checkTurnByTurn(lat, lon);
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const toRad = x => x * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function checkTurnByTurn(lat, lon) {
    if (!navigationState.isNavigating || navigationState.currentStepIndex >= navigationState.steps.length) {
        return;
    }

    const currentStep = navigationState.steps[navigationState.currentStepIndex];
    const stepWaypoint = currentStep.way_points?.[0];

    if (stepWaypoint == null || !navigationState.routeGeometry[stepWaypoint]) {
        return;
    }

    const [stepLat, stepLon] = navigationState.routeGeometry[stepWaypoint];
    const distanceToStep = getDistance(lat, lon, stepLat, stepLon);

    currentStep.distance = Math.max(0, distanceToStep);

    navigationState.remainingDistance = navigationState.steps
        .slice(navigationState.currentStepIndex)
        .reduce((sum, step) => sum + step.distance, 0);

    updateNavigationDisplay();

    if (distanceToStep < 15 && navigationState.currentStepIndex < navigationState.steps.length - 1) {
        navigationState.currentStepIndex++;
        updateNavigationDisplay();

        const rows = document.querySelectorAll('#results tbody tr');
        rows.forEach((row, idx) => {
            if (idx === navigationState.currentStepIndex) {
                row.style.background = '#e3f2fd';
                row.style.fontWeight = 'bold';
            } else {
                row.style.background = '';
                row.style.fontWeight = '';
            }
        });
    }
}

/*****Protocollo Chronos BLE*****/
function sendChronosNavigationData(navData) {

    if (!bleState.isConnected) return;

    if (!window.AndroidBLE || typeof AndroidBLE.sendChronosNavigation !== 'function') {
        console.warn('🔌 Interfaccia AndroidBLE non disponibile');
        return;
    }

    try {
        if (navData === null) {
            AndroidBLE.sendChronosNavigation(JSON.stringify({ active: false }));
        } else {
            //carico l'icona nel BLEManager
            //AndroidBLE.prepareIcon(navData.icon + '.png');

            //invio i dati di navigazione
            AndroidBLE.sendChronosNavigation(JSON.stringify({
                active: true,
                icon: navData.icon,
                stepDistance: navData.stepDistance,
                totalDistance: navData.totalDistance,
                time: navData.time,
                eta: navData.eta,
                instruction: navData.instruction,
                exit_number: navData.exit_number
            }));
        }
    } catch (error) {
        console.error('❌ Errore invio Chronos:', error);
    }
}

//visulizzazione messaggi da esp32
window.showESP32Message = function (msg) {
    const container = document.getElementById('esp32-messages');
    const log = document.getElementById('esp32-log');

    const time = new Date(msg.timestamp).toLocaleTimeString();
    const entry = document.createElement('div');
    entry.style.padding = '5px';
    entry.style.borderBottom = '1px solid #ddd';
    entry.style.marginBottom = '5px';

    let parsedHtml = '';
    if (msg.parsed) {
        const parsed = typeof msg.parsed === 'string' ? JSON.parse(msg.parsed) : msg.parsed;
        parsedHtml = `
            <div><strong>Type:</strong> ${parsed.type || 'Unknown'}</div>
            <div><strong>Command:</strong> ${parsed.command || 'N/A'}</div>
            ${parsed.subCmd ? `<div><strong>SubCmd:</strong> ${parsed.subCmd}</div>` : ''}
            ${parsed.value !== undefined ? `<div><strong>Value:</strong> ${parsed.value}</div>` : ''}
        `;
    }

    entry.innerHTML = `
        <div style="color: #666;">${time}</div>
        <div><strong>Hex:</strong> <code>${msg.hex}</code></div>
        <div><strong>Bytes:</strong> ${msg.length}</div>
        ${parsedHtml}
    `;

    log.insertBefore(entry, log.firstChild);

    while (log.children.length > 10) {
        log.removeChild(log.lastChild);
    }
};

function canvasToByteArray(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, 48, 48).data;
    const byteArray = new Uint8Array((48 * 48) / 8);

    for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 48; x++) {
            const i = (y * 48 + x) * 4;
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];
            const a = imageData[i + 3];

            const isDark = a > 128 && (r + g + b) < 384;
            const bitIndex = y * 48 + x;
            const byteIndex = Math.floor(bitIndex / 8);
            const bitPos = 7 - (x % 8);

            if (isDark) {
                byteArray[byteIndex] |= (1 << bitPos);
            }
        }
    }

    return byteArray;
}


function loadPngToByteArray(path, callback) {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // utile se il file è su un server esterno

    img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');

        // Disegna l'immagine ridimensionata su canvas 48x48
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const previewCanvas = document.getElementById('preview-icon');
        const previewCtx = previewCanvas.getContext('2d');
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);

        // Converte in byte array binario
        const byteArray = canvasToByteArray(canvas);

        // Restituisce il risultato tramite callback
        callback(byteArray);
    };

    img.src = path;
}

function loadAndSendIcon(filename) {
    fetch(filename)
        .then(response => response.blob())
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
            const canvas = document.getElementById('preview-icon');
            const ctx = canvas.getContext('2d');

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

            const byteArray = canvasToByteArray(canvas);

            // Invia a Kotlin via WebView bridge
            if (window.Android && window.Android.sendBytes) {
                window.Android.sendBytes(Array.from(byteArray));
            }
        })
        .catch(err => console.error("❌ Errore nel caricamento immagine:", err));
}

function getArrivalTime(seconds) {
    const now = new Date();
    const arrival = new Date(now.getTime() + seconds * 1000);

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    const pad = (num) => String(num).padStart(2, '0');

    const duration = `${pad(hrs)}h ${pad(mins)}m`;
    const arrivalTime = `${pad(arrival.getHours())}:${pad(arrival.getMinutes())}`;

    return { duration, arrivalTime };
}
