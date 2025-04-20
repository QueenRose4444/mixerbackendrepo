// mixer_backend.js
// Uses @schedule1-tools/mixer package for ingredient list and calculations.

const http = require('http');
// No longer need 'fs' or 'path'
const { mixSubstances, substances: substanceDataFromPackage } = require('@schedule1-tools/mixer');

// --- Data Loading ---
// Derive the list of all available ingredients directly from the imported package data.
let ALL_INGREDIENTS = [];
try {
    // Check if the imported data is valid
    if (substanceDataFromPackage && typeof substanceDataFromPackage === 'object') {
        // Filter the keys of the substance data object to get only items categorized as 'Ingredients'
        ALL_INGREDIENTS = Object.keys(substanceDataFromPackage)
                               .filter(name => substanceDataFromPackage[name]?.category === 'Ingredients')
                               .sort(); // Sort alphabetically

        if (ALL_INGREDIENTS.length > 0) {
             console.log(`Backend: Successfully derived ${ALL_INGREDIENTS.length} ingredients from '@schedule1-tools/mixer' package.`);
        } else {
             // This might happen if the package data structure changes or is empty
             console.warn("Backend: WARNING - Derived 0 ingredients from the '@schedule1-tools/mixer' package. Check the package data or the filtering logic.");
        }
    } else {
         // This indicates a problem with the package import itself
         throw new Error("Substance data from '@schedule1-tools/mixer' package is missing or not an object.");
    }
} catch (error) {
    console.error("Backend: FATAL ERROR getting ingredients from '@schedule1-tools/mixer':", error);
    console.error("Backend calculations may fail. Ensure the package is installed correctly and provides valid data.");
    // Keep ALL_INGREDIENTS empty; calculations involving 'all ingredients' will likely fail.
}


// --- Helper Functions (Combinatorics - unchanged) ---
function getCombinationsWithRepetition(pool, k) {
    const combinations = []; const n = pool.length; if (k === 0) return [[]]; if (n === 0) return []; function generate(startIndex, currentCombination) { if (currentCombination.length === k) { combinations.push([...currentCombination]); return; } for (let i = startIndex; i < n; i++) { currentCombination.push(pool[i]); generate(i, currentCombination); currentCombination.pop(); } } generate(0, []); return combinations;
}
function getPermutationsOfMultiset(arr) {
    const permutations = new Set(); const n = arr.length; const counts = {}; arr.forEach(item => counts[item] = (counts[item] || 0) + 1); function generate(currentPermutation) { if (currentPermutation.length === n) { permutations.add(currentPermutation.join(',')); return; } for (const item in counts) { if (counts[item] > 0) { counts[item]--; currentPermutation.push(item); generate(currentPermutation); currentPermutation.pop(); counts[item]++; } } } generate([]); return Array.from(permutations).map(pStr => pStr.split(','));
}


// --- Calculation Function (Server-Side - largely unchanged) ---
function performCalculation(productType, maxK, selectedIngredients) {
    console.log(`\nReceived request: Product=${productType}, MaxK=${maxK}, Selected=${selectedIngredients.length > 0 ? selectedIngredients.join(',') : 'None'}`);
    const startTime = Date.now();

    let ingredientPool;
    let modeDescription;

    // Use selected ingredients if provided and valid, otherwise use ALL ingredients from the package
    if (selectedIngredients && selectedIngredients.length > 0) {
        // IMPORTANT: Validate selected ingredients against the list derived from the package
        ingredientPool = selectedIngredients.filter(s => ALL_INGREDIENTS.includes(s));
         if (ingredientPool.length !== selectedIngredients.length) {
             console.warn("Some selected ingredients were not found in the list derived from the package.");
         }
         // Proceed only if at least one valid ingredient was selected
         if (ingredientPool.length === 0) {
              console.error("Error: No valid specific ingredients provided in selection (checked against package list).");
              throw new Error("No valid specific ingredients provided in selection.");
         }
        modeDescription = `Using only selected ingredients: ${ingredientPool.join(', ')}`;
    } else {
        // Use the full list derived from the package if no specific ones are selected
        if (ALL_INGREDIENTS.length === 0) {
             console.error("Error: Cannot perform calculation with all ingredients because the list derived from the package is empty.");
             throw new Error("Ingredient list from package is empty, cannot search all.");
        }
        ingredientPool = ALL_INGREDIENTS;
        modeDescription = `Using all ${ALL_INGREDIENTS.length} available ingredients (from package).`;
    }

    console.log(`Calculating... Ingredient Pool size: ${ingredientPool.length}, Max added K: ${maxK}`);

    let bestResult = { order: [], profit: -Infinity, price: 0, cost: 0, effects: [] };
    let calculationsCount = 0;

     // Calculate base result (0 added ingredients)
    try {
        const baseMix = mixSubstances(productType, []);
        if (baseMix) {
             bestResult = { order: [], profit: (baseMix.sellPrice || 0) - (baseMix.cost || 0), price: baseMix.sellPrice || 0, cost: baseMix.cost || 0, effects: baseMix.effects || [] };
        } else {
             console.warn(`mixSubstances returned null/undefined for base product: ${productType}`);
        }
    } catch(e) {
         console.error(`Error calculating base product ${productType}: ${e.message}`);
    }

    // Iterate through combination sizes
    for (let k = 1; k <= maxK; k++) {
        // console.log(` Checking combinations of size ${k}...`); // Reduce logging verbosity
        const combinations = getCombinationsWithRepetition(ingredientPool, k);
        // console.log(`  Found ${combinations.length} combinations. Processing permutations...`); // Reduce logging verbosity

        let k_perms = 0;
        combinations.forEach((combination) => {
            const permutations = getPermutationsOfMultiset(combination);
            permutations.forEach(permutation => {
                calculationsCount++;
                k_perms++;
                try {
                    const result = mixSubstances(productType, permutation);
                    if (result) {
                        const profit = (result.sellPrice || 0) - (result.cost || 0);
                        if (profit > bestResult.profit) {
                            bestResult = { order: permutation, price: result.sellPrice || 0, cost: result.cost || 0, profit: profit, effects: result.effects || [] };
                        }
                    }
                } catch (error) { /* Ignore errors for single permutations */ }
            });
        });
         // Log progress less frequently
        if (k_perms > 0) {
             console.log(`  Done size ${k} (${k_perms.toLocaleString()} permutations). Total checked: ${calculationsCount.toLocaleString()}`);
        }
    }

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`Calculation complete. Time: ${durationSeconds}s. Total Permutations Checked: ${calculationsCount.toLocaleString()}`);

    return {
        bestResult: bestResult.profit > -Infinity ? bestResult : null,
        calculationsCount,
        durationSeconds,
        modeDescription,
        productType,
        requestedMaxK: maxK
    };
}

// --- HTTP Server (unchanged from previous version) ---
const server = http.createServer((req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Handle POST requests to /calculate
    if (req.method === 'POST' && req.url === '/calculate') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { productType, maxK, selectedIngredients } = JSON.parse(body);

                // Basic validation
                if (!productType || typeof maxK !== 'number' || maxK < 1 || maxK > 8 || !Array.isArray(selectedIngredients)) {
                     throw new Error("Invalid or missing input data received (productType, maxK, selectedIngredients).");
                }

                // Perform calculation
                const resultData = performCalculation(productType, maxK, selectedIngredients);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resultData));

            } catch (error) {
                console.error("Error processing request:", error);
                res.writeHead(400, { 'Content-Type': 'application/json' }); // Bad Request
                res.end(JSON.stringify({ error: error.message || "Failed to process calculation request." }));
            }
        });
    } else {
        // Handle other requests
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found. Use POST /calculate' }));
    }
});

const PORT = 3000; // Port the server will listen on
server.listen(PORT, () => {
    console.log(`Mixer backend server running at http://localhost:${PORT}`);
    console.log("Waiting for requests from the frontend HTML page...");
    if (ALL_INGREDIENTS.length > 0) {
        console.log(`Backend ready, using ${ALL_INGREDIENTS.length} ingredients derived from the '@schedule1-tools/mixer' package.`);
    } else {
        console.error("Backend started BUT FAILED TO DERIVE INGREDIENTS FROM PACKAGE. Calculations involving 'all ingredients' will fail.");
    }
});
