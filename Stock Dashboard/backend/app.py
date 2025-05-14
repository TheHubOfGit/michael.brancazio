import sys
import pandas as pd
import numpy as np
import yfinance as yf
import os
import json
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, send_from_directory, request

# --- Configuration ---
app = Flask(__name__, static_folder='../frontend', static_url_path='')

# Define symbols and their types (including BTC and LTC)
ASSET_LIST = {
    'BA': 'Stock', 'ABNB': 'Stock', 'SHOP': 'Stock', 'WDAY': 'Stock', 'SWBI': 'Stock',
    'COIN': 'Stock', 'QCOM': 'Stock', 'AMD': 'Stock', 'NVDA': 'Stock', 'PLTR': 'Stock',
    'EQIX': 'Stock', 'DIS': 'Stock', 'PFE': 'Stock', 'PSEC': 'Stock', 'TSLA': 'Stock',
    'MSFT': 'Stock', 'GOOG': 'Stock', 'AMZN': 'Stock', 'AAPL': 'Stock', 'V': 'Stock',
    'UAL': 'Stock', 'DAL': 'Stock',
    'SOXX': 'ETF', 'SPXL': 'ETF', 'TQQQ': 'ETF',
    'BTC-USD': 'Crypto', 'LTC-USD': 'Crypto'
}
SYMBOLS = list(ASSET_LIST.keys())

# Define Market Symbols and Names
MARKET_SYMBOLS = {
    'SPY': 'SPY',
    '^DJI': 'Dow Jones',
    '^GSPC': 'S&P 500',
    '^VIX': 'VIX (Volatility)'
}

# Use a longer period for EMA/RSI calculation stability if needed
DATA_FETCH_PERIOD = "5y" # Fetch 5 years of data for calculations

# --- Calculation Logic ---

def calculate_indicators(df):
    """Calculates EMA13, EMA21, EMA100, EMA200, and RSI14 for a given DataFrame."""
    if df.empty or 'Close' not in df.columns:
        return pd.DataFrame({'EMA13': [], 'EMA21': [], 'EMA100': [], 'EMA200': [], 'RSI14': []})

    result = pd.DataFrame(index=df.index)
    close_series = df['Close'].astype(float)

    result['EMA13'] = close_series.ewm(span=13, adjust=False).mean()
    result['EMA21'] = close_series.ewm(span=21, adjust=False).mean()
    result['EMA100'] = close_series.ewm(span=100, adjust=False).mean()
    result['EMA200'] = close_series.ewm(span=200, adjust=False).mean()

    delta = close_series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(com=13, adjust=False).mean()
    avg_loss = loss.ewm(com=13, adjust=False).mean()
    rs = avg_gain / avg_loss
    result['RSI14'] = 100.0 - (100.0 / (1.0 + rs.replace(np.inf, np.nan)))
    result['RSI14'] = result['RSI14'].fillna(50)

    return result[['EMA13', 'EMA21', 'EMA100', 'EMA200', 'RSI14']]

# --- Helper Function for Time Periods ---
def get_start_date_from_period(period_str, reference_date=None):
    """Converts period string (e.g., '1y', '3m', '1d') to a start date relative to the reference date."""
    if reference_date is None:
        reference_date = datetime.now(timezone.utc)
    # Ensure reference_date is timezone-aware (UTC)
    if reference_date.tzinfo is None:
        reference_date = reference_date.replace(tzinfo=timezone.utc)
    else:
        reference_date = reference_date.astimezone(timezone.utc)

    period_map = {
        '1d': timedelta(days=1), # Added 1d
        '1w': timedelta(weeks=1), '7d': timedelta(days=7), '1m': timedelta(days=30),
        '3m': timedelta(days=91), '6m': timedelta(days=182), '1y': timedelta(days=365),
        '2y': timedelta(days=365*2), '3y': timedelta(days=365*3),
        '4y': timedelta(days=365*4), '5y': timedelta(days=365*5),
    }
    delta = period_map.get(period_str.lower())
    # Default to 1 day if period is invalid or not found
    return reference_date - delta if delta else reference_date - timedelta(days=1)

# --- Calculation Logic (Modified Drawdown) ---
def calculate_current_drawdown_from_peak(full_close_prices, period_start_date):
    """Calculates the drawdown from the peak within the period to the current price."""
    if full_close_prices.empty: return None
    if full_close_prices.index.tz is None:
        close_prices_utc = full_close_prices.tz_localize('UTC')
    else:
        close_prices_utc = full_close_prices.tz_convert('UTC')
    period_prices = close_prices_utc[close_prices_utc.index >= period_start_date]
    if period_prices.empty: return None
    period_peak = period_prices.max()
    latest_price = full_close_prices.iloc[-1]
    if pd.isna(period_peak) or period_peak == 0: return None
    return ((latest_price - period_peak) / period_peak) * 100

def calculate_period_change(close_prices, period_str='1d'):
    """Calculates the percentage change over a specified period."""
    if close_prices.empty or len(close_prices) < 2: return 0.0

    latest_price = close_prices.iloc[-1]
    latest_date = close_prices.index[-1]

    # Ensure latest_date is timezone-aware for comparison
    if latest_date.tzinfo is None:
        latest_date = latest_date.tz_localize('UTC')
    else:
        latest_date = latest_date.astimezone(timezone.utc)

    start_date = get_start_date_from_period(period_str, reference_date=latest_date)

    # Ensure the index is timezone-aware (UTC) for comparison
    if close_prices.index.tz is None:
        close_prices_index_utc = close_prices.index.tz_localize('UTC')
    else:
        close_prices_index_utc = close_prices.index.tz_convert('UTC')

    # Find the closest available price at or before the start date using the UTC index
    historical_prices = close_prices[close_prices_index_utc <= start_date]
    if historical_prices.empty:
        # If no data before start date, use the earliest available price
        historical_price = close_prices.iloc[0]
        if historical_price == 0 or pd.isna(historical_price): return 0.0 # Avoid division by zero or NaN
    else:
        historical_price = historical_prices.iloc[-1]
        if historical_price == 0 or pd.isna(historical_price): return 0.0 # Avoid division by zero or NaN

    if pd.isna(latest_price): return 0.0 # Avoid calculation with NaN

    return ((latest_price - historical_price) / historical_price) * 100

def calculate_cumulative_return(close_prices, period_str='1y'):
    """Calculates the cumulative percentage return series over a specified period."""
    if close_prices.empty or len(close_prices) < 2:
        return pd.Series(dtype=float) # Return empty series if not enough data

    latest_date = close_prices.index[-1]
    # Ensure latest_date is timezone-aware for comparison
    if latest_date.tzinfo is None: latest_date = latest_date.tz_localize('UTC')
    else: latest_date = latest_date.astimezone(timezone.utc)

    start_date = get_start_date_from_period(period_str, reference_date=latest_date)

    # Ensure the index is timezone-aware (UTC) for comparison
    if close_prices.index.tz is None: close_prices_index_utc = close_prices.index.tz_localize('UTC')
    else: close_prices_index_utc = close_prices.index.tz_convert('UTC')

    # Filter data for the period
    period_prices = close_prices[close_prices_index_utc >= start_date]

    if period_prices.empty:
        return pd.Series(dtype=float) # Return empty series if no data in period

    # Calculate cumulative return relative to the first price in the period
    cumulative_return = (period_prices / period_prices.iloc[0] - 1) * 100
    return cumulative_return.dropna()

# --- Helper function to find last crossover date ---
def find_last_ema_crossover_date(ema_short_series, ema_long_series):
    """Finds the date index of the last bullish crossover (short > long)."""
    if ema_short_series.empty or ema_long_series.empty or len(ema_short_series) < 2: return None
    combined_emas = pd.DataFrame({'short': ema_short_series, 'long': ema_long_series}).dropna()
    if len(combined_emas) < 2: return None
    currently_above = combined_emas['short'] > combined_emas['long']
    previously_below_or_equal = combined_emas['short'].shift(1) <= combined_emas['long'].shift(1)
    crossover_points = combined_emas[currently_above & previously_below_or_equal]
    if crossover_points.empty: return None
    last_crossover_date = crossover_points.index[-1]
    return last_crossover_date.strftime('%Y-%m-%d') if isinstance(last_crossover_date, pd.Timestamp) else str(last_crossover_date)

def fetch_and_process_asset_data(symbol, drawdown_period_str='1y', change_period_str='1d',
                               spy_1y_change=None, # Keep for tooltip calculation
                               is_market_symbol=False):
    """Fetches data, calculates indicators, relative performance (point), asset cumulative history, and sparkline data."""
    try:
        # print(f"Fetching data for {symbol}...") # Reduce noise
        stock_data_raw = yf.download(symbol, period=DATA_FETCH_PERIOD, interval="1d", progress=False, auto_adjust=False, actions=False)
        if stock_data_raw.empty: return None

        if isinstance(stock_data_raw.columns, pd.MultiIndex):
            stock_data_raw.columns = stock_data_raw.columns.get_level_values(0)
            stock_data_raw = stock_data_raw.loc[:,~stock_data_raw.columns.duplicated()]

        cols_to_keep = ['Open', 'High', 'Low', 'Close', 'Volume']
        valid_cols = [col for col in cols_to_keep if col in stock_data_raw.columns]
        if not valid_cols or 'Close' not in valid_cols: return None
        stock_data = stock_data_raw[valid_cols].copy()

        indicators = calculate_indicators(stock_data)
        combined_data = stock_data.join(indicators)
        if combined_data.empty or len(combined_data) < 2 or 'Close' not in combined_data.columns: return None

        latest_row = combined_data.iloc[-1]
        close_prices = combined_data['Close'].dropna()

        result_dict = {
            'name': symbol,
            'display_name': MARKET_SYMBOLS.get(symbol, symbol), # Use custom name or symbol
            'type': MARKET_SYMBOLS.get(symbol) or ASSET_LIST.get(symbol, 'Unknown'),
            'latest_price': float(latest_row['Close']),
            'daily_change_pct': calculate_period_change(close_prices, change_period_str), # Use period change
            'ema13': float(latest_row['EMA13']) if pd.notna(latest_row['EMA13']) else None,
            'ema21': float(latest_row['EMA21']) if pd.notna(latest_row['EMA21']) else None,
            'rsi14': float(latest_row['RSI14']) if pd.notna(latest_row['RSI14']) else None,
            'ema100': float(latest_row['EMA100']) if pd.notna(latest_row['EMA100']) else None,
            'ema200': float(latest_row['EMA200']) if pd.notna(latest_row['EMA200']) else None,
            'current_drawdown_pct': calculate_current_drawdown_from_peak(close_prices, get_start_date_from_period(drawdown_period_str)),
            'ema_signal': None,
            'ema_long_signal': None,
            'ema_short_last_buy_date': None,
            'ema_long_last_buy_date': None,
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'relative_perf_1y': None, # Placeholder for relative performance vs SPY
            'sparkline_data': None, # Placeholder for sparkline data (e.g., last 30 closes)
            'asset_1y_history_dates': [], # Placeholder for asset's 1y cumulative perf dates
            'asset_1y_history_values': [], # Placeholder for asset's 1y cumulative perf values
            'rsi_1y_history_dates': [], # Placeholder for asset's 1y RSI history dates
            'rsi_1y_history_values': [], # Placeholder for asset's 1y RSI history values
            'ema_1y_history_dates': [], # Placeholder for asset's 1y EMA history dates (shared)
            'ema13_1y_history_values': [], # Placeholder for asset's 1y EMA13 history values
            'ema21_1y_history_values': [], # Placeholder for asset's 1y EMA21 history values
            'drawdown_history_dates': [], # Placeholder for drawdown history dates (matches drawdown_period)
            'drawdown_history_values': [] # Placeholder for drawdown history values
        }

        # Calculate signals and last buy dates (only if EMAs exist)
        if result_dict['ema13'] is not None and result_dict['ema21'] is not None:
            result_dict['ema_signal'] = 'Buy' if result_dict['ema13'] > result_dict['ema21'] else ('Sell' if result_dict['ema13'] < result_dict['ema21'] else None)
            if 'EMA13' in combined_data.columns and 'EMA21' in combined_data.columns:
                 result_dict['ema_short_last_buy_date'] = find_last_ema_crossover_date(combined_data['EMA13'], combined_data['EMA21'])

        if result_dict['ema100'] is not None and result_dict['ema200'] is not None:
            result_dict['ema_long_signal'] = 'Buy' if result_dict['ema100'] > result_dict['ema200'] else ('Sell' if result_dict['ema100'] < result_dict['ema200'] else None)
            if 'EMA100' in combined_data.columns and 'EMA200' in combined_data.columns:
                 result_dict['ema_long_last_buy_date'] = find_last_ema_crossover_date(combined_data['EMA100'], combined_data['EMA200'])

        # Calculate 1-year change for the asset
        asset_1y_change = calculate_period_change(close_prices, '1y')

        # Calculate relative performance if SPY change is provided and asset is not SPY
        if spy_1y_change is not None and symbol != 'SPY':
            if asset_1y_change is not None:
                 result_dict['relative_perf_1y'] = asset_1y_change - spy_1y_change
            else:
                 result_dict['relative_perf_1y'] = None # Cannot calculate if asset change is None
        elif symbol == 'SPY':
             result_dict['relative_perf_1y'] = 0.0 # SPY relative to itself is 0

        # Prepare sparkline data based on the change_period_str
        if len(close_prices) >= 2:
            sparkline_start_date = get_start_date_from_period(change_period_str, reference_date=close_prices.index[-1])
            # Ensure index is timezone-aware for comparison
            if close_prices.index.tz is None: close_prices_index_utc = close_prices.index.tz_localize('UTC')
            else: close_prices_index_utc = close_prices.index.tz_convert('UTC')
            # Filter prices for the sparkline period
            sparkline_prices = close_prices[close_prices_index_utc >= sparkline_start_date]

            if not sparkline_prices.empty:
                 # Ensure data is suitable for JSON (handle potential NaNs)
                 result_dict['sparkline_data'] = [p for p in sparkline_prices.tolist() if pd.notna(p)]
            else:
                 # Fallback to last 2 points if period has no data but overall data exists
                 sparkline_points = close_prices.tail(2).tolist()
                 result_dict['sparkline_data'] = [p for p in sparkline_points if pd.notna(p)]
        else:
            result_dict['sparkline_data'] = []

        # --- Calculate Asset's Historical Cumulative Performance (1 Year) ---
        asset_1y_cum_ret = calculate_cumulative_return(close_prices, '1y')
        if not asset_1y_cum_ret.empty:
            result_dict['asset_1y_history_dates'] = asset_1y_cum_ret.index.strftime('%Y-%m-%d').tolist()
            result_dict['asset_1y_history_values'] = [round(v, 2) for v in asset_1y_cum_ret.values.tolist()]
        # --- End Asset Historical Performance ---

        # --- Calculate Asset's Historical RSI (1 Year) ---
        if 'RSI14' in indicators.columns:
            rsi_series = indicators['RSI14'].dropna()
            if not rsi_series.empty and len(rsi_series) >= 2:
                rsi_latest_date = rsi_series.index[-1]
                # Ensure latest_date is timezone-aware for comparison
                if rsi_latest_date.tzinfo is None: rsi_latest_date = rsi_latest_date.tz_localize('UTC')
                else: rsi_latest_date = rsi_latest_date.astimezone(timezone.utc)

                rsi_start_date = get_start_date_from_period('1y', reference_date=rsi_latest_date)

                # Ensure the index is timezone-aware (UTC) for comparison
                if rsi_series.index.tz is None: rsi_index_utc = rsi_series.index.tz_localize('UTC')
                else: rsi_index_utc = rsi_series.index.tz_convert('UTC')

                # Filter data for the period
                rsi_1y_series = rsi_series[rsi_index_utc >= rsi_start_date]

                if not rsi_1y_series.empty:
                    result_dict['rsi_1y_history_dates'] = rsi_1y_series.index.strftime('%Y-%m-%d').tolist()
                    result_dict['rsi_1y_history_values'] = [round(v, 2) for v in rsi_1y_series.values.tolist()]
        # --- End Asset Historical RSI ---

        # --- Calculate Asset's Historical EMAs (1 Year) ---
        if 'EMA13' in indicators.columns and 'EMA21' in indicators.columns:
            ema13_series = indicators['EMA13'].dropna()
            ema21_series = indicators['EMA21'].dropna()

            # Use EMA13 series for date filtering (assuming they share the same index)
            if not ema13_series.empty and len(ema13_series) >= 2:
                ema_latest_date = ema13_series.index[-1]
                # Ensure latest_date is timezone-aware
                if ema_latest_date.tzinfo is None: ema_latest_date = ema_latest_date.tz_localize('UTC')
                else: ema_latest_date = ema_latest_date.astimezone(timezone.utc)

                ema_start_date = get_start_date_from_period('1y', reference_date=ema_latest_date)

                # Ensure index is timezone-aware
                if ema13_series.index.tz is None: ema_index_utc = ema13_series.index.tz_localize('UTC')
                else: ema_index_utc = ema13_series.index.tz_convert('UTC')

                # Filter EMA series for the 1-year period
                ema13_1y_series = ema13_series[ema_index_utc >= ema_start_date]
                # Align EMA21 series to the filtered EMA13 index to ensure matching dates/lengths
                ema21_1y_series = ema21_series.reindex(ema13_1y_series.index)

                if not ema13_1y_series.empty and not ema21_1y_series.empty:
                    result_dict['ema_1y_history_dates'] = ema13_1y_series.index.strftime('%Y-%m-%d').tolist()
                    result_dict['ema13_1y_history_values'] = [round(v, 2) for v in ema13_1y_series.values.tolist() if pd.notna(v)]
                    result_dict['ema21_1y_history_values'] = [round(v, 2) for v in ema21_1y_series.values.tolist() if pd.notna(v)]
                    # Basic check to ensure value lists match date list length after potential NaN removal
                    if len(result_dict['ema13_1y_history_values']) != len(result_dict['ema_1y_history_dates']) or \
                       len(result_dict['ema21_1y_history_values']) != len(result_dict['ema_1y_history_dates']):
                        print(f"Warning: EMA history length mismatch after NaN removal for {symbol}. Clearing EMA history.")
                        result_dict['ema_1y_history_dates'] = []
                        result_dict['ema13_1y_history_values'] = []
                        result_dict['ema21_1y_history_values'] = []


        # --- End Asset Historical EMAs ---

        # --- Calculate Asset's Historical Drawdown (Based on selected drawdown_period_str) ---
        if not close_prices.empty:
            drawdown_start_date = get_start_date_from_period(drawdown_period_str, reference_date=close_prices.index[-1])
            # Ensure index is timezone-aware for comparison
            if close_prices.index.tz is None: close_prices_index_utc = close_prices.index.tz_localize('UTC')
            else: close_prices_index_utc = close_prices.index.tz_convert('UTC')

            # Filter prices for the drawdown period
            drawdown_period_prices = close_prices[close_prices_index_utc >= drawdown_start_date]

            if not drawdown_period_prices.empty and len(drawdown_period_prices) > 1:
                running_peak = drawdown_period_prices.cummax()
                # Avoid division by zero if peak is 0
                running_peak = running_peak.replace(0, np.nan)
                drawdown_pct_series = ((drawdown_period_prices - running_peak) / running_peak) * 100
                # Fill initial NaNs (before first peak) with 0 drawdown
                drawdown_pct_series = drawdown_pct_series.fillna(0)

                # Ensure results are JSON serializable and rounded
                result_dict['drawdown_history_dates'] = drawdown_pct_series.index.strftime('%Y-%m-%d').tolist()
                result_dict['drawdown_history_values'] = [round(v, 2) for v in drawdown_pct_series.values.tolist() if pd.notna(v)]

                # Check for length mismatch after NaN removal (should be rare here)
                if len(result_dict['drawdown_history_values']) != len(result_dict['drawdown_history_dates']):
                    print(f"Warning: Drawdown history length mismatch after NaN removal for {symbol}. Clearing drawdown history.")
                    result_dict['drawdown_history_dates'] = []
                    result_dict['drawdown_history_values'] = []
        # --- End Asset Historical Drawdown ---


        return result_dict

    except Exception as e:
        print(f"Error processing {symbol}: {e}")
        return {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol), 'error': str(e)} # Return error structure

# --- API Endpoints ---
@app.route('/api/dashboard-data')
def get_dashboard_data():
    """API endpoint to get processed data for market and asset symbols."""
    drawdown_period = request.args.get('drawdown_period', default='1y', type=str)
    change_period = request.args.get('change_period', default='1d', type=str) # Get change_period
    print(f"API: Using drawdown period: {drawdown_period}, change period: {change_period}")

    market_data = {}
    asset_data = {}
    spy_1y_change = None
    spy_1y_cum_ret_series = None # Still calculate this for passing to assets if needed, but also store dates/values
    spy_1y_history_dates = []
    spy_1y_history_values = []

    # --- Pre-fetch SPY data for relative performance calculation ---
    print("API: Pre-fetching SPY for 1Y change and historical relative performance...")
    try:
        # Fetch slightly more than 1 year to ensure enough data for calculation start point
        spy_data_raw = yf.download('SPY', period="13mo", interval="1d", progress=False, auto_adjust=False, actions=False)

        # Handle potential MultiIndex columns returned by yfinance
        if isinstance(spy_data_raw.columns, pd.MultiIndex):
            spy_data_raw.columns = spy_data_raw.columns.get_level_values(0)
            spy_data_raw = spy_data_raw.loc[:,~spy_data_raw.columns.duplicated()]

        if not spy_data_raw.empty and 'Close' in spy_data_raw.columns:
            spy_close_prices = spy_data_raw['Close'].dropna()
            if len(spy_close_prices) >= 2:
                # Calculate final 1Y change (for tooltip/backup)
                spy_1y_change = calculate_period_change(spy_close_prices, '1y')
                if spy_1y_change is not None and pd.notna(spy_1y_change):
                     print(f"API: SPY 1Y Change calculated: {spy_1y_change:.2f}%")
                else:
                     print("API: SPY 1Y Change calculation resulted in None or NaN.")
                     spy_1y_change = None # Ensure it's None if calculation failed

                # Calculate 1Y cumulative return series (for graph)
                spy_1y_cum_ret_series = calculate_cumulative_return(spy_close_prices, '1y')
                if spy_1y_cum_ret_series.empty:
                    print("API: SPY 1Y Cumulative Return series calculation failed or resulted in empty series.")
                    spy_1y_cum_ret_series = None # Ensure it's None
                else:
                    print(f"API: SPY 1Y Cumulative Return series calculated with {len(spy_1y_cum_ret_series)} points.")
                    # Store dates and values for the main response
                    spy_1y_history_dates = spy_1y_cum_ret_series.index.strftime('%Y-%m-%d').tolist()
                    spy_1y_history_values = [round(v, 2) for v in spy_1y_cum_ret_series.values.tolist()]

            else:
                print("API: Not enough SPY data points for 1Y calculations.")
        else:
            print("API: Failed to fetch SPY data or 'Close' column missing.")
    except Exception as e:
        print(f"API: Error fetching/processing SPY data for relative performance: {e}")
    # --- End SPY Pre-fetch ---


    # Fetch Market Data (Pass SPY change)
    print("API: Fetching Market Data...")
    for symbol, name in MARKET_SYMBOLS.items():
        # Don't need to pass spy_1y_cum_ret_series anymore
        market_data[symbol] = fetch_and_process_asset_data(symbol, drawdown_period, change_period,
                                                           spy_1y_change=spy_1y_change,
                                                           is_market_symbol=True)

    # Fetch Regular Asset Data (Pass SPY change)
    print("API: Fetching Asset Data...")
    for symbol in SYMBOLS:
        # Don't need to pass spy_1y_cum_ret_series anymore
        asset_data[symbol] = fetch_and_process_asset_data(symbol, drawdown_period, change_period,
                                                          spy_1y_change=spy_1y_change)

    print(f"API: Returning data for {len(market_data)} market symbols and {len(asset_data)} assets.")
    return jsonify({
        'market_data': market_data,
        'asset_data': asset_data,
        'spy_1y_history': { # Add SPY history to the main response
            'dates': spy_1y_history_dates,
            'values': spy_1y_history_values
        }
    })

# --- Static File Serving ---
@app.route('/')
def serve_index():
    """Serves the main index.html file."""
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    """Serves other static files (CSS, JS)."""
    return send_from_directory(app.static_folder, path)

# --- Main Execution ---
if __name__ == '__main__':
    app.run(debug=True, port=5004)