function initializeDashboard() {
    console.log("initializeDashboard() called."); // Log start of initialization

    // --- Element Selection with Checks ---
    const stockTableBody = document.getElementById('stock-table-body');
    if (!stockTableBody) console.error("Element with ID 'stock-table-body' not found!");

    const refreshButton = document.getElementById('refresh-btn');
    if (!refreshButton) console.error("Element with ID 'refresh-btn' not found!");

    const lastUpdatedElement = document.getElementById('last-updated');
    if (!lastUpdatedElement) console.error("Element with ID 'last-updated' not found!");

    const drawdownPeriodSelect = document.getElementById('drawdown-period');
    if (!drawdownPeriodSelect) console.error("Element with ID 'drawdown-period' not found!");

    const changePeriodSelect = document.getElementById('change-period');
    if (!changePeriodSelect) console.error("Element with ID 'change-period' not found!");

    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) console.error("Element with ID 'theme-toggle' not found!");

    const popupChartContainer = document.getElementById('popup-chart-container');
    if (!popupChartContainer) console.error("Element with ID 'popup-chart-container' not found!");

    const chartCanvas = document.getElementById('relative-perf-chart');
    if (!chartCanvas) console.error("Element with ID 'relative-perf-chart' not found!");

    const refreshSpinner = document.getElementById('refresh-spinner'); // Added spinner selector
    if (!refreshSpinner) console.error("Element with ID 'refresh-spinner' not found!");

    const chartOverlayTextElement = document.getElementById('chart-overlay-text'); // Get overlay element
     if (!chartOverlayTextElement) console.error("Element with ID 'chart-overlay-text' not found!");


    console.log("Element selections complete (or errors logged).");

    // --- State Variables ---
    let updateInterval;
    let currentMarketData = {}; // Store market data separately
    let currentAssetData = []; // Store asset data for sorting
    let sortColumn = 'type'; // Initial sort column for assets
    let sortDirection = 'asc'; // Initial sort direction
    let popupChartInstance = null; // To hold the Chart.js instance (for Perf, RSI, EMA, or Drawdown)
    let spyHistoryData = null; // To store SPY's 1y history globally
    let isInitialLoad = true; // Flag to track initial load vs refresh

    // --- Configuration ---
    const API_ENDPOINT = '/api/dashboard-data'; // Ensure endpoint is correct
    const REFRESH_INTERVAL_MS = 60 * 1000; // 60 seconds
    const marketSymbolsList = ['SPY', '^DJI', '^GSPC', '^VIX']; // Define market symbols
    const LOCAL_STORAGE_KEY = 'stockDashboardData';

    // --- Functions ---

    // Updated showLoading to only handle spinner and body class
    function showLoading(isLoading, isRefreshing = false) {
        // Ensure spinner element exists
        if (!refreshSpinner) {
            console.error("showLoading: refreshSpinner element not found!");
            return;
        }

        if (isLoading) {
            // Show spinner and potentially the page border animation
            refreshSpinner.style.display = 'inline-block';
            if (isRefreshing) {
                document.body.classList.add('page-refreshing');
            } else {
                // Ensure page border animation is off during initial load
                document.body.classList.remove('page-refreshing');
            }
        } else {
            // Hide spinner and page border animation
            refreshSpinner.style.display = 'none';
            document.body.classList.remove('page-refreshing');
        }
    } // End of showLoading function

    function formatNumber(num, decimals = 2) {
        if (num === null || num === undefined || isNaN(num)) {
            return 'N/A';
        }
        return parseFloat(num).toFixed(decimals);
    }

    // --- Sparkline Function ---
    function createSparkline(data, width = 80, height = 20, stroke = 'var(--text-color)', strokeWidth = 1.5) {
        if (!data || data.length < 2) {
            return document.createTextNode('N/A'); // Not enough data
        }

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.overflow = 'visible'; // Prevent clipping stroke

        const maxVal = Math.max(...data);
        const minVal = Math.min(...data);
        const range = maxVal - minVal || 1; // Avoid division by zero if all values are the same

        const points = data.map((d, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - ((d - minVal) / range) * height;
            // Add slight vertical padding to prevent touching edges
            const paddedY = Math.max(strokeWidth, Math.min(height - strokeWidth, y));
            return `${x},${paddedY}`;
        }).join(' ');

        const polyline = document.createElementNS(svgNS, "polyline");
        polyline.setAttribute('points', points);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', stroke);
        polyline.setAttribute('stroke-width', strokeWidth);
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('stroke-linecap', 'round');

        svg.appendChild(polyline);
        return svg;
    }

    // Helper function to render a single row
    function renderRow(stock) {
        const row = document.createElement('tr');
        row.setAttribute('data-symbol', stock.name);

        // Define cell content based on available data
        row.innerHTML = `
            <td class="symbol">${stock.display_name || stock.name}</td>
            <td class="type"></td> <!-- Type content set dynamically below -->
            <td class="price"></td>
            <td class="change"></td>
            <td class="sparkline-cell"></td> <!-- Added Sparkline Cell -->
            <td class="rsi"></td>
            <td class="rsi-status"></td> <!-- Added RSI Status cell -->
            <td class="ema13"></td>
            <td class="ema21"></td>
            <td class="signal"></td>
            <td class="buy-duration-short"></td>
            <td class="ema100"></td>
            <td class="ema200"></td>
            <td class="signal-long"></td>
            <td class="last-buy-date-long"></td>
            <td class="drawdown"></td>
            <!-- Removed last-update-time cell -->
        `;
        // Check if stockTableBody exists before appending
        if (stockTableBody) {
            stockTableBody.appendChild(row); // Append row to the table body
        } else {
            console.error("renderRow: stockTableBody is null, cannot append row.");
            return; // Exit if table body doesn't exist
        }


        // Select cells
        const typeCell = row.querySelector('.type');

        // Set Type cell content conditionally
        if (marketSymbolsList.includes(stock.name)) {
            typeCell.textContent = ''; // Leave type blank for market symbols
        } else {
            typeCell.textContent = stock.type || 'N/A'; // Show type for assets
        }

        // Populate other cells (only if not an error row)
        if (!stock.error) {
            const priceCell = row.querySelector('.price');
            const changeCell = row.querySelector('.change');
            const sparklineCell = row.querySelector('.sparkline-cell'); // Select sparkline cell
            const rsiCell = row.querySelector('.rsi'); // Cell for RSI value
            const rsiStatusCell = row.querySelector('.rsi-status'); // Select the new cell
            const ema13Cell = row.querySelector('.ema13'); // Cell for EMA13 value
            const ema21Cell = row.querySelector('.ema21'); // Cell for EMA21 value
            const signalCell = row.querySelector('.signal');
            const buyDurationShortCell = row.querySelector('.buy-duration-short');
            const ema100Cell = row.querySelector('.ema100');
            const ema200Cell = row.querySelector('.ema200');
            const signalLongCell = row.querySelector('.signal-long');
            const lastBuyDateLongCell = row.querySelector('.last-buy-date-long');
            const drawdownCell = row.querySelector('.drawdown'); // Cell for Drawdown value

            // Populate cells (excluding typeCell, already done)
            priceCell.textContent = formatNumber(stock.latest_price);
            const changePct = formatNumber(stock.daily_change_pct);
            changeCell.textContent = `${changePct}%`;
            changeCell.className = `change ${stock.daily_change_pct >= 0 ? 'positive' : 'negative'}`;

            // Render Sparkline
            if (stock.sparkline_data && stock.sparkline_data.length > 1) {
                const sparklineSvg = createSparkline(stock.sparkline_data);
                sparklineCell.appendChild(sparklineSvg);
            } else {
                sparklineCell.textContent = 'N/A';
            }

            const rsiValue = stock.rsi14;
            rsiCell.textContent = formatNumber(rsiValue); // Display the RSI number first

            // Populate RSI Status cell
            rsiStatusCell.textContent = ''; // Default to empty
            rsiStatusCell.className = 'rsi-status'; // Reset class
            if (rsiValue !== null && rsiValue !== undefined && !isNaN(rsiValue)) {
                if (rsiValue < 30) {
                    rsiStatusCell.textContent = 'Oversold';
                    rsiStatusCell.classList.add('positive'); // Changed to positive (green)
                } else if (rsiValue > 70) {
                    rsiStatusCell.textContent = 'Overbought'; // Corrected text
                    rsiStatusCell.classList.add('negative'); // Changed to negative (red)
                }
            } else {
                 rsiStatusCell.textContent = 'N/A'; // Handle cases where RSI is not available
            }

            ema13Cell.textContent = formatNumber(stock.ema13);
            ema21Cell.textContent = formatNumber(stock.ema21);
            ema100Cell.textContent = formatNumber(stock.ema100);
            ema200Cell.textContent = formatNumber(stock.ema200);
            drawdownCell.textContent = `${formatNumber(stock.current_drawdown_pct)}%`;

            // Signals and Durations
            const signalShort = stock.ema_signal || 'Neutral';
            signalCell.textContent = signalShort;
            signalCell.className = `signal ${signalShort === 'Buy' ? 'positive' : (signalShort === 'Sell' ? 'negative' : '')}`;

            if (signalShort === 'Buy' && stock.ema_short_last_buy_date) {
                 try {
                     const lastBuyDate = new Date(stock.ema_short_last_buy_date);
                     const today = new Date();
                     const diffTime = Math.abs(today - lastBuyDate);
                     const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                     buyDurationShortCell.textContent = `${diffDays} days`;
                 } catch (e) {
                     console.error("Error parsing short last buy date:", stock.ema_short_last_buy_date, e);
                     buyDurationShortCell.textContent = 'Error';
                 }
             } else { buyDurationShortCell.textContent = ''; }

            const signalLong = stock.ema_long_signal || 'Neutral';
            signalLongCell.textContent = signalLong;
            signalLongCell.className = `signal-long ${signalLong === 'Buy' ? 'positive' : (signalLong === 'Sell' ? 'negative' : '')}`;

            if (signalLong === 'Buy' && stock.ema_long_last_buy_date) {
                try {
                    const lastBuyDate = new Date(stock.ema_long_last_buy_date);
                    const today = new Date();
                    const diffTime = Math.abs(today - lastBuyDate);
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    lastBuyDateLongCell.textContent = `${diffDays} days`;
                } catch (e) {
                    console.error("Error parsing long last buy date:", stock.ema_long_last_buy_date, e);
                    lastBuyDateLongCell.textContent = 'Error';
                }
            } else { lastBuyDateLongCell.textContent = ''; }

        } else {
            // Handle error display for the row
            row.querySelector('.price').textContent = 'Error';
            row.querySelector('.change').textContent = stock.error;
            row.querySelector('.change').className = 'change negative';
            // Clear other cells, including sparkline and the new rsi-status
            row.querySelectorAll('td:not(.symbol):not(.type):not(.change)').forEach(td => {
                td.textContent = 'N/A';
                // Reset specific classes to avoid lingering styles
                if (td.classList.contains('signal')) td.className = 'signal';
                if (td.classList.contains('signal-long')) td.className = 'signal-long';
                if (td.classList.contains('rsi-status')) td.className = 'rsi-status'; // Reset RSI status class
                if (td.classList.contains('sparkline-cell')) td.innerHTML = 'N/A'; // Clear sparkline cell content
            });
        }

        // --- Add Event Listeners for RSI Chart ---
        const rsiValueCell = row.querySelector('.rsi');
        if (rsiValueCell && !stock.error && !marketSymbolsList.includes(stock.name)) {
             // Pass the specific stock data to the listeners
            const currentStockData = stock;
            rsiValueCell.addEventListener('mouseover', (event) => {
                event.stopPropagation();
                showRsiChart(event, currentStockData);
            });
            rsiValueCell.addEventListener('mouseout', (event) => {
                event.stopPropagation();
                hidePopupChart();
            });
        }
        // --- End RSI Chart Listeners ---

        // --- Add Event Listeners for EMA Chart ---
        const ema13ValueCell = row.querySelector('.ema13');
        const ema21ValueCell = row.querySelector('.ema21');
        if ((ema13ValueCell || ema21ValueCell) && !stock.error && !marketSymbolsList.includes(stock.name)) {
            const currentStockData = stock; // Capture stock data for listeners

            const handleEmaMouseover = (event) => {
                event.stopPropagation(); // Prevent row hover
                showEmaChart(event, currentStockData);
            };
            const handleEmaMouseout = (event) => {
                event.stopPropagation();
                hidePopupChart();
            };

            if (ema13ValueCell) {
                ema13ValueCell.addEventListener('mouseover', handleEmaMouseover);
                ema13ValueCell.addEventListener('mouseout', handleEmaMouseout);
            }
            if (ema21ValueCell) {
                ema21ValueCell.addEventListener('mouseover', handleEmaMouseover);
                ema21ValueCell.addEventListener('mouseout', handleEmaMouseout);
            }
        }
        // --- End EMA Chart Listeners ---

        // --- Add Event Listeners for Relative Performance Chart (Symbol Cell) ---
        const symbolCell = row.querySelector('.symbol');
        if (symbolCell && !stock.error && !marketSymbolsList.includes(stock.name)) {
            const currentStockData = stock; // Capture stock data

            symbolCell.addEventListener('mouseover', (event) => {
                showRelativePerfChart(event, currentStockData);
            });
            symbolCell.addEventListener('mouseout', (event) => {
                hidePopupChart();
            });
        }
        // --- End Relative Performance Chart Listeners ---

        // --- Add Event Listeners for Drawdown Chart ---
        const drawdownValueCell = row.querySelector('.drawdown');
        if (drawdownValueCell && !stock.error && !marketSymbolsList.includes(stock.name)) {
            const currentStockData = stock; // Capture stock data
            drawdownValueCell.addEventListener('mouseover', (event) => {
                event.stopPropagation();
                showDrawdownChart(event, currentStockData);
            });
            drawdownValueCell.addEventListener('mouseout', (event) => {
                event.stopPropagation();
                hidePopupChart();
            });
        }
        // --- End Drawdown Chart Listeners ---
    }

    // Renders the entire table, including market and sorted asset data
    function renderTable() {
        console.log("renderTable() called"); // Log when renderTable starts
        if (!stockTableBody || !lastUpdatedElement) {
             console.error("renderTable: Required elements (stockTableBody or lastUpdatedElement) not found.");
             return;
        }
        const now = new Date();
        lastUpdatedElement.textContent = `Last Updated: ${now.toLocaleTimeString()}`;
        stockTableBody.innerHTML = ''; // Clear table body

        // --- Render Market Data (Static Top Section) ---
        const marketHeaderRow = document.createElement('tr');
        marketHeaderRow.classList.add('group-header', 'market-header');
        // Dynamically get column count (adjust fallback if needed)
        const colCount = document.querySelectorAll('#stock-table thead th').length;
        marketHeaderRow.innerHTML = `<td colspan="${colCount || 16}">Market Overview</td>`; // Adjusted fallback to 16
        stockTableBody.appendChild(marketHeaderRow);

        const marketOrder = ['SPY', '^DJI', '^GSPC', '^VIX'];
        marketOrder.forEach(symbol => {
            const stock = currentMarketData[symbol];
            if (stock) {
                 renderRow(stock);
            } else {
                 console.warn(`Market data missing for ${symbol}`);
                 const placeholderRow = document.createElement('tr');
                 // Adjust colspan for placeholder row as well
                 placeholderRow.innerHTML = `<td class="symbol">${symbol}</td><td colspan="${(colCount || 16) - 1}">Loading or unavailable...</td>`; // Adjusted fallback
                 stockTableBody.appendChild(placeholderRow);
            }
        });

        // --- Render Asset Data (Sortable Groups) ---
        const sortedAssetData = sortAssetData();
        let currentGroupType = null;

        sortedAssetData.forEach(stock => {
            const stockType = stock.type || 'Unknown';
            if (stockType !== currentGroupType) {
                currentGroupType = stockType;
                const groupHeaderRow = document.createElement('tr');
                groupHeaderRow.classList.add('group-header');
                // Use updated colCount for asset group headers
                groupHeaderRow.innerHTML = `<td colspan="${colCount || 16}">${currentGroupType}s</td>`; // Adjusted fallback to 16
                stockTableBody.appendChild(groupHeaderRow);
            }
            renderRow(stock);
        });

        updateSortIndicators();
        console.log("renderTable() finished"); // Log when renderTable ends
    }


    // --- Sorting Logic (Operates only on currentAssetData) ---
    function sortAssetData() {
        const typeOrder = { 'ETF': 1, 'Stock': 2, 'Crypto': 3 };
        // Ensure currentAssetData is always an array before sorting
        let sortedData = Array.isArray(currentAssetData) ? [...currentAssetData] : [];

        sortedData.sort((a, b) => {
            let valA, valB;

            if (sortColumn === 'type') {
                valA = typeOrder[a.type || 'Unknown'] || 99;
                valB = typeOrder[b.type || 'Unknown'] || 99;
            } else if (sortColumn === 'ema_signal') {
                const signalOrder = { 'Buy': 1, 'Sell': 3, 'Neutral': 2 };
                valA = signalOrder[a.ema_signal || 'Neutral'] || 2;
                valB = signalOrder[b.ema_signal || 'Neutral'] || 2;
            } else if (sortColumn === 'ema_short_buy_duration') {
                 const getDuration = (stock) => {
                     if (stock.ema_signal === 'Buy' && stock.ema_short_last_buy_date) {
                         try {
                             const lastBuyDate = new Date(stock.ema_short_last_buy_date);
                             const today = new Date();
                             const diffTime = Math.abs(today - lastBuyDate);
                             return Math.round(diffTime / (1000 * 60 * 60 * 24));
                         } catch { return -1; }
                     } return -1;
                 };
                 valA = getDuration(a);
                 valB = getDuration(b);
            } else if (sortColumn === 'ema_long_signal') {
                const signalOrder = { 'Buy': 1, 'Sell': 3, 'Neutral': 2 };
                valA = signalOrder[a.ema_long_signal || 'Neutral'] || 2;
                valB = signalOrder[b.ema_long_signal || 'Neutral'] || 2;
            } else if (sortColumn === 'name') {
                valA = a.display_name || a.name;
                valB = b.display_name || b.name;
            } else { // Other Numeric columns
                const key = sortColumn;
                valA = a[key] === null || a[key] === undefined ? -Infinity : parseFloat(a[key]);
                valB = b[key] === null || b[key] === undefined ? -Infinity : parseFloat(b[key]);
                 if (a.error) valA = -Infinity;
                 if (b.error) valB = -Infinity;
            }

             let comparison = 0;
             if (typeof valA === 'string' && typeof valB === 'string') {
                 comparison = valA.localeCompare(valB);
             } else {
                 if (valA < valB) comparison = -1;
                 else if (valA > valB) comparison = 1;
             }

             // Group by type first if not sorting by type
             if (sortColumn !== 'type') {
                 const typeA = a.type || 'Unknown';
                 const typeB = b.type || 'Unknown';
                 const orderA = typeOrder[typeA] || 99;
                 const orderB = typeOrder[typeB] || 99;
                 if (orderA !== orderB) return orderA - orderB;
             }

            // Secondary sort by name if primary values are equal
            if (comparison === 0) {
                 return (a.display_name || a.name).localeCompare(b.display_name || b.name);
            } else {
                 return sortDirection === 'asc' ? comparison : comparison * -1;
            }
        });
        return sortedData;
    }

    // --- Fetch Data (Only updates data variables) ---
    async function fetchDashboardData() {
        // Check required elements exist before fetching
        if (!drawdownPeriodSelect || !changePeriodSelect) {
             console.error("fetchDashboardData: Period select elements not found.");
             throw new Error("Missing period select elements.");
        }
        const selectedDrawdownPeriod = drawdownPeriodSelect.value;
        const selectedChangePeriod = changePeriodSelect.value; // Get selected change period
        console.log(`Fetching dashboard data with drawdown period: ${selectedDrawdownPeriod} and change period: ${selectedChangePeriod}...`);
        const apiUrl = `${API_ENDPOINT}?drawdown_period=${selectedDrawdownPeriod}&change_period=${selectedChangePeriod}`; // Add change_period to API URL

        const response = await fetch(apiUrl); // Let errors propagate
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const responseData = await response.json();
        console.log("Data received (first asset):", responseData?.asset_data ? Object.values(responseData.asset_data)[0] : 'No asset data'); // Log sample data

        currentMarketData = responseData.market_data || {};
        currentAssetData = Object.values(responseData.asset_data || {}).filter(stock => stock && stock.name);
        spyHistoryData = responseData.spy_1y_history || null; // Store SPY history

        saveDataToLocalStorage(); // Save after successful fetch
        // Removed renderTable() call
    }

    // --- Fetch and Render Data ---
    async function fetchAndRenderData() {
        const isRefreshing = !isInitialLoad; // It's a refresh if not the initial load
        console.log(`fetchAndRenderData called. isInitialLoad: ${isInitialLoad}, isRefreshing: ${isRefreshing}`);
        showLoading(true, isRefreshing); // Show loading indicators

        const minDisplayTime = 500; // Minimum time in ms to show loading animation
        const startTime = Date.now();

        try {
            // Fetch data and render table
            await fetchDashboardData();
            renderTable();
            isInitialLoad = false; // Mark initial load complete *after* success

            // Calculate remaining time needed to meet minDisplayTime
            const elapsedTime = Date.now() - startTime;
            const remainingTime = minDisplayTime - elapsedTime;

            // Wait for the remaining time if the fetch was too fast
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
            }

        } catch (error) {
            console.error("Error fetching or rendering dashboard data:", error);
            if (lastUpdatedElement) lastUpdatedElement.textContent = `Update Error: ${error.message}`;
            // Don't clear data on error if refreshing, keep showing stale data
            if (isInitialLoad) {
                // Clear data only if it's the initial load and it failed
                currentMarketData = {};
                currentAssetData = [];
                spyHistoryData = null;
                localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear storage on initial load error
                renderTable(); // Render empty state
            }
            // Even on error, ensure minimum display time if needed before hiding loading
            const elapsedTime = Date.now() - startTime;
            const remainingTime = minDisplayTime - elapsedTime;
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
            }
        } finally {
            showLoading(false); // Hide loading indicators
        }
    }

    // --- Pop-up Chart Logic (Shared Container & Instance) ---

    // Shows Relative Performance vs SPY Chart
    function showRelativePerfChart(event, stockData) {
        // This function is now only called from the symbol cell's mouseover event

        hidePopupChart(); // Hide any existing chart first

        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || marketSymbolsList.includes(stockData.name) || stockData.error || !stockData.asset_1y_history_dates) {
            // Don't show for market indices, errors, missing elements, or missing perf data
            hidePopupChart(); // Ensure it's hidden if called erroneously
            return; // Exit if conditions not met
        }

        // Get Asset history
        const assetDates = stockData.asset_1y_history_dates;
        const assetValues = stockData.asset_1y_history_values;

        // Get SPY history (stored globally)
        const spyDates = spyHistoryData?.dates;
        const spyValues = spyHistoryData?.values;

        // Basic validation for chart data
        if (!assetDates || !assetValues || assetDates.length < 2 || assetValues.length < 2 || assetDates.length !== assetValues.length) {
            console.warn(`Insufficient or invalid asset historical performance data for ${stockData.name}`);
            hidePopupChart(); return;
        }
        if (!spyDates || !spyValues || spyDates.length < 2 || spyValues.length < 2 || spyDates.length !== spyValues.length) {
            console.warn(`Insufficient or invalid SPY historical performance data.`);
            hidePopupChart(); return;
        }

        // Destroy previous chart instance if exists
        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null; // Clear reference
        }

        const isLightTheme = document.body.classList.contains('light-theme');
        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';
        const spyLineColor = 'rgba(150, 150, 150, 0.7)'; // Grey for SPY

        // Determine asset line color based on its overall trend
        const firstAssetValue = assetValues[0];
        const lastAssetValue = assetValues[assetValues.length - 1];
        const assetLineColor = lastAssetValue >= firstAssetValue ? 'rgba(76, 175, 80, 0.8)' : 'rgba(244, 67, 54, 0.8)'; // Green if up, red if down

        // --- Align SPY data to Asset dates using forward fill ---
        const spyValueMap = new Map(spyDates.map((date, i) => [date, spyValues[i]]));
        let currentSpyValue = null;
        let spyIndex = 0;
        const alignedSpyValues = assetDates.map(assetDate => {
            while (spyIndex < spyDates.length && spyDates[spyIndex] <= assetDate) {
                 currentSpyValue = spyValues[spyIndex];
                 spyIndex++;
            }
             // If assetDate is before the first SPY date, spyIndex remains 0, currentSpyValue is null.
             // If assetDate is after the last SPY date, spyIndex goes past the end, currentSpyValue holds the last value.
            return currentSpyValue;
        });
        // --- End Alignment ---

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: assetDates, // Use asset dates as primary labels
                datasets: [
                    {
                        label: `${stockData.display_name || stockData.name} Perf (%)`, // Asset line
                        data: assetValues,
                        borderColor: assetLineColor,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: 0.1
                    },
                    {
                        label: `SPY Perf (%)`, // SPY line
                        data: alignedSpyValues, // Use aligned data
                        borderColor: spyLineColor,
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.1,
                        borderDash: [4, 4] // Dashed line for SPY
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false, // Hide x-axis labels/grid
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true, // Show y-axis for context
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            maxTicksLimit: 5 // Limit number of ticks
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false
                        }
                    }
                },
                plugins: {
                    legend: {
                         display: true, // Show legend now
                         position: 'top',
                         align: 'center',
                         labels: {
                             boxWidth: 12,
                             font: { size: 10 },
                             color: textColor
                         }
                    },
                    tooltip: { enabled: true } // Enable tooltips for value inspection
                },
                animation: false // Disable animation for faster rendering on hover
            }
        });

        // --- Set Overlay Text ---
        const relPerfValue = stockData.relative_perf_1y;
        if (relPerfValue !== null && relPerfValue !== undefined) {
            const formattedPerf = formatNumber(relPerfValue);
            chartOverlayTextElement.textContent = `Rel Perf: ${formattedPerf}%`; // Added back prefix for clarity
            chartOverlayTextElement.className = `chart-overlay ${relPerfValue >= 0 ? 'positive' : 'negative'}`; // Add class for color
        } else {
            chartOverlayTextElement.textContent = 'N/A'; // Show N/A if value is missing
            chartOverlayTextElement.className = 'chart-overlay'; // Reset class
        }
        // --- End Overlay Text ---


        // Position and show the chart
        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }

    // Function to show the RSI chart
    function showRsiChart(event, stockData) {
        hidePopupChart(); // Hide any existing chart first

        // --- Data Validation ---
        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || stockData.error) {
            return; // Exit if basic requirements aren't met
        }
        // Check specifically for RSI history data
        const rsiDates = stockData.rsi_1y_history_dates;
        const rsiValues = stockData.rsi_1y_history_values;

        if (!rsiDates || !rsiValues || rsiDates.length < 2 || rsiValues.length < 2 || rsiDates.length !== rsiValues.length) {
            console.warn(`Insufficient or invalid RSI historical data for ${stockData.name}`);
            chartOverlayTextElement.textContent = 'RSI Data N/A';
            chartOverlayTextElement.className = 'chart-overlay'; // Reset class
            positionPopup(event);
            popupChartContainer.style.display = 'block';
             if (popupChartInstance) {
                 popupChartInstance.destroy();
                 popupChartInstance = null;
             }
            return; // Exit if RSI data is bad
        }
        // --- End Data Validation ---


        // Destroy previous chart instance if exists
        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null;
        }

        const isLightTheme = document.body.classList.contains('light-theme');
        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';
        const rsiLineColor = isLightTheme ? 'rgba(0, 100, 200, 0.8)' : 'rgba(100, 180, 255, 0.8)'; // Blueish for RSI
        const oversoldColor = 'rgba(76, 175, 80, 0.5)'; // Greenish tint
        const overboughtColor = 'rgba(244, 67, 54, 0.5)'; // Reddish tint

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: rsiDates,
                datasets: [{
                    label: 'RSI (14)',
                    data: rsiValues,
                    borderColor: rsiLineColor,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false, // Hide x-axis labels/grid
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true, // Show y-axis
                        min: 0, // RSI typically 0-100
                        max: 100,
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            stepSize: 10, // Adjust step size
                            // Include 30 and 70 in ticks if possible
                            callback: function(value, index, values) {
                                if (value === 30 || value === 70 || value === 0 || value === 50 || value === 100) {
                                    return value;
                                }
                                return null; // Hide other labels for cleaner look
                            }
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false,
                            // Draw horizontal lines at 30 and 70
                            drawOnChartArea: true,
                            lineWidth: (context) => (context.tick.value === 30 || context.tick.value === 70 ? 1 : 0), // Only draw grid line for 30/70
                            color: (context) => (context.tick.value === 30 ? oversoldColor : (context.tick.value === 70 ? overboughtColor : gridColor)),
                        }
                    }
                },
                plugins: {
                    legend: { display: false }, // Hide legend for simplicity
                    tooltip: { enabled: true } // Enable tooltips
                },
                animation: false // Disable animation
            }
        });

        // --- Set Overlay Text ---
        const currentRsi = stockData.rsi14; // Get the current RSI value
        if (currentRsi !== null && currentRsi !== undefined) {
            const formattedRsi = formatNumber(currentRsi);
            chartOverlayTextElement.textContent = `RSI: ${formattedRsi}`;
            // Determine color based on current RSI
            let rsiClass = '';
            if (currentRsi < 30) rsiClass = 'positive';
            else if (currentRsi > 70) rsiClass = 'negative';
            chartOverlayTextElement.className = `chart-overlay ${rsiClass}`;
        } else {
            chartOverlayTextElement.textContent = 'RSI: N/A';
            chartOverlayTextElement.className = 'chart-overlay';
        }
        // --- End Overlay Text ---

        // Position and show the chart
        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }

    // Function to show the EMA13/EMA21 chart
    function showEmaChart(event, stockData) {
        hidePopupChart(); // Hide any existing chart first

        // --- Data Validation ---
        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || stockData.error) {
            return; // Exit if basic requirements aren't met
        }
        // Check specifically for EMA history data
        const emaDates = stockData.ema_1y_history_dates;
        const ema13Values = stockData.ema13_1y_history_values;
        const ema21Values = stockData.ema21_1y_history_values;

        if (!emaDates || !ema13Values || !ema21Values ||
            emaDates.length < 2 || ema13Values.length < 2 || ema21Values.length < 2 ||
            emaDates.length !== ema13Values.length || emaDates.length !== ema21Values.length) {
            console.warn(`Insufficient or invalid EMA historical data for ${stockData.name}`);
            chartOverlayTextElement.textContent = 'EMA Data N/A';
            chartOverlayTextElement.className = 'chart-overlay';
            positionPopup(event);
            popupChartContainer.style.display = 'block';
             if (popupChartInstance) {
                 popupChartInstance.destroy();
                 popupChartInstance = null;
             }
            return; // Exit if EMA data is bad
        }
        // --- End Data Validation ---

        // Destroy previous chart instance if exists
        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null;
        }

        const isLightTheme = document.body.classList.contains('light-theme');
        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';
        const ema13Color = isLightTheme ? 'rgba(0, 150, 136, 0.8)' : 'rgba(77, 182, 172, 0.8)'; // Tealish for EMA13
        const ema21Color = isLightTheme ? 'rgba(255, 87, 34, 0.8)' : 'rgba(255, 138, 101, 0.8)'; // Orangish for EMA21

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: emaDates,
                datasets: [
                    {
                        label: 'EMA 13',
                        data: ema13Values,
                        borderColor: ema13Color,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: 0.1
                    },
                    {
                        label: 'EMA 21',
                        data: ema21Values,
                        borderColor: ema21Color,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false,
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true, // Show y-axis for price context
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            maxTicksLimit: 5 // Limit ticks for price scale
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false
                        }
                    }
                },
                plugins: {
                    legend: { // Show legend for EMA chart
                         display: true,
                         position: 'top',
                         align: 'center',
                         labels: {
                             boxWidth: 12,
                             font: { size: 10 },
                             color: textColor
                         }
                    },
                    tooltip: { enabled: true }
                },
                animation: false
            }
        });

        // --- Set Overlay Text ---
        const currentEma13 = stockData.ema13;
        const currentEma21 = stockData.ema21;
        const signalShort = stockData.ema_signal || 'Neutral';

        chartOverlayTextElement.textContent = `EMA Signal: ${signalShort}`;
        let signalClass = '';
        if (signalShort === 'Buy') signalClass = 'positive';
        else if (signalShort === 'Sell') signalClass = 'negative';
        chartOverlayTextElement.className = `chart-overlay ${signalClass}`;
        // --- End Overlay Text ---

        // Position and show the chart
        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }

    // Function to show the Drawdown chart
    function showDrawdownChart(event, stockData) {
        hidePopupChart(); // Hide any existing chart first

        // --- Data Validation ---
        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || stockData.error) {
            return; // Exit if basic requirements aren't met
        }
        // Check specifically for Drawdown history data
        const drawdownDates = stockData.drawdown_history_dates;
        const drawdownValues = stockData.drawdown_history_values;

        if (!drawdownDates || !drawdownValues || drawdownDates.length < 2 || drawdownValues.length < 2 || drawdownDates.length !== drawdownValues.length) {
            console.warn(`Insufficient or invalid Drawdown historical data for ${stockData.name}`);
            chartOverlayTextElement.textContent = 'Drawdown Data N/A';
            chartOverlayTextElement.className = 'chart-overlay';
            positionPopup(event);
            popupChartContainer.style.display = 'block';
             if (popupChartInstance) {
                 popupChartInstance.destroy();
                 popupChartInstance = null;
             }
            return; // Exit if drawdown data is bad
        }
        // --- End Data Validation ---

        // Destroy previous chart instance if exists
        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null;
        }

        const isLightTheme = document.body.classList.contains('light-theme');
        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';
        const drawdownColor = isLightTheme ? 'rgba(156, 39, 176, 0.8)' : 'rgba(186, 104, 200, 0.8)'; // Purpleish for Drawdown

        // Find min value for y-axis scaling (drawdown is negative or zero)
        const minValue = Math.min(0, ...drawdownValues);
        const suggestedMin = Math.floor(minValue / 10) * 10; // Round down to nearest 10

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: drawdownDates,
                datasets: [{
                    label: 'Drawdown %',
                    data: drawdownValues,
                    borderColor: drawdownColor,
                    backgroundColor: drawdownColor.replace('0.8', '0.2'), // Lighter fill
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1,
                    fill: true // Fill area below line
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false,
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true, // Show y-axis
                        suggestedMin: suggestedMin, // Start slightly below the lowest drawdown
                        max: 0, // Max drawdown is 0%
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            maxTicksLimit: 5,
                            // Format ticks as percentages
                            callback: function(value) {
                                return value + '%';
                            }
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false
                        }
                    }
                },
                plugins: {
                    legend: { display: false }, // Hide legend
                    tooltip: {
                        enabled: true,
                        callbacks: {
                             // Format tooltip value as percentage
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += formatNumber(context.parsed.y) + '%';
                                }
                                return label;
                            }
                        }
                    }
                },
                animation: false
            }
        });

        // --- Set Overlay Text ---
        const currentDrawdown = stockData.current_drawdown_pct;
        chartOverlayTextElement.textContent = `Drawdown: ${formatNumber(currentDrawdown)}%`;
        // Drawdown is always negative or zero, so use negative class
        chartOverlayTextElement.className = `chart-overlay ${currentDrawdown < 0 ? 'negative' : ''}`;
        // --- End Overlay Text ---

        // Position and show the chart
        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }


    function hidePopupChart() { // Renamed function
        if (popupChartContainer) {
            popupChartContainer.style.display = 'none';
        }
        // We destroy the chart instance when showing the *next* chart
        // to avoid flicker if moving between cells quickly.
    }

    function positionPopup(event) {
        if (!popupChartContainer) return;

        const cell = event.target.closest('td'); // Position relative to the cell
        if (!cell) return;

        const cellRect = cell.getBoundingClientRect();
        // Ensure container has dimensions before calculating position
        const containerRect = popupChartContainer.getBoundingClientRect();
        const containerWidth = containerRect.width || 350; // Use fallback width if measurement fails initially
        const containerHeight = containerRect.height || 200; // Use fallback height

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const padding = 10; // Padding from viewport edges

        // Default position: below the cell, aligned left
        let top = cellRect.bottom + scrollY + 2;
        let left = cellRect.left + scrollX;

        // Adjust vertically if it goes off the bottom edge
        if (top + containerHeight > viewportHeight + scrollY - padding) {
            // Try positioning above the cell
            top = cellRect.top + scrollY - containerHeight - 2;
            // If it also goes off the top edge (unlikely unless cell is tall), clamp to top
            if (top < scrollY + padding) {
                top = scrollY + padding;
            }
        }
         // Clamp to top edge if initial position was already too high
         if (top < scrollY + padding) {
             top = scrollY + padding;
         }


        // Adjust horizontally if it goes off the right edge
        if (left + containerWidth > viewportWidth + scrollX - padding) {
            // Try aligning the right edge of the popup with the right edge of the cell
            left = cellRect.right + scrollX - containerWidth;
            // If aligning with cell right still goes off screen left, align with viewport right edge
            if (left + containerWidth > viewportWidth + scrollX - padding) {
                 left = viewportWidth + scrollX - containerWidth - padding;
            }
        }

        // Ensure it doesn't go off the left edge either
        if (left < scrollX + padding) {
            left = scrollX + padding;
        }

        popupChartContainer.style.top = `${top}px`;
        popupChartContainer.style.left = `${left}px`;
    }


    // --- Theme Handling ---
    function applyTheme(isLight) {
        document.body.classList.toggle('light-theme', isLight);
        document.body.classList.toggle('dark-theme', !isLight);
    }

    // --- Update Sort Indicators ---
    function updateSortIndicators() {
        document.querySelectorAll('#stock-table thead th').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === sortColumn) {
                th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // --- Local Storage Functions ---
    function saveDataToLocalStorage() {
        try {
            const dataToStore = {
                marketData: currentMarketData,
                assetData: currentAssetData,
                spyHistory: spyHistoryData,
                timestamp: Date.now() // Store timestamp for potential expiry logic later
            };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dataToStore));
            console.log("Data saved to localStorage");
        } catch (e) {
            console.error("Error saving data to localStorage:", e);
        }
    }

    function loadDataFromLocalStorage() {
        console.log("loadDataFromLocalStorage: Attempting to load..."); // Log start
        try {
            const storedDataString = localStorage.getItem(LOCAL_STORAGE_KEY);
            console.log("loadDataFromLocalStorage: Raw data string:", storedDataString ? storedDataString.substring(0, 100) + '...' : 'null'); // Log snippet

            if (storedDataString) {
                const storedData = JSON.parse(storedDataString);
                console.log("loadDataFromLocalStorage: Parsed data:", storedData); // Log parsed object

                currentMarketData = storedData.marketData || {};
                currentAssetData = storedData.assetData || [];
                spyHistoryData = storedData.spyHistory || null;
                console.log("loadDataFromLocalStorage: Successfully loaded and assigned data.");
                return true; // Indicate data was loaded
            } else {
                console.log("loadDataFromLocalStorage: No data found in localStorage.");
            }
        } catch (e) {
            console.error("loadDataFromLocalStorage: Error loading or parsing data:", e);
            localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear corrupted data
        }
        console.log("loadDataFromLocalStorage: Returning false."); // Log failure case
        return false; // Indicate no valid data was loaded
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        console.log("Setting up event listeners..."); // Log before listeners

        // Refresh Button
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                fetchAndRenderData(); // Manual refresh
                clearInterval(updateInterval);
                updateInterval = setInterval(fetchAndRenderData, REFRESH_INTERVAL_MS);
            });
        }

        // Period Selectors
        if (drawdownPeriodSelect) drawdownPeriodSelect.addEventListener('change', fetchAndRenderData);
        if (changePeriodSelect) changePeriodSelect.addEventListener('change', fetchAndRenderData); // Add listener for change period

        // Theme Toggle
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const isLight = document.body.classList.toggle('light-theme');
                localStorage.setItem('theme', isLight ? 'light' : 'dark');
                applyTheme(isLight);
                if (popupChartContainer && popupChartContainer.style.display === 'block') {
                     hidePopupChart();
                }
            });
        }

        // Table Header Sorting
        document.querySelectorAll('#stock-table thead th[data-sort]').forEach(header => {
            header.addEventListener('click', () => {
                const newSortColumn = header.dataset.sort;
                if (sortColumn === newSortColumn) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = newSortColumn;
                    sortDirection = 'asc'; // Default to ascending for new column
                }
                renderTable(); // Re-render with new sort order
            });
        });

        // General mouseout listener for the table body to hide the chart
        if (stockTableBody) {
             stockTableBody.addEventListener('mouseout', (event) => {
                // Hide chart when mouse leaves the table body or the popup itself
                const relatedTarget = event.relatedTarget;
                // Check if the mouse is still within the table body or the popup itself
                if (popupChartContainer && !stockTableBody.contains(relatedTarget) && !popupChartContainer.contains(relatedTarget)) {
                    hidePopupChart();
                }
                // Note: Mouseout events on individual cells (.symbol, .rsi, .ema13, .ema21, .drawdown) are handled in renderRow
            });
        }


        // Visibility Change Listener
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log("Tab hidden, clearing refresh interval.");
                clearInterval(updateInterval);
            } else {
                console.log("Tab visible, fetching data and restarting interval.");
                fetchAndRenderData();
                updateInterval = setInterval(fetchAndRenderData, REFRESH_INTERVAL_MS);
            }
        });

        console.log("Event listeners setup complete."); // Log after listeners
    }

    // --- Initialization Logic ---

    // Apply saved theme on load
    console.log("Applying saved theme (if any)...");
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        applyTheme(savedTheme === 'light');
    } else {
        // Default to system preference or dark theme
        const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        applyTheme(prefersLight);
    }
    console.log("Theme application logic complete.");

    // Setup event listeners
    setupEventListeners();

    // Initial data load/render
    console.log("Initial Load: Starting check for cached data..."); // Log before check
    const hasCachedData = loadDataFromLocalStorage(); // Function now contains detailed logs
    console.log("Initial Load: Result of loadDataFromLocalStorage:", hasCachedData); // Log result

    if (hasCachedData) {
        console.log("Initial Load: Cached data found. Rendering synchronously...");
        isInitialLoad = false;
        try {
            renderTable(); // Render cached data synchronously FIRST
            console.log("Initial Load: Synchronous render complete. Scheduling background refresh.");
            // Schedule the first background refresh asynchronously
            setTimeout(fetchAndRenderData, 0);
        } catch (renderError) {
            console.error("Initial Load: Error during synchronous render from cache:", renderError);
            // Fallback to fetching fresh data if initial render fails
            isInitialLoad = true;
            fetchAndRenderData();
        }
    } else {
        console.log("Initial Load: No cached data. Performing initial fetch...");
        isInitialLoad = true;
        // Perform initial fetch immediately (shows "Loading Data...")
        fetchAndRenderData();
    }

    // Set up auto-refresh interval for subsequent refreshes
    console.log("Initial Load: Setting up auto-refresh interval.");
    updateInterval = setInterval(fetchAndRenderData, REFRESH_INTERVAL_MS);

    console.log("Initial Load: Setup complete."); // Log end of initialization function
}

// --- Attach the main initialization function to DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', initializeDashboard);

console.log("Script file loaded and DOMContentLoaded listener attached."); // Log outside listener