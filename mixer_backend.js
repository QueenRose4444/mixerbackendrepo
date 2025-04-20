// mixer_backend.js
const http = require('http');
const { mixSubstances, substances: substanceData } = require('@schedule1-tools/mixer');

// --- Data & Helpers ---
// Get available ingredient names (same logic as advanced_mixer.js)
const ALL_INGREDIENTS = Object.keys(substanceData || {}).filter(name => substanceData[name]?.category === 'Ingredients').sort();
if (ALL_INGREDIENTS.length === 0) {
    console.warn("Backend: Could not reliably get ingredient list from package, using manual list.");
    ALL_INGREDIENTS.push('Addy', 'Banana', 'Battery', 'Chili', 'Cuke', 'Donut', 'Energy Drink', 'Flu Medicine', 'Gasoline', 'Horse Semen', 'Iodine', 'Mega Bean', 'Motor Oil', 'Mouth Wash', 'Paracetamol', 'Viagra');
    ALL_INGREDIENTS.sort();
}

// Combinatorics functions (same as before)
function getCombinationsWithRepetition(pool, k) { /* ... same implementation ... */
    const combinations = []; const n = pool.length; if (k === 0) return [[]]; if (n === 0) return []; function generate(startIndex, currentCombination) { if (currentCombination.length === k) { combinations.push([...currentCombination]); return; } for (let i = startIndex; i < n; i++) { currentCombination.push(pool[i]); generate(i, currentCombination); currentCombination.pop(); } } generate(0, []); return combinations;
}
function getPermutationsOfMultiset(arr) { /* ... same implementation ... */
    const permutations = new Set(); const n = arr.length; const counts = {}; arr.forEach(item => counts[item] = (counts[item] || 0) + 1); function generate(currentPermutation) { if (currentPermutation.length === n) { permutations.add(currentPermutation.join(',')); return; } for (const item in counts) { if (counts[item] > 0) { counts[item]--; currentPermutation.push(item); generate(currentPermutation); currentPermutation.pop(); counts[item]++; } } } generate([]); return Array.from(permutations).map(pStr => pStr.split(','));
}

// --- Calculation Function (Server-Side) ---
function performCalculation(productType, maxK, selectedSubstances) {
    console.log(`\nReceived request: Product=${productType}, MaxK=${maxK}, Selected=${selectedSubstances.length > 0 ? selectedSubstances.join(',') : 'None'}`);
    const startTime = Date.now();

    let substancePool;
    let modeDescription;

    if (selectedSubstances && selectedSubstances.length > 0) {
        // Filter selected substances to ensure they are valid ingredients
        substancePool = selectedSubstances.filter(s => ALL_INGREDIENTS.includes(s));
         if (substancePool.length !== selectedSubstances.length) {
             console.warn("Some selected substances were not recognized as valid ingredients.");
         }
         if (substancePool.length === 0) {
              throw new Error("No valid specific ingredients provided in selection.");
         }
        modeDescription = `Using only selected ingredients: ${substancePool.join(', ')}`;
    } else {
        substancePool = ALL_INGREDIENTS;
        modeDescription = `Using all ${ALL_INGREDIENTS.length} available ingredients.`;
    }

    console.log(`Calculating... Pool size: ${substancePool.length}, Max added K: ${maxK}`);

    let bestResult = { order: [], profit: -Infinity, price: 0, cost: 0, effects: [] };
    let calculationsCount = 0;

     // Calculate base result (0 added ingredients)
    try {
        const baseMix = mixSubstances(productType, []);
        bestResult = { order: [], ...baseMix, profit: (baseMix.sellPrice || 0) - (baseMix.cost || 0) };
    } catch(e) {
         console.error(`Error calculating base product: ${e.message}`);
         // Keep initial bestResult with -Infinity profit
    }

    // Iterate through combination sizes
    for (let k = 1; k <= maxK; k++) {
        console.log(` Checking combinations of size ${k}...`);
        const combinations = getCombinationsWithRepetition(substancePool, k);
        console.log(`  Found ${combinations.length} combinations. Processing permutations...`);

        let k_perms = 0;
        combinations.forEach((combination) => {
            const permutations = getPermutationsOfMultiset(combination);
            permutations.forEach(permutation => {
                calculationsCount++;
                k_perms++;
                try {
                    const result = mixSubstances(productType, permutation);
                    const profit = (result.sellPrice || 0) - (result.cost || 0);
                    if (profit > bestResult.profit) {
                        bestResult = { order: permutation, price: result.sellPrice || 0, cost: result.cost || 0, profit: profit, effects: result.effects || [] };
                    }
                } catch (error) { /* Ignore errors for single permutations? Or log? */ }
                if (k_perms % 100000 === 0) console.log(`   ...checked ${k_perms} permutations for size ${k}`); // Progress update
            });
        });
        console.log(`  Done size ${k} (${k_perms} permutations).`);
    }

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`Calculation complete. Time: ${durationSeconds}s. Total Permutations: ${calculationsCount}`);

    return {
        bestResult: bestResult.profit > -Infinity ? bestResult : null, // Return null if no profitable mix found
        calculationsCount,
        durationSeconds,
        modeDescription,
        productType,
        requestedMaxK: maxK
    };
}

// --- HTTP Server ---
const server = http.createServer((req, res) => {
    // Set CORS headers to allow requests from file:// or other origins
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow any origin
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request for CORS
    if (req.method === 'OPTIONS') {
        res.writeHead(204); // No Content
        res.end();
        return;
    }

    // Handle POST requests to /calculate
    if (req.method === 'POST' && req.url === '/calculate') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString(); // Convert Buffer to string
        });
        req.on('end', () => {
            try {
                const { productType, maxK, selectedSubstances } = JSON.parse(body);

                // Basic validation
                if (!productType || !maxK || maxK < 1 || maxK > 8 || !Array.isArray(selectedSubstances)) {
                     throw new Error("Invalid input data received.");
                }

                // Perform calculation (can take a long time!)
                const resultData = performCalculation(productType, maxK, selectedSubstances);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resultData));

            } catch (error) {
                console.error("Error processing request:", error);
                res.writeHead(400, { 'Content-Type': 'application/json' }); // Bad Request
                res.end(JSON.stringify({ error: error.message || "Failed to process calculation request." }));
            }
        });
    } else {
        // Handle other requests (e.g., GET) or invalid endpoints
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    }
});

const PORT = 3000; // Port the server will listen on
server.listen(PORT, () => {
    console.log(`Mixer backend server running at http://localhost:${PORT}`);
    console.log("Waiting for requests from the frontend HTML page...");
    console.log(`Available ingredients for search: ${ALL_INGREDIENTS.join(', ')}`);
});

