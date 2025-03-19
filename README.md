# Wander Cache

This is a [Next.js](https://nextjs.org) project that provides a robust caching layer for cryptocurrency and token price APIs, helping to work around rate limits and provide faster data access. It includes:

1. **CoinGecko API Caching** - For general cryptocurrency prices (Arweave, etc.)
2. **Botega (via ao) Caching** - For specific token prices within the Arweave ecosystem
3. **Health Dashboard** - UI to monitor API health and cached data freshness

## Getting Started

This project uses Upstash Redis REST API (serverless Redis) for caching cryptocurrency prices:

1. Create a free Redis database at [Upstash](https://upstash.com/)
2. From your Upstash dashboard, find your database and get the following values:
   - REST API URL (e.g., https://xxxx-xxxxx.upstash.io)
   - REST API Token
3. Update the `.env.local` file with these values:
   ```
   UPSTASH_REDIS_REST_URL=https://xxxx-xxxxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

This implementation uses Upstash's REST API client which is optimized for serverless environments. The Redis client includes retry logic to handle transient failures.

## Dashboard UI

The main page has been replaced with a health check dashboard that:

- Shows the status of CoinGecko and Botega APIs
- Displays current cryptocurrency and token prices
- Includes a historical price chart with selectable time periods
- Shows cache freshness indicators for all data (fresh/stale, age in seconds)
- Provides a form to check custom Botega token prices by ID

All sections load independently, so if one API is down, the others will still display correctly.

## Manual Updates

You can manually update cached prices with:

```bash
npm run update-prices
```

This forces a refresh of all tracked tokens regardless of cache status.

## Automatic Price Updates

This project includes automatic price updates that run every 5 minutes using Vercel Cron Jobs:

1. **CoinGecko prices**: The system automatically refreshes prices for cryptocurrencies listed in `TRACKED_CRYPTOS` array in `src/lib/priceService.ts`.
2. **Botega token prices**: The system refreshes prices for tokens listed in `TRACKED_BOTEGA_TOKENS` array in `src/lib/botegaService.ts`.
3. The cron job is configured in `vercel.json` to run every 5 minutes.
4. For security, the cron endpoint is protected with a secret token defined in `.env.local`.

When deploying to Vercel:

1. Make sure to set the `CRON_SECRET` environment variable to a secure random string.
2. Vercel will automatically execute the cron job based on the schedule.

## Important Implementation Notes

### Botega Integration

This project uses a robust approach to fetch token prices from Botega:

1. **Primary method**: Using `@permaweb/aoconnect` with browser polyfills:

   - Added comprehensive browser API polyfills for server environment

2. **Fallback method**: Direct HTTP requests to the AO API:
   - If the primary method fails, falls back to direct fetch requests
   - Ensures high availability even if there are issues with the library

The Botega price service:

- Fetches prices for specific token IDs using the AO protocol
- Caches them for 5 minutes in Redis (with 24-hour expiration)
- Provides cache metadata (freshness, age, timestamp) in API responses
- Automatically refreshes tracked tokens defined in `TRACKED_BOTEGA_TOKENS`
- Provides resilient error handling with cache fallbacks
- Supports custom token lookup via API and UI

## API Endpoints

### Price API

```
GET /api/price?symbol=arweave&currency=usd
```

Returns current price with cache metadata:
```json
{
  "symbol": "arweave",
  "currency": "usd",
  "price": 9.57,
  "fresh": true,
  "cachedAt": "2025-03-19T04:46:38.804Z",
  "cacheAge": 52,
  "timestamp": "2025-03-19T04:47:30.856Z"
}
```

### Botega API

```
GET /api/botega/prices?tokenIds=TOKEN_ID1,TOKEN_ID2
```

Returns prices for specified tokens with cache metadata:
```json
{
  "tokenIds": ["TOKEN_ID1", "TOKEN_ID2"],
  "prices": {
    "TOKEN_ID1": 6.95,
    "TOKEN_ID2": 24.81
  },
  "cacheInfo": {
    "TOKEN_ID1": {
      "fresh": true,
      "cachedAt": "2025-03-19T04:46:38.804Z",
      "cacheAge": 52
    },
    "TOKEN_ID2": {
      "fresh": true,
      "cachedAt": "2025-03-19T04:46:38.804Z",
      "cacheAge": 52
    }
  },
  "timestamp": "2025-03-19T04:47:30.856Z"
}
```

### Chart API

```
GET /api/chart?days=7&currency=usd
```

Returns historical price data with cache metadata.

## Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the dashboard.
