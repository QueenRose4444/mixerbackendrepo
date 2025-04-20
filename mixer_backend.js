// mixer_backend.js
const http = require('http');
// Import all necessary functions and data from the package
const {
    mixSubstances,
    encodeMixState, // Added for hashing
    // mixFromHash, // Not strictly needed on backend yet, but could be added
    // decodeMixState, // Not strictly needed on backend yet, but could be added
    products: productsData,     // Added for /data endpoint
    substances: substanceData   // Already used, needed for /data too
} = require('@schedule1-tools/mixer');

// --- Data & Helpers ---

// Extract only ingredient data for filtering and /data endpoint
const ALL_INGREDIENTS_DATA = Object.fromEntries(
    Object.entries(substanceData || {}).filter(([name, data]) => data?.category === 'Ingredients')
);
const ALL_INGREDIENTS_NAMES = Object.keys(ALL_INGREDIENTS_DATA).sort();

if (ALL_INGREDIENTS_NAMES.length === 0) {
    console.warn("Backend: Could not reliably get ingredient list from package. Check package installation/version.");
    // Consider stopping the server if data is critical and missing
}

// --- Calculation Function (for Max Profit) ---
// Renamed slightly to distinguish from single mix calculation
function findBestMix(productType, maxK, selectedSubstances) {
    console.log(`\nReceived Max Profit request: Product=${productType}, MaxK=${maxK}, Selected=${selectedSubstances.length > 0 ? selectedSubstances.join(',') : 'None'}`);
    const startTime = Date.now();

    let substancePool;
    let modeDescription;

    const validIngredientNames = ALL_INGREDIENTS_NAMES; // Use derived list

    if (selectedSubstances && selectedSubstances.length > 0) {
        substancePool = selectedSubstances.filter(s => validIngredientNames.includes(s));
         if (substancePool.length !== selectedSubstances.length) {
             console.warn("Some selected substances were not recognized as valid ingredients.");
         }
         if (substancePool.length === 0) {
              throw new Error("No valid specific ingredients provided in selection.");
         }
        modeDescription = `Using only selected ingredients: ${substancePool.join(', ')}`;
    } else {
        substancePool = validIngredientNames;
        modeDescription = `Using all ${validIngredientNames.length} available ingredients.`;
    }

    console.log(`Calculating Max Profit... Pool size: ${substancePool.length}, Max added K: ${maxK}`);

    let bestResult = { order: [], profit: -Infinity, price: 0, cost: 0, effects: [], addiction: 0 }; // Added addiction
    let calculationsCount = 0;

    // Calculate base result (0 added ingredients)
    try {
        const baseMix = mixSubstances(productType, []);
        // Ensure all expected fields exist, provide defaults
        bestResult = {
            order: [],
            price: baseMix.sellPrice || 0,
            cost: baseMix.cost || 0,
            profit: (baseMix.sellPrice || 0) - (baseMix.cost || 0),
            effects: baseMix.effects || [],
            addiction: baseMix.addiction || 0
        };
        calculationsCount++; // Count the base calculation
    } catch(e) {
         console.error(`Error calculating base product '${productType}': ${e.message}`);
         // Keep initial bestResult with -Infinity profit if base fails
    }

    // --- Combinatorics functions (defined inside where needed or globally) ---
    function getCombinationsWithRepetition(pool, k) {
        const combinations = []; const n = pool.length; if (k === 0) return [[]]; if (n === 0) return []; function generate(startIndex, currentCombination) { if (currentCombination.length === k) { combinations.push([...currentCombination]); return; } for (let i = startIndex; i < n; i++) { currentCombination.push(pool[i]); generate(i, currentCombination); currentCombination.pop(); } } generate(0, []); return combinations;
    }
    function getPermutationsOfMultiset(arr) {
        const permutations = new Set(); const n = arr.length; const counts = {}; arr.forEach(item => counts[item] = (counts[item] || 0) + 1); function generate(currentPermutation) { if (currentPermutation.length === n) { permutations.add(currentPermutation.join(',')); return; } for (const item in counts) { if (counts[item] > 0) { counts[item]--; currentPermutation.push(item); generate(currentPermutation); currentPermutation.pop(); counts[item]++; } } } generate([]); return Array.from(permutations).map(pStr => pStr.split(','));
    }
    // --- End Combinatorics ---


    // Iterate through combination sizes
    for (let k = 1; k <= maxK; k++) {
        console.log(` Checking combinations of size ${k}...`);
        const combinations = getCombinationsWithRepetition(substancePool, k);
        console.log(`  Found ${combinations.length} combinations for size ${k}. Processing permutations...`);

        let k_perms = 0;
        combinations.forEach((combination) => {
            const permutations = getPermutationsOfMultiset(combination);
            permutations.forEach(permutation => {
                calculationsCount++;
                k_perms++;
                try {
                    const result = mixSubstances(productType, permutation);
                    // Ensure values exist before calculating profit
                    const currentPrice = result.sellPrice || 0;
                    const currentCost = result.cost || 0;
                    const profit = currentPrice - currentCost;

                    if (profit > bestResult.profit) {
                        bestResult = {
                            order: permutation,
                            price: currentPrice,
                            cost: currentCost,
                            profit: profit,
                            effects: result.effects || [],
                            addiction: result.addiction || 0 // Include addiction
                        };
                    }
                } catch (error) {
                    // console.warn(`Skipping permutation due to error: ${error.message}`);
                    // Decide whether to log errors for individual permutations
                 }
                if (k_perms % 100000 === 0) console.log(`   ...checked ${k_perms.toLocaleString()} permutations for size ${k}`); // Progress update
            });
        });
        console.log(`  Done size ${k} (${k_perms.toLocaleString()} permutations). Best profit so far: $${bestResult.profit.toFixed(2)}`);
    }

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`Max Profit Calculation complete. Time: ${durationSeconds}s. Total Permutations: ${calculationsCount.toLocaleString()}`);

    return {
        bestResult: bestResult.profit > -Infinity ? bestResult : null, // Return null if only base product error occurred or no improvement
        calculationsCount,
        durationSeconds,
        modeDescription,
        productType,
        requestedMaxK: maxK
    };
}

// --- HTTP Server Logic ---
const server = http.createServer((req, res) => {
    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow any origin
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); // Allow GET for data
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        res.writeHead(204); // No Content
        res.end();
        return;
    }

    // --- Routing ---

    // GET /data - Endpoint to provide product and ingredient data
    if (req.method === 'GET' && req.url === '/data') {
        try {
            console.log("GET /data request received.");
            // Ensure data was loaded from the package
            if (!productsData || !ALL_INGREDIENTS_DATA) {
                 throw new Error("Server error: Product or Substance data not loaded.");
            }
            const responseData = {
                products: productsData,
                substances: ALL_INGREDIENTS_DATA // Send only ingredient data
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(responseData));
            console.log("GET /data responded successfully.");
        } catch (error) {
             console.error("Error processing GET /data request:", error);
             res.writeHead(500, { 'Content-Type': 'application/json' }); // Internal Server Error
             res.end(JSON.stringify({ error: error.message || "Failed to retrieve data." }));
        }
    }
    // POST /calculate - Endpoint for Max Profit Finder
    else if (req.method === 'POST' && req.url === '/calculate') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                console.log("POST /calculate request received.");
                const { productType, maxK, selectedSubstances } = JSON.parse(body);

                // Basic validation
                if (!productType || !maxK || maxK < 0 || maxK > 8 || !Array.isArray(selectedSubstances)) { // Allow maxK=0? No, frontend handles base.
                     throw new Error("Invalid input data received for /calculate.");
                }

                const resultData = findBestMix(productType, maxK, selectedSubstances);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resultData));
                console.log("POST /calculate responded successfully.");

            } catch (error) {
                console.error("Error processing POST /calculate request:", error);
                res.writeHead(400, { 'Content-Type': 'application/json' }); // Bad Request
                res.end(JSON.stringify({ error: error.message || "Failed to process max profit calculation request." }));
            }
        });
    }
    // POST /calculate-single - Endpoint for Interactive Mixing Calculator
    else if (req.method === 'POST' && req.url === '/calculate-single') {
         let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                console.log("POST /calculate-single request received.");
                const { product, substances } = JSON.parse(body);

                // Basic validation
                if (!product || !Array.isArray(substances)) {
                     throw new Error("Invalid input data received for /calculate-single. Expected 'product' and 'substances' array.");
                }
                // Optional: Validate product name and substance names against loaded data
                if (!productsData[product]) {
                    throw new Error(`Invalid product name: ${product}`);
                }
                substances.forEach(sub => {
                    if (!ALL_INGREDIENTS_DATA[sub]) {
                         throw new Error(`Invalid substance name in mix: ${sub}`);
                    }
                });

                // Perform single mix calculation using the imported function
                const result = mixSubstances(product, substances);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result)); // Send back the direct result
                console.log("POST /calculate-single responded successfully.");

            } catch (error) {
                console.error("Error processing POST /calculate-single request:", error);
                res.writeHead(400, { 'Content-Type': 'application/json' }); // Bad Request
                res.end(JSON.stringify({ error: error.message || "Failed to process single mix calculation request." }));
            }
        });
    }
     // POST /encode - Endpoint to get hash for a mix
    else if (req.method === 'POST' && req.url === '/encode') {
         let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                console.log("POST /encode request received.");
                const { product, substances } = JSON.parse(body);

                // Basic validation
                if (!product || !Array.isArray(substances)) {
                     throw new Error("Invalid input data received for /encode. Expected 'product' and 'substances' array.");
                }
                 // Optional: Validate product name and substance names

                // Encode the state
                const hash = encodeMixState({ product, substances });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ hash: hash })); // Send back the hash
                console.log("POST /encode responded successfully.");

            } catch (error) {
                console.error("Error processing POST /encode request:", error);
                res.writeHead(400, { 'Content-Type': 'application/json' }); // Bad Request
                res.end(JSON.stringify({ error: error.message || "Failed to encode mix state." }));
            }
        });
    }
    // Handle Not Found
    else {
        console.log(`Received unhandled request: ${req.method} ${req.url}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000; // Use environment variable or default to 3000
server.listen(PORT, '0.0.0.0', () => { // Listen on all interfaces for Docker
    console.log(`Mixer backend server running on port ${PORT}`);
    console.log("Waiting for requests...");
    console.log(`Loaded ${Object.keys(productsData || {}).length} products.`);
    console.log(`Loaded ${ALL_INGREDIENTS_NAMES.length} ingredients: ${ALL_INGREDIENTS_NAMES.join(', ')}`);
});

// Optional: Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});
