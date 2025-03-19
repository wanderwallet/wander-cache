"use client";

import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { CHART_PERIODS } from "@/lib/priceService";

interface ChartDataProps {
  chartData: {
    prices?: [number, number][];
    cacheAge?: number;
    fresh?: boolean;
  } | null;
}

interface CacheInfo {
  fresh: boolean;
  cachedAt: string;
  cacheAge: number;
}

// Client component for Chart
const PriceChart = ({ chartData }: ChartDataProps) => {
  if (!chartData || !chartData.prices || chartData.prices.length === 0) {
    return (
      <div className={styles.chartPlaceholder}>No chart data available</div>
    );
  }

  const cacheInfo =
    chartData.cacheAge !== undefined ? (
      <div className={styles.chartCacheInfo}>
        <span className={chartData.fresh ? styles.fresh : styles.stale}>
          {chartData.fresh ? "Fresh" : "Stale"}
        </span>{" "}
        ({chartData.cacheAge}s old)
      </div>
    ) : null;

  // Format date for x-axis labels
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // Calculate chart dimensions
  const width = 600;
  const height = 200;
  const padding = 40;
  const chartWidth = width - 2 * padding;
  const chartHeight = height - 2 * padding;

  // Extract price data
  const prices = chartData.prices;

  // Find min and max values for scaling
  const minPrice = Math.min(...prices.map((p) => p[1]));
  const maxPrice = Math.max(...prices.map((p) => p[1]));
  const priceRange = maxPrice - minPrice;

  // Time range
  const minTime = prices[0][0];
  const maxTime = prices[prices.length - 1][0];
  const timeRange = maxTime - minTime;

  // Generate path for price line
  const points = prices.map(([time, price]) => {
    const x = padding + ((time - minTime) / timeRange) * chartWidth;
    const y =
      height - padding - ((price - minPrice) / priceRange) * chartHeight;
    return `${x},${y}`;
  });

  const path = `M ${points.join(" L ")}`;

  // Generate x-axis tick marks (select only a few points for clarity)
  const numTicks = 5;
  const xTicks = [];
  for (let i = 0; i < numTicks; i++) {
    const dataIndex = Math.floor((i / (numTicks - 1)) * (prices.length - 1));
    const [time] = prices[dataIndex];
    const x = padding + ((time - minTime) / timeRange) * chartWidth;
    xTicks.push({ x, label: formatDate(time) });
  }

  // Generate y-axis tick marks
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const value = minPrice + (i / 4) * priceRange;
    const y = height - padding - (i / 4) * chartHeight;
    yTicks.push({ y, label: `$${value.toFixed(2)}` });
  }

  return (
    <div className={styles.chartContainer}>
      {cacheInfo}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={styles.chart}
      >
        {/* X and Y axes */}
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="#888"
        />
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={height - padding}
          stroke="#888"
        />

        {/* X-axis ticks */}
        {xTicks.map((tick, i) => (
          <g key={`x-tick-${i}`}>
            <line
              x1={tick.x}
              y1={height - padding}
              x2={tick.x}
              y2={height - padding + 5}
              stroke="#888"
            />
            <text
              x={tick.x}
              y={height - padding + 20}
              textAnchor="middle"
              fontSize="10"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Y-axis ticks */}
        {yTicks.map((tick, i) => (
          <g key={`y-tick-${i}`}>
            <line
              x1={padding - 5}
              y1={tick.y}
              x2={padding}
              y2={tick.y}
              stroke="#888"
            />
            <text x={padding - 8} y={tick.y + 4} textAnchor="end" fontSize="10">
              {tick.label}
            </text>
          </g>
        ))}

        {/* Price line */}
        <path d={path} fill="none" stroke="#3498db" strokeWidth="2" />
      </svg>
    </div>
  );
};

// Server Component
export default function Home() {
  // Separate state for each API section
  const [chartPeriod, setChartPeriod] = useState("7");

  // CoinGecko state
  const [arweavePrice, setArweavePrice] = useState(null);
  const [coinGeckoStatus, setCoinGeckoStatus] = useState("loading");
  const [coinGeckoCacheInfo, setCoinGeckoCacheInfo] =
    useState<CacheInfo | null>(null);

  // Botega state
  const [botegaPrices, setBotegaPrices] = useState<
    Record<string, number | null>
  >({});
  const [botegaStatus, setBotegaStatus] = useState("loading");
  const [botegaCacheInfo, setBotegaCacheInfo] = useState<
    Record<string, CacheInfo>
  >({});
  const [customTokenId, setCustomTokenId] = useState("");
  const [isLoadingCustomToken, setIsLoadingCustomToken] = useState(false);

  // Chart state
  const [chartData, setChartData] = useState(null);
  const [chartLoading, setChartLoading] = useState(true);

  // Fetch CoinGecko price data independently
  useEffect(() => {
    async function fetchPriceData() {
      try {
        const response = await fetch("/api/price?symbol=arweave&currency=usd");
        const data = await response.json();

        setArweavePrice(data.price);
        setCoinGeckoStatus(data.price ? "healthy" : "error");
        setCoinGeckoCacheInfo({
          fresh: data.fresh,
          cachedAt: data.cachedAt,
          cacheAge: data.cacheAge,
        });
      } catch (error) {
        console.error("Error fetching CoinGecko price:", error);
        setCoinGeckoStatus("error");
      }
    }

    fetchPriceData();
  }, []);

  // Fetch Botega prices independently
  useEffect(() => {
    async function fetchBotegaData() {
      try {
        const tokenIds = [
          "xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10",
          "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc",
          "NG-0lVX882MG5nhARrSzyprEK6ejonHpdUmaaMPsHE8",
        ];

        const response = await fetch(
          "/api/botega/prices?tokenIds=" + tokenIds.join(",")
        );
        const data = await response.json();

        const hasValidPrice =
          data.prices &&
          Object.values(data.prices).some((price) => price !== null);

        setBotegaPrices(data.prices || {});
        setBotegaCacheInfo(data.cacheInfo || {});
        setBotegaStatus(hasValidPrice ? "healthy" : "error");
      } catch (error) {
        console.error("Error fetching Botega prices:", error);
        setBotegaStatus("error");
      }
    }

    fetchBotegaData();
  }, []);

  // Fetch chart data independently, depends on period selection
  useEffect(() => {
    async function fetchChartData() {
      setChartLoading(true);
      try {
        const response = await fetch(`/api/chart?days=${chartPeriod}`);
        const data = await response.json();

        setChartData(data.data || null);
      } catch (error) {
        console.error("Error fetching chart data:", error);
        setChartData(null);
      } finally {
        setChartLoading(false);
      }
    }

    fetchChartData();
  }, [chartPeriod]);

  const handlePeriodChange = (period: string) => {
    setChartPeriod(period);
  };

  const handleCustomTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomTokenId(e.target.value);
  };

  const handleCustomTokenSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();
    if (!customTokenId.trim()) return;

    setIsLoadingCustomToken(true);
    try {
      // Fetch price for the custom token
      const response = await fetch(
        `/api/botega/prices?tokenIds=${customTokenId.trim()}`
      );
      const data = await response.json();

      console.log("Custom token data:", data); // Log the response for debugging

      // Merge the new data with existing data
      if (data.prices && data.cacheInfo) {
        setBotegaPrices((prev) => ({
          ...prev,
          ...data.prices,
        }));

        setBotegaCacheInfo((prev) => ({
          ...prev,
          ...data.cacheInfo,
        }));
      } else {
        console.error("Invalid data format from API:", data);
      }

      // Clear the input field after successful fetch
      setCustomTokenId("");
    } catch (error) {
      console.error("Error fetching custom token:", error);
    } finally {
      setIsLoadingCustomToken(false);
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Wander Cache API Health</h1>

        <div className={styles.statusContainer}>
          <div className={styles.statusItem}>
            <h2>CoinGecko API</h2>
            <div
              className={`${styles.statusIndicator} ${styles[coinGeckoStatus]}`}
            >
              {coinGeckoStatus.toUpperCase()}
            </div>
            {arweavePrice && (
              <p>
                Arweave Price: ${arweavePrice}
                {coinGeckoCacheInfo && (
                  <span className={styles.cacheInfo}>
                    <br />
                    <span
                      className={
                        coinGeckoCacheInfo.fresh ? styles.fresh : styles.stale
                      }
                    >
                      {coinGeckoCacheInfo.fresh ? "Fresh" : "Stale"}
                    </span>{" "}
                    ({coinGeckoCacheInfo.cacheAge}s old)
                  </span>
                )}
              </p>
            )}
          </div>

          <div className={styles.statusItem}>
            <h2>Botega API</h2>
            <div
              className={`${styles.statusIndicator} ${styles[botegaStatus]}`}
            >
              {botegaStatus.toUpperCase()}
            </div>

            {/* Custom token form */}
            <form
              onSubmit={handleCustomTokenSubmit}
              className={styles.tokenForm}
            >
              <input
                type="text"
                value={customTokenId}
                onChange={handleCustomTokenChange}
                placeholder="Enter Botega token ID"
                className={styles.tokenInput}
                disabled={isLoadingCustomToken}
              />
              <button
                type="submit"
                className={styles.tokenButton}
                disabled={isLoadingCustomToken}
              >
                {isLoadingCustomToken ? "Loading..." : "Check Price"}
              </button>
            </form>

            <div className={styles.tokenPrices}>
              {Object.entries(botegaPrices).map(([tokenId, price]) => {
                const cacheInfo = botegaCacheInfo?.[tokenId];
                return (
                  <p key={tokenId}>
                    Token: {tokenId.substring(0, 8)}...
                    {tokenId.substring(tokenId.length - 4)}
                    <br />
                    Price:{" "}
                    {price !== null ? `$${Number(price).toFixed(6)}` : "N/A"}
                    {cacheInfo && (
                      <>
                        <br />
                        <span className={styles.cacheInfo}>
                          <span
                            className={
                              cacheInfo.fresh ? styles.fresh : styles.stale
                            }
                          >
                            {cacheInfo.fresh ? "Fresh" : "Stale"}
                          </span>{" "}
                          ({cacheInfo.cacheAge}s old)
                        </span>
                      </>
                    )}
                  </p>
                );
              })}
            </div>
          </div>
        </div>

        <div className={styles.chartSection}>
          <h2>Arweave Price Chart</h2>
          <div className={styles.periodSelector}>
            {Object.entries(CHART_PERIODS).map(([days, label]) => (
              <button
                key={days}
                onClick={() => handlePeriodChange(days)}
                className={`${styles.periodButton} ${
                  chartPeriod === days ? styles.active : ""
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {chartLoading ? (
            <div className={styles.loader}>Loading chart data...</div>
          ) : (
            <PriceChart chartData={chartData} />
          )}
        </div>
      </main>
    </div>
  );
}
