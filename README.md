This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app). It includes a cryptocurrency price caching service to work around API rate limits for:

1. CoinGecko API - For general cryptocurrency prices (Arweave, etc.)
2. Botega (via ao) - For specific token prices within the Arweave ecosystem

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

This implementation uses Upstash's REST API client which is optimized for serverless environments.

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
- Caches them for 5 minutes in Redis
- Automatically refreshes tracked tokens defined in `TRACKED_BOTEGA_TOKENS`
- Provides resilient error handling with cache fallbacks

````

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
````

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
