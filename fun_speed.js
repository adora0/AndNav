/*in updateNavigationDisplay verificare se overspeed=1 e inviare all'esp*/

let overspeed=0; //se 1 velocità elevata

function getEstimatedSpeed(lat, lon) {
    if (!navigationState.isNavigating || navigationState.currentStepIndex >= navigationState.steps.length) {
        return null;
    }

    const currentStep = navigationState.steps[navigationState.currentStepIndex];
    const [startIdx, endIdx] = currentStep.way_points;

    // Trova il waytype dominante nel range corrente
    const wayTypes = navigationState.wayTypes; // Assicurati che sia già stato estratto da routeJson.routes[0].extras.waytypes.values

    const matchedTypes = wayTypes.filter(([x, y]) => y >= startIdx && x <= endIdx);

    const dominant = matchedTypes.reduce((prev, curr) => {
        const prevLength = prev[1] - prev[0];
        const currLength = curr[1] - curr[0];
        return currLength > prevLength ? curr : prev;
    }, matchedTypes[0]);

    const waytypeId = dominant?.[2] ?? 9;

    const waytypeSpeedMap = {
        0: { name: "Autostrada", speed: 130 },
        1: { name: "Strada principale", speed: 90 },
        2: { name: "Strada secondaria", speed: 70 },
        3: { name: "Residenziale", speed: 50 },
        4: { name: "Sentiero", speed: 10 },
        5: { name: "Ciclabile", speed: 20 },
        6: { name: "Pedonale", speed: 5 },
        7: { name: "Sterrata", speed: 30 },
        8: { name: "Agricola", speed: 25 },
        9: { name: "Altro", speed: 40 }
    };

    return waytypeSpeedMap[waytypeId];
}