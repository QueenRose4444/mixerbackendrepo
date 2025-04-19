// mixer_backend_unified.js - Backend using Express and @schedule1-tools/mixer

const express = require('express');
const cors = require('cors');
const { mixSubstances, encodeMixState, substances: substanceData } = require('@schedule1-tools/mixer');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Data & Helpers ---
const ALL_INGREDIENTS = Object.keys(substanceData || {}).filter(name => substanceData[name]?.category === 'Ingredients').sort();
if (ALL_INGREDIENTS.length === 0) {
    console.warn("Backend: Could not reliably get ingredient list from package, using manual list.");
    ALL_INGREDIENTS.push('Addy', 'Banana', 'Battery', 'Chili', 'Cuke', 'Donut', 'Energy Drink', 'Flu Medicine', 'Gasoline', 'Horse Semen', 'Iodine', 'Mega Bean', 'Motor Oil', 'Mouth Wash', 'Paracetamol', 'Viagra');
    ALL_INGREDIENTS.sort();
}

// --- Middleware ---
const corsOptions = {
  // Allow requests from your specific frontend domain(s)
  origin: ['https://rosiesite.rosestuffs.org', 'http://localhost', 'http://127.0.0.1'], // Add others if needed (e.g., local dev)
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: "Content-Type, Authorization",
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests
app.use(express.json()); // Built-in JSON body parser

// --- Combinatorics (for Optimizer) ---
function getCombinationsWithRepetition(pool, k) { /* ... Same implementation ... */
    const combinations = []; const n = pool.length; if (k === 0) return [[]]; if (n === 0) return []; function generate(startIndex, currentCombination) { if (currentCombination.length === k) { combinations.push([...currentCombination]); return; } for (let i = startIndex; i < n; i++) { currentCombination.push(pool[i]); generate(i, currentCombination); currentCombination.pop(); } } generate(0, []); return combinations;
}
function getPermutationsOfMultiset(arr) { /* ... Same implementation ... */
    const permutations = new Set(); const n = arr.length; const counts = {}; arr.forEach(item => counts[item] = (counts[item] || 0) + 1); function generate(currentPermutation) { if (currentPermutation.length === n) { permutations.add(currentPermutation.join(',')); return; } for (const item in counts) { if (counts[item] > 0) { counts[item]--; currentPermutation.push(item); generate(currentPermutation); currentPermutation.pop(); counts[item]++; } } } generate([]); return Array.from(permutations).map(pStr => pStr.split(','));
}

// --- API Routes ---

// Endpoint for Sequential Mixer (Calculate stats & hash for a given mix)
app.post('/api/mix/calculate', (req, res) => {
    const { product, ingredients } = req.body;

    // Basic validation
    if (!product || !Array.isArray(ingredients)) {
        return res.status(400).json({ error: 'Invalid input: product and ingredients array required.' });
    }
    // Further validation could check if product/ingredients are known

    console.log(`Calculating mix: ${product} with [${ingredients.join(', ')}]`);

    try {
        const stats = mixSubstances(product, ingredients); // Calculate stats
        const hash = encodeMixState({ product, substances: ingredients }); // Generate hash

        res.json({ stats, hash });

    } catch (error) {
        console.error("Error during mix calculation:", error);
        res.status(500).json({ error: error.message || 'Failed to calculate mix.' });
    }
});

// Endpoint for Optimizer (Find best mix based on criteria)
app.post('/api/mix/optimize', (req, res) => {
    const { product, maxK, selectedIngredients } = req.body;

    // Validation
    if (!product || !maxK || maxK < 1 || maxK > 8 || !Array.isArray(selectedIngredients)) { // Keep maxK limit reasonable for server
        return res.status(400).json({ error: 'Invalid input: product, maxK (1-8), and selectedIngredients array required.' });
    }

    let substancePool;
    let modeDescription;
    const startTime = Date.now();

    if (selectedIngredients.length > 0) {
        substancePool = selectedIngredients.filter(s => ALL_INGREDIENTS.includes(s));
        if (substancePool.length === 0) return res.status(400).json({ error: "No valid specific ingredients provided." });
        modeDescription = `Using only selected ingredients: ${substancePool.join(', ')}`;
    } else {
        substancePool = ALL_INGREDIENTS;
        modeDescription = `Using all ${ALL_INGREDIENTS.length} available ingredients.`;
    }

    console.log(`Optimizing mix: ${product}, MaxK=${maxK}, Pool Size=${substancePool.length}`);
    if (maxK > 5 && substancePool.length > 10) { // Add warning for potentially very long calculations
         console.warn(`High K (${maxK}) and large pool size (${substancePool.length}) requested. This may take significant time.`);
    }


    let bestResult = { order: [], profit: -Infinity, stats: null };
    let calculationsCount = 0;

    try {
        // Calculate base result (0 added ingredients)
        const baseStats = mixSubstances(product, []);
        const baseProfit = (baseStats.sellPrice || 0) - (baseStats.cost || 0);
        bestResult = { order: [], profit: baseProfit, stats: baseStats };

        // Iterate through combination sizes
        for (let k = 1; k <= maxK; k++) {
            console.log(` Optimizer: Checking combinations of size ${k}...`);
            const combinations = getCombinationsWithRepetition(substancePool, k);
            let k_perms = 0;

            combinations.forEach((combination) => {
                const permutations = getPermutationsOfMultiset(combination);
                permutations.forEach(permutation => {
                    calculationsCount++;
                    k_perms++;
                    try {
                        const currentStats = mixSubstances(product, permutation);
                        const currentProfit = (currentStats.sellPrice || 0) - (currentStats.cost || 0);

                        if (currentProfit > bestResult.profit) {
                            bestResult = {
                                order: permutation,
                                profit: currentProfit, // Store profit for comparison
                                stats: currentStats    // Store full stats object
                            };
                        }
                    } catch (permError) { /* Ignore errors for single permutations */ }
                });
            });
             console.log(` Optimizer: Done size ${k} (${k_perms} permutations). Best profit so far: $${bestResult.profit}`);
        }

        const endTime = Date.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

        console.log(`Optimization complete. Time: ${durationSeconds}s. Total Permutations: ${calculationsCount}`);

        res.json({
            bestResult: bestResult.stats ? bestResult : null, // Return null if only base was calculated and had error
            calculationsCount,
            durationSeconds,
            modeDescription,
            product,
            requestedMaxK: maxK
        });

    } catch (error) {
        console.error("Error during optimization:", error);
        res.status(500).json({ error: error.message || 'Failed to optimize mix.' });
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Unified Mixer backend server running on port ${PORT}`);
    console.log(`Allowing requests from origin(s): ${corsOptions.origin}`);
    console.log(`Available ingredients for search: ${ALL_INGREDIENTS.join(', ')}`);
});

// Optional: Graceful shutdown
process.on('SIGINT', () => {
    console.log("INFO: Received SIGINT. Shutting down server...");
    process.exit(0);
});
