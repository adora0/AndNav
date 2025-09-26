const apiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijk3MTA2OWJmYTk2ZTRjNjNiZjY3ZmNkMjY1NTEwN2I1IiwiaCI6Im11cm11cjY0In0=';
const form = document.getElementById('routeForm');
const results = document.getElementById('results');
const useLocationBtn = document.getElementById('useLocation');

//BLE
let device, server, service;
let characteristics = {};
let isConnected = false;
const SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb';
const CHAR_UUIDS = {
  icon: '0000a001-0000-1000-8000-00805f9b34fb',
  distance: '0000a002-0000-1000-8000-00805f9b34fb',
  eta: '0000a003-0000-1000-8000-00805f9b34fb',
  total_km: '0000a004-0000-1000-8000-00805f9b34fb'
};

let startCoords = null;
let endCoords = null;
let map = L.map('map').setView([41.9028, 12.4964], 13); // Roma
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let routeLayer = null;


form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = document.getElementById('profile').value;

    try {
        if (!startCoords || !endCoords) throw new Error("Seleziona partenza e arrivo dai suggerimenti.");
        const route = await getRoute(startCoords, endCoords, profile);
        displayRoute(route);
    } catch (err) {
        console.log(err);
        results.innerHTML = `<p style="color:red;">Errore: ${err.message}</p>`;
    }
});

useLocationBtn.addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        document.getElementById('start').value = label;
        startCoords = [lon, lat];
        document.getElementById('startSuggestions').innerHTML = '';
    }, () => {
        alert("Impossibile ottenere la posizione.");
    });
});

async function fetchSuggestions(query) {
    const res = await fetch(`https://api.openrouteservice.org/geocode/autocomplete?api_key=${apiKey}&text=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data || !data.features || data.features.length === 0) {
        return []; // Nessun suggerimento disponibile
    }

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

setupAutocomplete('start', 'startSuggestions', coords => startCoords = coords);
setupAutocomplete('end', 'endSuggestions', coords => endCoords = coords);

async function getRoute(start, end, profile) {
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}`, {
        method: 'POST',
        headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            coordinates: [start, end],
            instructions: true,
            language: "IT"
        })
    });
    return await res.json();
}

function displayRoute(data) {
    const route = data.routes[0];
    const segment = route.segments?.[0];
    const steps = segment?.steps;

    const duration = (route.summary.duration / 60).toFixed(1);
    const distance = (route.summary.distance / 1000).toFixed(2);
    console.log(data);
    let stepsHtml = '<p>Nessuna istruzione disponibile.</p>';
    if (Array.isArray(steps) && steps.length > 0) {
        stepsHtml = `
    <table>
      <thead>
        <tr>
          <th>🧭</th>
          <th>Istruzione</th>
          <th>Distanza</th>
          <th>Durata</th>
        </tr>
      </thead>
      <tbody>
        ${steps.map(step => {
            //const { icon, text } = getStepIconAndText(step);
            return `
            <tr>
              <td style="font-size: 1.2em;">${step.type}</td>
              <td>${step.instruction}</td>
              <td>${step.distance.toFixed(0)} m</td>
              <td>${step.duration.toFixed(0)} sec</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
    }

    results.innerHTML = `
    <h2>Durata: ${duration} min</h2>
    <h3>Distanza: ${distance} km</h3>
    ${stepsHtml}
  `
    // Rimuovi marker precedenti se presenti
    if (window.stepMarkers) {
        window.stepMarkers.forEach(m => map.removeLayer(m));
    }
    window.stepMarkers = [];

    const geometry = decodePolyline(route.geometry); // array di [lat, lon]

    steps.forEach(step => {
        const startIndex = step.way_points?.[0];
        if (startIndex == null || !geometry[startIndex]) return;

        const position = geometry[startIndex];
        //const { icon, text } = getStepIconAndText(step);

        const popupId = `miniMap-${startIndex}`;
        const popupContent = `
  <div style="width:200px;height:150px;" id="${popupId}"></div>
  <div style="font-size:0.9em;margin-top:4px;">
    <strong>${step.type} ${step.instruction}</strong><br />
    ${step.distance.toFixed(0)} m – ${step.duration.toFixed(0)} sec
  </div>
`;

        const marker = L.marker(position).addTo(map).bindPopup(popupContent);
        marker.on('popupopen', () => {
            const miniMap = L.map(popupId, {
                attributionControl: false,
                zoomControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                tap: false
            }).setView(position, 16);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                interactive: false
            }).addTo(miniMap);

            const segmentCoords = geometry.slice(step.way_points[0], step.way_points[1] + 1);
            L.polyline(segmentCoords, { color: 'red', weight: 4 }).addTo(miniMap);
        });

        window.stepMarkers.push(marker);
    });

    const coords = decodePolyline(route.geometry);
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.polyline(coords, { color: 'blue' }).addTo(map);
    map.fitBounds(routeLayer.getBounds());
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

/********BLE******* */
async function connectBLE() {
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'MotoNav' }],
      optionalServices: [SERVICE_UUID]
    });

    device.addEventListener('gattserverdisconnected', onDisconnected);

    server = await device.gatt.connect();
    service = await server.getPrimaryService(SERVICE_UUID);

    for (const [key, uuid] of Object.entries(CHAR_UUIDS)) {
      characteristics[key] = await service.getCharacteristic(uuid);
    }

    isConnected = true;
    console.log('✅ Dispositivo connesso');
  } catch (error) {
    console.error('❌ Errore di connessione:', error);
    isConnected = false;
  }
}

function onDisconnected() {
  console.warn('⚠️ Dispositivo disconnesso');
  isConnected = false;
}


async function sendNavigationData({ icon, distance, eta, total_km }) {
  if (!isConnected) {
    console.warn('🔌 Dispositivo non connesso');
    return;
  }

  try {
    await characteristics.icon.writeValue(Uint8Array.of(icon));
    await characteristics.distance.writeValue(Uint16Array.of(distance));
    await characteristics.eta.writeValue(Uint16Array.of(eta));
    const kmBuffer = new ArrayBuffer(4);
    new DataView(kmBuffer).setFloat32(0, total_km, true);
    await characteristics.total_km.writeValue(kmBuffer);

    console.log('📤 Dati inviati:', { icon, distance, eta, total_km });
  } catch (error) {
    console.error('❌ Errore invio dati:', error);
  }
}

document.getElementById('connect-ble').addEventListener('click', async () => {
  showScanningIndicator(true);
  await connectBLE();
  showScanningIndicator(false);
});

function showScanningIndicator(active) {
  const status = document.getElementById('ble-scan-status');
  status.textContent = active ? '🔍 Cercando dispositivi BLE...' : '';
}

setInterval(() => {
  if (!isConnected) return;

  const navData = {
    icon: 1,             // svolta a destra
    distance: 85,        // metri
    eta: 320,            // secondi
    total_km: 3.2        // km
  };

  sendNavigationData(navData);
}, 2000); // ogni 2 secondi

function updateStatusUI() {
  const status = document.getElementById('ble-status');
  status.textContent = isConnected ? '🟢 Connesso' : '🔴 Disconnesso';
}

function showScanningIndicator(active) {
  const indicator = document.getElementById('ble-scan-status');
  indicator.textContent = active ? '🔍 Cercando dispositivi BLE...' : '';
}

async function startBLEScan() {
  try {
    console.log('🔍 Scansione BLE avviata...');
    showScanningIndicator(true); // attiva spinner o messaggio

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'MotoNav' }],
      optionalServices: ['0000abcd-0000-1000-8000-00805f9b34fb']
    });

    console.log('📡 Dispositivo trovato:', device.name);
    showScanningIndicator(false); // disattiva spinner

    // continua con la connessione...
  } catch (error) {
    console.warn('❌ Scansione annullata o fallita:', error);
    showScanningIndicator(false);
  }
}


function getStepIconAndText(step) {
    const typeMap = {
        0: ['➡️', 'Continua'],
        1: ['↗️', 'Svolta a destra'],
        2: ['↖️', 'Svolta a sinistra'],
        3: ['➡️', 'Gira a destra'],
        4: ['⬅️', 'Gira a sinistra'],
        5: ['↘️', 'Mantieni la destra'],
        6: ['↙️', 'Mantieni la sinistra'],
        7: ['🔄', 'Inversione a U'],
        11: ['⬆️', 'Procedi'],
        12: ['🔁', 'Rotonda'],
        13: ['↘️', 'Mantieni la destra'],
        14: ['↙️', 'Mantieni la sinistra'],
        15: ['🏁', 'Arrivo']
    };

    const [icon, label] = typeMap[step.type] || ['❓', 'Manovra'];
    const road = step.name ? ` su <em>${step.name}</em>` : '';
    const exit = step.exit_number ? ` (uscita ${step.exit_number})` : '';
    return {
        icon,
        text: `${label}${road}${exit}`
    };
}

let userMarker = null;
let watchId = null;

function startTrackingPosition() {
    if (watchId) return; // già attivo
    watchId = navigator.geolocation.watchPosition(
        pos => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;

            // Aggiorna o crea il marker della posizione utente
            if (userMarker) {
                userMarker.setLatLng([lat, lon]);
            } else {
                userMarker = L.marker([lat, lon], {icon: L.icon({iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', iconSize: [32,32]})}).addTo(map);
            }
            // Centra la mappa sulla posizione attuale (opzionale)
            map.setView([lat, lon]);
        },
        err => {
            alert("Impossibile ottenere la posizione in tempo reale.");
        },
        { enableHighAccuracy: true, maximumAge: 1000 }
    );
}

function stopTrackingPosition() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
        }
    }
}

// Avvia il tracking quando la pagina viene caricata
startTrackingPosition();

