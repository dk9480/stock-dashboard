import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from "chart.js";

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Title, Tooltip, Legend, Filler);

function App() {
  const [companies, setCompanies] = useState([]);
  const [selected, setSelected] = useState("INFY");
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [volatility, setVolatility] = useState(null);
  const [topGainers, setTopGainers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSymbol, setCompareSymbol] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [activeTab, setActiveTab] = useState("chart");

  // Fetch companies on mount
  useEffect(() => {
    fetchCompanies();
    fetchTopGainers();
  }, []); // Empty dependency array - runs once

  // Wrap fetch functions with useCallback to prevent recreation
  const fetchCompanies = useCallback(async () => {
    try {
      const res = await axios.get("http://127.0.0.1:8000/companies");
      setCompanies(res.data);
    } catch (err) {
      setError("Failed to fetch companies");
      console.error(err);
    }
  }, []);

  const fetchTopGainers = useCallback(async () => {
    try {
      const res = await axios.get("http://127.0.0.1:8000/top-gainers");
      setTopGainers(res.data);
    } catch (err) {
      console.error("Failed to fetch top gainers");
    }
  }, []);

  const fetchData = useCallback(async (symbol, daysCount) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`http://127.0.0.1:8000/data/${symbol}`, {
        params: { days: daysCount }
      });
      setData(res.data.reverse());
    } catch (err) {
      setError(`Failed to fetch data for ${symbol}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(async (symbol) => {
    try {
      const res = await axios.get(`http://127.0.0.1:8000/summary/${symbol}`);
      setSummary(res.data);
    } catch (err) {
      console.error("Failed to fetch summary");
    }
  }, []);

  const fetchVolatility = useCallback(async (symbol) => {
    try {
      const res = await axios.get(`http://127.0.0.1:8000/volatility/${symbol}`);
      setVolatility(res.data);
    } catch (err) {
      console.error("Failed to fetch volatility");
    }
  }, []);

  const fetchCompareData = useCallback(async (symbol1, symbol2) => {
    try {
      // const periodMap = { 30: "30d", 90: "90d", 180: "1y" };
      const periodMap = { 30: "30d", 90: "90d", 180: "180d" };
      const period = periodMap[days] || "30d";
      const res = await axios.get("http://127.0.0.1:8000/compare", {
        params: { 
          symbol1: symbol1, 
          symbol2: symbol2,
          period: period
        }
      });
      setCompareData(res.data);
    } catch (err) {
      console.error("Failed to fetch compare data");
    }
  }, [days]); // days is a dependency

  // Fetch data when selected or days change
  useEffect(() => {
    if (selected) {
      fetchData(selected, days);
      fetchSummary(selected);
      fetchVolatility(selected);
    }
  }, [selected, days, fetchData, fetchSummary, fetchVolatility]);

  // Fetch compare data when compare mode is active
  useEffect(() => {
    if (compareMode && compareSymbol && selected) {
      fetchCompareData(selected, compareSymbol);
    } else if (!compareMode) {
      setCompareData(null); // Clear compare data when exiting compare mode
    }
  // }, [compareMode, compareSymbol, selected, fetchCompareData]);
  }, [compareMode, compareSymbol, selected, fetchCompareData, days]); // ✅ 'days' added


  const chartData = {
    labels: data.map(d => d.Date),
    datasets: [
      {
        label: `${selected} - Close Price (₹)`,
        data: data.map(d => d.Close),
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.4
      },
      {
        label: "7-Day MA",
        data: data.map(d => d.MA7),
        borderColor: "rgb(234, 179, 8)",
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 0
      },
      {
        label: "20-Day MA",
        data: data.map(d => d.MA20),
        borderColor: "rgb(168, 85, 247)",
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 0
      }
    ]
  };

  const compareChartData = compareData ? {
    labels: compareData.symbol1.normalized_prices?.map(p => p.Date) || [],
    datasets: [
      {
        label: `${compareData.symbol1?.name || ''} (Normalized)`,
        data: compareData.symbol1.normalized_prices?.map(p => p.Normalized) || [],
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.4
      },
      {
        label: `${compareData.symbol2?.name || ''} (Normalized)`,
        data: compareData.symbol2.normalized_prices?.map(p => p.Normalized) || [],
        borderColor: "rgb(239, 68, 68)",
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        fill: true,
        tension: 0.4
      }
    ]
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: `${selected} - Stock Price Trend (Last ${days} Days)`
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      }
    },
    scales: {
      y: {
        title: {
          display: true,
          text: 'Price (₹)'
        }
      },
      x: {
        title: {
          display: true,
          text: 'Date'
        }
      }
    }
  };

  const getRSIStatus = (rsi) => {
    if (rsi > 70) return { text: "Overbought", color: "#ef4444" };
    if (rsi < 30) return { text: "Oversold", color: "#10b981" };
    return { text: "Neutral", color: "#f59e0b" };
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>
      
      {/* LEFT PANEL - Companies List */}
      <div style={{ 
        width: "280px", 
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        color: "white",
        padding: "20px",
        overflowY: "auto"
      }}>
        <h2 style={{ marginTop: 0, fontSize: "24px" }}>📊 Stock Dashboard</h2>
        
        <div style={{ marginTop: "30px" }}>
          <h3>Companies</h3>
          {companies.map((c) => (
            <button
              key={c}
              onClick={() => {
                setSelected(c);
                setCompareMode(false);
              }}
              style={{
                width: "100%",
                padding: "12px",
                marginBottom: "8px",
                background: selected === c ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: "8px",
                color: "white",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "14px",
                fontWeight: selected === c ? "bold" : "normal",
                transition: "all 0.3s"
              }}
              onMouseEnter={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
              onMouseLeave={(e) => e.target.style.background = selected === c ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Date Filter */}
        <div style={{ marginTop: "30px" }}>
          <h3>Time Period</h3>
          <div style={{ display: "flex", gap: "10px" }}>
            {[30, 90, 180].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  flex: 1,
                  padding: "8px",
                  background: days === d ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: "6px",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: days === d ? "bold" : "normal"
                }}
              >
                {d} Days
              </button>
            ))}
          </div>
        </div>

        {/* Compare Mode Toggle */}
        <div style={{ marginTop: "30px" }}>
          <h3>Compare Stocks</h3>
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              if (!compareMode && !compareSymbol) {
                const firstOther = companies.find(c => c !== selected) || companies[0];
                setCompareSymbol(firstOther);
              }
            }}
            style={{
              width: "100%",
              padding: "10px",
              background: compareMode ? "#ef4444" : "#10b981",
              border: "none",
              borderRadius: "8px",
              color: "white",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            {compareMode ? "Exit Compare Mode" : "🔍 Compare Stocks"}
          </button>
          
          {compareMode && (
            <select
              value={compareSymbol || ""}
              onChange={(e) => setCompareSymbol(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                marginTop: "10px",
                borderRadius: "6px",
                background: "rgba(255,255,255,0.1)",
                color: "white",
                border: "1px solid rgba(255,255,255,0.3)"
              }}
            >
              {companies.filter(c => c !== selected).map(c => (
                <option key={c} value={c} style={{ color: "black" }}>{c}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* RIGHT PANEL - Main Content */}
      <div style={{ flex: 1, padding: "30px", background: "#f9fafb", overflowY: "auto" }}>
        
        {/* Error Display */}
        {error && (
          <div style={{ 
            color: "#dc2626", 
            padding: "15px", 
            background: "#fee", 
            borderRadius: "8px",
            marginBottom: "20px"
          }}>
            ⚠️ Error: {error}
          </div>
        )}

        {/* Header with Summary Stats */}
        {summary && (
          <div style={{
            background: "white",
            borderRadius: "12px",
            padding: "20px",
            marginBottom: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
          }}>
            <h1 style={{ margin: "0 0 10px 0", color: "#1f2937" }}>{selected}</h1>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "15px" }}>
              <div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>Current Price</div>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#1f2937" }}>₹{summary.current_price?.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>52-Week Range</div>
                <div style={{ fontSize: "16px", fontWeight: "bold", color: "#1f2937" }}>
                  ₹{summary['52_week_low']?.toFixed(2)} - ₹{summary['52_week_high']?.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>YTD Return</div>
                <div style={{ fontSize: "20px", fontWeight: "bold", color: summary.total_return_ytd >= 0 ? "#10b981" : "#ef4444" }}>
                  {summary.total_return_ytd?.toFixed(2)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>RSI (14)</div>
                <div style={{ fontSize: "20px", fontWeight: "bold", color: getRSIStatus(summary.current_rsi).color }}>
                  {summary.current_rsi?.toFixed(1)}
                  <span style={{ fontSize: "12px", marginLeft: "5px" }}>({getRSIStatus(summary.current_rsi).text})</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", borderBottom: "2px solid #e5e7eb" }}>
          {["chart", "compare", "volatility", "insights"].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 20px",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
                color: activeTab === tab ? "#3b82f6" : "#6b7280",
                cursor: "pointer",
                fontWeight: activeTab === tab ? "bold" : "normal"
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "chart" && (
          <div>
            {loading && <p>Loading chart data...</p>}
            {!loading && data.length > 0 && !compareMode && (
              <div style={{ background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                <Line data={chartData} options={chartOptions} />
              </div>
            )}
            
            {compareMode && compareChartData && (
              <div>
                <div style={{ background: "white", padding: "20px", borderRadius: "12px", marginBottom: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                  <Line data={compareChartData} options={{
                    ...chartOptions,
                    plugins: {
                      ...chartOptions.plugins,
                      title: {
                        display: true,
                        text: `Comparison: ${selected} vs ${compareSymbol} (Normalized to 100)`
                      }
                    },
                    scales: {
                      y: {
                        title: {
                          display: true,
                          text: 'Normalized Price (Base 100)'
                        }
                      }
                    }
                  }} />
                </div>
                
                {compareData && (
                  <div style={{ background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                    <h3>Comparison Summary</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "15px" }}>
                      <div>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>Correlation</div>
                        <div style={{ fontSize: "24px", fontWeight: "bold" }}>{compareData.correlation?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>Better Performer</div>
                        <div style={{ fontSize: "18px", fontWeight: "bold", color: "#10b981" }}>{compareData.better_performer}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>Performance Difference</div>
                        <div style={{ fontSize: "18px", fontWeight: "bold" }}>
                          {(compareData.symbol1?.total_return - compareData.symbol2?.total_return)?.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "volatility" && volatility && (
          <div style={{ background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <h3>📈 Volatility Analysis</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px", marginTop: "20px" }}>
              <div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>Average Volatility</div>
                <div style={{ fontSize: "24px", fontWeight: "bold" }}>{volatility.avg_volatility?.toFixed(2)}%</div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>Recent Volatility (5 days)</div>
                <div style={{ fontSize: "20px", fontWeight: "bold", color: volatility.volatility_trend === "Increasing" ? "#ef4444" : "#10b981" }}>
                  {volatility.recent_volatility?.toFixed(2)}%
                  <span style={{ fontSize: "12px", marginLeft: "5px" }}>({volatility.volatility_trend})</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>Volatility Range</div>
                <div>{volatility.min_volatility?.toFixed(2)}% - {volatility.max_volatility?.toFixed(2)}%</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "insights" && summary && (
          <div style={{ background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <h3>💡 Key Insights</h3>
            <div style={{ marginTop: "20px" }}>
              <div style={{ marginBottom: "15px", padding: "10px", background: "#f3f4f6", borderRadius: "8px" }}>
                <strong>Price Position:</strong> Stock is at {((summary.price_position || 0.5) * 100).toFixed(1)}% of its 52-week range
                <div style={{ 
                  width: "100%", 
                  height: "8px", 
                  background: "#e5e7eb", 
                  borderRadius: "4px", 
                  marginTop: "8px",
                  overflow: "hidden"
                }}>
                  <div style={{ 
                    width: `${((summary.price_position || 0.5) * 100)}%`, 
                    height: "100%", 
                    background: "#3b82f6",
                    borderRadius: "4px"
                  }} />
                </div>
              </div>
              <div style={{ marginBottom: "15px", padding: "10px", background: "#f3f4f6", borderRadius: "8px" }}>
                <strong>Volume Analysis:</strong> Average volume: {(summary.average_volume / 1000000).toFixed(2)}M shares
              </div>
              <div style={{ marginBottom: "15px", padding: "10px", background: "#f3f4f6", borderRadius: "8px" }}>
                <strong>RSI Analysis:</strong> {getRSIStatus(summary.current_rsi).text} condition suggests {
                  summary.current_rsi > 70 ? "potential price correction ahead" : 
                  summary.current_rsi < 30 ? "potential price rebound" : "stable trading conditions"
                }
              </div>
            </div>
          </div>
        )}

        {/* Top Gainers/Losers Section */}
        {topGainers && (
          <div style={{ marginTop: "30px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              <h3 style={{ color: "#10b981", marginTop: 0 }}>🚀 Top Gainers</h3>
              {topGainers.top_gainers?.map(gainer => (
                <div key={gainer.symbol} style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  padding: "10px 0",
                  borderBottom: "1px solid #e5e7eb"
                }}>
                  <strong>{gainer.symbol}</strong>
                  <span style={{ color: "#10b981", fontWeight: "bold" }}>+{gainer.daily_return?.toFixed(2)}%</span>
                </div>
              ))}
            </div>
            
            <div style={{ background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              <h3 style={{ color: "#ef4444", marginTop: 0 }}>📉 Top Losers</h3>
              {topGainers.top_losers?.map(loser => (
                <div key={loser.symbol} style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  padding: "10px 0",
                  borderBottom: "1px solid #e5e7eb"
                }}>
                  <strong>{loser.symbol}</strong>
                  <span style={{ color: "#ef4444", fontWeight: "bold" }}>{loser.daily_return?.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
