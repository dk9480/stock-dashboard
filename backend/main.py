from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import sqlite3
from datetime import datetime, timedelta
from typing import Optional
import time

app = FastAPI(title="Stock Data Intelligence Dashboard", version="1.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_connection():
    return sqlite3.connect("stocks.db")

# Expanded stock list with more companies
stocks = [
    "INFY.NS", "TCS.NS", "RELIANCE.NS", "HDFCBANK.NS", "ITC.NS",
    "WIPRO.NS", "HCLTECH.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS"
]

def load_data():
    """Load data with proper handling of missing values"""
    conn = sqlite3.connect("stocks.db")
    
    # Check if data already exists and is recent
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_data'")
    if cursor.fetchone():
        count = conn.execute("SELECT COUNT(*) FROM stock_data").fetchone()[0]
        if count > 0:
            # Get the latest date
            result = conn.execute("SELECT MAX(Date) FROM stock_data").fetchone()[0]
            if result:
                # Compare as strings - YYYY-MM-DD works lexicographically
                yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
                
                if result >= yesterday:
                    print(f"✓ Data is recent (latest: {result}), skipping reload...")
                    conn.close()
                    return
                else:
                    print(f"⚠ Data is old (latest: {result}), refreshing...")
            else:
                print("No data found, loading fresh data...")
    
    print("📥 Loading fresh data from Yahoo Finance...")
    
    # Clear old data
    conn.execute("DROP TABLE IF EXISTS stock_data")
    
    for stock in stocks:
        print(f"  Downloading {stock}...")
        try:
            # FIXED: Use Ticker object for better reliability
            ticker = yf.Ticker(stock)
            data = ticker.history(period="1y")
            
            if data.empty:
                print(f"    ⚠ No data for {stock}, trying with '6mo'...")
                data = ticker.history(period="6mo")
                if data.empty:
                    print(f"    ✗ Still no data for {stock}, skipping...")
                    continue
            
            print(f"    ✓ Fetched {len(data)} rows")
            data.reset_index(inplace=True)
            
            # Correct column mapping for yfinance
            # yfinance returns columns in different order sometimes
            if 'Date' in data.columns:
                data.rename(columns={
                    'Date': 'Date',
                    'Open': 'Open',
                    'High': 'High',
                    'Low': 'Low',
                    'Close': 'Close',
                    'Volume': 'Volume'
                }, inplace=True)
            
            # Ensure we have the required columns
            required_cols = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
            if all(col in data.columns for col in required_cols):
                data = data[required_cols]
            else:
                print(f"    ✗ Missing required columns for {stock}")
                continue
            
            # Handle missing values
            data = data.ffill()
            data = data.bfill()
            data.dropna(inplace=True)
            
            if len(data) < 10:
                print(f"    ✗ Insufficient data ({len(data)} rows), skipping...")
                continue
            
            # Convert date to string format
            data['Date'] = pd.to_datetime(data['Date']).dt.strftime('%Y-%m-%d')
            
            # Calculate metrics
            data['Daily Return'] = (data['Close'] - data['Open']) / data['Open']
            data['MA7'] = data['Close'].rolling(window=7).mean()
            data['MA20'] = data['Close'].rolling(window=20).mean()
            data['Volatility'] = (data['High'] - data['Low']) / data['Open']
            
            # Use min_periods=1 to avoid all NaN when data is less than 252 days
            window_size = min(252, len(data))
            data['52_Week_High'] = data['Close'].rolling(window=window_size, min_periods=1).max()
            data['52_Week_Low'] = data['Close'].rolling(window=window_size, min_periods=1).min()
            data['Price_Position'] = (data['Close'] - data['52_Week_Low']) / (data['52_Week_High'] - data['52_Week_Low'])
            
            # RSI (Relative Strength Index)
            delta = data['Close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            data['RSI'] = 100 - (100 / (1 + rs))
            
            data['Symbol'] = stock.replace(".NS", "")
            data.dropna(inplace=True)
            
            if len(data) == 0:
                print(f"    ✗ No data after calculations for {stock}")
                continue
            
            data.to_sql("stock_data", conn, if_exists="append", index=False)
            print(f"    ✓ Loaded {len(data)} records for {stock.replace('.NS', '')}")
            
            # Be nice to the API
            time.sleep(0.5)
            
        except Exception as e:
            print(f"    ✗ Error downloading {stock}: {e}")
            continue
    
    conn.close()
    
    # Verify data was loaded
    conn = sqlite3.connect("stocks.db")
    count = conn.execute("SELECT COUNT(*) FROM stock_data").fetchone()[0]
    conn.close()
    
    if count > 0:
        print(f"✅ Data loading complete! Total records: {count}")
    else:
        print("❌ No data was loaded! Please check your internet connection.")

# Load data on startup
print("🚀 Starting Stock Data Intelligence Dashboard...")
load_data()
print("✨ Server is ready!")

@app.get("/")
def home():
    return {
        "message": "Stock Data Intelligence Dashboard API",
        "version": "1.0",
        "status": "running",
        "endpoints": {
            "companies": "/companies",
            "stock_data": "/data/{symbol}",
            "summary": "/summary/{symbol}",
            "compare": "/compare?symbol1=INFY&symbol2=TCS",
            "top_gainers": "/top-gainers",
            "volatility": "/volatility/{symbol}",
            "correlation": "/correlation",
            "statistics": "/stats/{symbol}"
        }
    }

@app.get("/companies")
def get_companies():
    """Returns a list of all available companies"""
    conn = get_connection()
    try:
        companies = pd.read_sql_query("SELECT DISTINCT Symbol FROM stock_data ORDER BY Symbol", conn)
        conn.close()
        return companies['Symbol'].tolist()
    except Exception as e:
        conn.close()
        return []

@app.get("/data/{symbol}")
def get_data(
    symbol: str, 
    days: int = Query(30, ge=1, le=365, description="Number of days to return"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Returns last N days of stock data for a symbol"""
    conn = get_connection()
    
    # Build query with filters
    query = 'SELECT Date, Close, High, Low, Open, Volume, "Daily Return" as Daily_Return, MA7, MA20, Volatility, Symbol FROM stock_data WHERE Symbol = ?'
    params = [symbol]
    
    if start_date:
        query += " AND Date >= ?"
        params.append(start_date)
    if end_date:
        query += " AND Date <= ?"
        params.append(end_date)
    
    query += " ORDER BY Date DESC LIMIT ?"
    params.append(days)
    
    df = pd.read_sql_query(query, conn, params=params)
    conn.close()
    
    if df.empty:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    
    return df.to_dict(orient="records")

@app.get("/summary/{symbol}")
def get_summary(symbol: str):
    """Returns 52-week high, low, average close, and other metrics"""
    conn = get_connection()
    
    # Get all data for this symbol
    df = pd.read_sql_query("SELECT * FROM stock_data WHERE Symbol = ? ORDER BY Date DESC", conn, params=[symbol])
    conn.close()
    
    if df.empty:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    
    latest = df.iloc[0]
    year_data = df.head(252)  # Last 252 trading days (~1 year)
    
    # Calculate YTD return safely
    ytd_return = 0
    if len(df) > 1:
        first_price = df.iloc[-1]['Close']
        if first_price > 0:
            ytd_return = ((df.iloc[0]['Close'] - first_price) / first_price) * 100
    
    # Safely get RSI value
    rsi_value = 50
    if 'RSI' in latest and pd.notna(latest['RSI']):
        rsi_value = float(latest['RSI'])
    
    # Safely get Price Position
    price_position = 0.5
    if 'Price_Position' in latest and pd.notna(latest['Price_Position']):
        price_position = float(latest['Price_Position'])
    
    return {
        "symbol": symbol,
        "current_price": float(latest['Close']),
        "52_week_high": float(year_data['Close'].max()),
        "52_week_low": float(year_data['Close'].min()),
        "average_close": float(df['Close'].mean()),
        "average_volume": float(df['Volume'].mean()),
        "total_return_ytd": float(ytd_return),
        "current_volatility": float(latest['Volatility'] * 100) if pd.notna(latest['Volatility']) else 0,
        "current_rsi": rsi_value,
        "price_position": price_position
    }

@app.get("/volatility/{symbol}")
def get_volatility(symbol: str):
    """Returns volatility analysis for a symbol"""
    conn = get_connection()
    
    df = pd.read_sql_query("SELECT Date, Volatility FROM stock_data WHERE Symbol = ? ORDER BY Date DESC", conn, params=[symbol])
    conn.close()
    
    if df.empty:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    
    # Calculate trend safely
    recent_avg = df.head(5)['Volatility'].mean() if len(df) >= 5 else df['Volatility'].mean()
    older_avg = df.tail(5)['Volatility'].mean() if len(df) >= 5 else df['Volatility'].mean()
    
    return {
        "symbol": symbol,
        "avg_volatility": float(df['Volatility'].mean() * 100),
        "max_volatility": float(df['Volatility'].max() * 100),
        "min_volatility": float(df['Volatility'].min() * 100),
        "recent_volatility": float(recent_avg * 100),
        "volatility_trend": "Increasing" if recent_avg > older_avg else "Decreasing"
    }

@app.get("/compare")
def compare(
    symbol1: str,
    symbol2: str,
    period: str = Query("30d", pattern="^(30d|90d|1y)$", description="Time period for comparison")
):
    """Compare two stocks' performance"""
    conn = get_connection()
    
    # Map period to days
    days_map = {"30d": 30, "90d": 90, "180d": 180, "1y": 252}
    days = days_map.get(period, 30)
    
    df1 = pd.read_sql_query('SELECT Date, Close, "Daily Return" as Daily_Return FROM stock_data WHERE Symbol = ? ORDER BY Date DESC LIMIT ?', 
                           conn, params=[symbol1, days])
    df2 = pd.read_sql_query('SELECT Date, Close, "Daily Return" as Daily_Return FROM stock_data WHERE Symbol = ? ORDER BY Date DESC LIMIT ?', 
                           conn, params=[symbol2, days])
    conn.close()
    
    if df1.empty or df2.empty:
        raise HTTPException(status_code=404, detail="One or both symbols not found")
    
    # Calculate correlation
    df1 = df1.sort_values('Date')
    df2 = df2.sort_values('Date')
    
    # Normalize prices for comparison (start at 100)
    if len(df1) > 0 and len(df2) > 0:
        df1['Normalized'] = (df1['Close'] / df1['Close'].iloc[0]) * 100
        df2['Normalized'] = (df2['Close'] / df2['Close'].iloc[0]) * 100
        
        # Calculate returns correlation
        correlation = df1['Daily_Return'].corr(df2['Daily_Return']) if len(df1) == len(df2) else 0
    else:
        correlation = 0
    
    return {
        "symbol1": {
            "name": symbol1,
            "avg_daily_return": float(df1['Daily_Return'].mean() * 100) if not df1.empty else 0,
            "total_return": float(((df1['Close'].iloc[0] - df1['Close'].iloc[-1]) / df1['Close'].iloc[-1]) * 100) if len(df1) > 1 else 0,
            "normalized_prices": df1[['Date', 'Normalized']].to_dict(orient="records") if 'Normalized' in df1 else []
        },
        "symbol2": {
            "name": symbol2,
            "avg_daily_return": float(df2['Daily_Return'].mean() * 100) if not df2.empty else 0,
            "total_return": float(((df2['Close'].iloc[0] - df2['Close'].iloc[-1]) / df2['Close'].iloc[-1]) * 100) if len(df2) > 1 else 0,
            "normalized_prices": df2[['Date', 'Normalized']].to_dict(orient="records") if 'Normalized' in df2 else []
        },
        "correlation": float(correlation) if not pd.isna(correlation) else 0,
        "better_performer": symbol1 if df1['Daily_Return'].mean() > df2['Daily_Return'].mean() else symbol2
    }

@app.get("/top-gainers")
def top_gainers(limit: int = Query(5, ge=1, le=10, description="Number of top gainers to return")):
    """Returns top gainers and losers for the latest trading day"""
    conn = get_connection()
    
    # Get latest date for each symbol
    latest_dates = pd.read_sql_query("""
        SELECT Symbol, MAX(Date) as Latest_Date 
        FROM stock_data 
        GROUP BY Symbol
    """, conn)
    
    # Get latest data for each symbol
    results = []
    for _, row in latest_dates.iterrows():
        df = pd.read_sql_query('''
            SELECT Symbol, Date, Close, "Daily Return" as Daily_Return, Volume 
            FROM stock_data 
            WHERE Symbol = ? AND Date = ?
        ''', conn, params=[row['Symbol'], row['Latest_Date']])
        
        if not df.empty:
            daily_return = df.iloc[0]['Daily_Return']
            results.append({
                "symbol": df.iloc[0]['Symbol'],
                "date": df.iloc[0]['Date'],
                "price": float(df.iloc[0]['Close']),
                "daily_return": float(daily_return * 100) if not pd.isna(daily_return) else 0,
                "volume": int(df.iloc[0]['Volume'])
            })
    
    conn.close()
    
    # Sort by daily return
    results.sort(key=lambda x: x['daily_return'], reverse=True)
    
    return {
        "top_gainers": results[:limit],
        "top_losers": results[-limit:][::-1] if len(results) > limit else []
    }

@app.get("/correlation")
def get_correlation(symbols: str = Query("INFY,TCS", description="Comma-separated symbols to analyze correlation")):
    """Returns correlation matrix for given symbols"""
    symbol_list = [s.strip() for s in symbols.split(',')]
    conn = get_connection()
    
    # Get common dates
    dfs = {}
    for symbol in symbol_list:
        df = pd.read_sql_query('SELECT Date, "Daily Return" as Daily_Return FROM stock_data WHERE Symbol = ? ORDER BY Date', 
                              conn, params=[symbol])
        if not df.empty:
            dfs[symbol] = df.set_index('Date')['Daily_Return']
    
    conn.close()
    
    if len(dfs) < 2:
        return {
            "correlation_matrix": {},
            "highest_correlation": None
        }
    
    # Create correlation matrix
    returns_df = pd.DataFrame(dfs)
    correlation_matrix = returns_df.corr().round(2)
    
    # Find highest correlation
    max_corr = 0
    max_pair = None
    for i in range(len(symbol_list)):
        for j in range(i+1, len(symbol_list)):
            if symbol_list[i] in correlation_matrix and symbol_list[j] in correlation_matrix:
                corr = correlation_matrix.loc[symbol_list[i], symbol_list[j]]
                if not pd.isna(corr) and abs(corr) > max_corr:
                    max_corr = abs(corr)
                    max_pair = (symbol_list[i], symbol_list[j], corr)
    
    return {
        "correlation_matrix": correlation_matrix.to_dict() if not correlation_matrix.empty else {},
        "highest_correlation": {
            "symbol1": max_pair[0] if max_pair else None,
            "symbol2": max_pair[1] if max_pair else None,
            "correlation": max_pair[2] if max_pair else 0
        }
    }

@app.get("/stats/{symbol}")
def get_statistics(symbol: str):
    """Returns detailed statistics for a symbol"""
    conn = get_connection()
    df = pd.read_sql_query('SELECT * FROM stock_data WHERE Symbol = ? ORDER BY Date', conn, params=[symbol])
    conn.close()
    
    if df.empty:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    
    # Calculate additional statistics
    returns = df['Daily Return'].dropna()
    
    # Calculate Sharpe ratio safely
    sharpe_ratio = 0
    if returns.std() != 0:
        sharpe_ratio = returns.mean() / returns.std() * (252 ** 0.5)
    
    # Calculate max drawdown
    cumulative = (1 + returns).cumprod()
    running_max = cumulative.expanding().max()
    drawdown = (cumulative - running_max) / running_max
    max_drawdown = drawdown.min()
    
    return {
        "symbol": symbol,
        "statistics": {
            "mean_daily_return": float(returns.mean() * 100),
            "std_daily_return": float(returns.std() * 100),
            "sharpe_ratio": float(sharpe_ratio),
            "positive_days": int((returns > 0).sum()),
            "negative_days": int((returns < 0).sum()),
            "best_day": float(returns.max() * 100),
            "worst_day": float(returns.min() * 100),
            "max_drawdown": float(max_drawdown * 100) if not pd.isna(max_drawdown) else 0
        }
    }

if __name__ == "__main__":
    import uvicorn
    print("🌟 Starting server at http://0.0.0.0:8000")
    print("📚 API Documentation available at http://0.0.0.0:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
