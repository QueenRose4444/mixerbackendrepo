// mixer_backend.js
// Original logic using @schedule1-tools/mixer package for ingredient list (with fallback) and calculations.
// Adjusted to accept 'selectedIngredients' from the current frontend.

const http = require('http');
// Use 'substances' export from the package, naming it substanceData for clarity
const { mixSubstances, substances: substanceData } = require('@schedule1-tools/mixer');

// --- Data & Helpers ---
// Get available ingredient names from the package
let ALL_INGREDIENTS = [];
try {
    // Check if the imported data is valid
    if (substanceData && typeof substanceData === 'object') {
        ALL_INGREDIENTS = Object.keys(substanceData)
                               .filter(name => substanceData[name]?.category === 'Ingredients')
                               .sort(); // Sort alphabetically
    } else {
        // Throw an error if package data is invalid to trigger the fallback logic clearly
        throw new Error("Substance data from package is missing or not an object.");
    }

    if (ALL_INGREDIENTS.length === 0) {
        console.warn("Backend: Derived 0 ingredients from the package. Check package data or filter logic.");
        // Proceed to fallback if filtering resulted in empty list
    } else {
        console.log(`Backend: Successfully derived ${ALL_INGREDIENTS.length} ingredients from '@schedule1-tools/mixer' package.`);
    }

} catch (error) {
    // Catch errors during package loading/processing
    console.error("Backend: Error getting ingredients from '@schedule1-tools/mixer':", error.message);
    console.warn("Backend: Using hardcoded fallback ingredient list.");
    // Hardcoded fallback list (from original script)
    ALL_INGREDIENTS = [
        'Addy', 'Banana', 'Battery', 'Chili', 'Cuke', 'Donut', 'Energy Drink',
        'Flu Medicine', 'Gasoline', 'Horse Semen', 'Iodine', 'Mega Bean',
        'Motor Oil', 'Mouth Wash', 'Paracetamol', 'Viagra'
    ].sort();
}


// --- Helper Functions (Combinatorics - unchanged from original) ---
function getCombinationsWithRepetition(pool, k) {
    const combinations = []; const n = pool.length; if (k === 0) return [[]]; if (n === 0) return []; function generate(startIndex, currentCombination) { if (currentCombination.length === k) { combinations.push([...currentCombination]); return; } for (let i = startIndex; i < n; i++) { currentCombination.push(pool[i]); generate(i, currentCombination); currentCombination.pop(); } } generate(0, []); return combinations;
}
function getPermutationsOfMultiset(arr) {
    const permutations = new Set(); const n = arr.length; const counts = {}; arr.forEach(item => counts[item] = (counts[item] || 0) + 1); function generate(currentPermutation) { if (currentPermutation.length === n) { permutations.add(currentPermutation.join(',')); return; } for (const item in counts) { if (counts[item] > 0) { counts[item]--; currentPermutation.push(item); generate(currentPermutation); currentPermutation.pop(); counts[item]++; } } } generate([]); return Array.from(permutations).map(pStr => pStr.split(','));
}


// --- Calculation Function (Server-Side - original logic, adjusted param name) ---
// Takes 'selectedIngredients' to match frontend request
function performCalculation(productType, maxK, selectedIngredients) {
    // Log uses the adjusted parameter name
    console.log(`\nReceived request: Product=${productType}, MaxK=${maxK}, Selected=${selectedIngredients.length > 0 ? selectedIngredients.join(',') : 'None'}`);
    const startTime = Date.now();

    let ingredientPool; // Use a consistent internal name
    let modeDescription;

    // Use selected ingredients if provided and valid, otherwise use ALL ingredients
    if (selectedIngredients && selectedIngredients.length > 0) {
        // Validate selected ingredients against the master list
        ingredientPool = selectedIngredients.filter(s => ALL_INGREDIENTS.includes(s));
         if (ingredientPool.length !== selectedIngredients.length) {
             // Log which ones were invalid if needed, but keep it simple for now
             console.warn("Some selected ingredients were not found in the master list and were ignored.");
         }
         // Proceed only if at least one valid ingredient was selected
         if (ingredientPool.length === 0) {
              console.error("Error: No valid specific ingredients provided in selection (checked against master list).");
              throw new Error("No valid specific ingredients provided in selection.");
         }
        modeDescription = `Using only selected ingredients: ${ingredientPool.join(', ')}`;
    } else {
        // Use the full list (from package or fallback) if no specific ones are selected
        if (ALL_INGREDIENTS.length === 0) {
             // Should only happen if fallback also fails, which is unlikely here
             console.error("Error: Cannot perform calculation with all ingredients because the master list is empty.");
             throw new Error("Ingredient master list is empty, cannot search all.");
        }
        ingredientPool = ALL_INGREDIENTS;
        modeDescription = `Using all ${ALL_INGREDIENTS.length} available ingredients.`;
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

    // Iterate through combination sizes (Original logic)
    for (let k = 1; k <= maxK; k++) {
        const combinations = getCombinationsWithRepetition(ingredientPool, k);
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
                // Original script didn't have verbose logging here, keeping it cleaner
            });
        });
         if (k_perms > 0) { // Log summary for the size k
             console.log(`  Checked ${k_perms.toLocaleString()} permutations for size ${k}.`);
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

// --- HTTP Server (Original logic, adjusted param name) ---
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
                // Expect 'selectedIngredients' from the frontend now
                const { productType, maxK, selectedIngredients } = JSON.parse(body);

                // Basic validation (using adjusted name)
                if (!productType || typeof maxK !== 'number' || maxK < 1 || maxK > 8 || !Array.isArray(selectedIngredients)) {
                     throw new Error("Invalid or missing input data received (productType, maxK, selectedIngredients).");
                }

                // Perform calculation (passing adjusted name)
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
    console.log(`Backend ready, using ${ALL_INGREDIENTS.length} ingredients (derived from package or fallback).`);
});
