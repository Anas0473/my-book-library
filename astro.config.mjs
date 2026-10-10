// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import vercel from '@astrojs/vercel';
import clerk from '@clerk/astro';
import { loadEnv } from 'vite';

const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
const clerkEnabled = Boolean(env.PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);

// https://astro.build/config
export default defineConfig({
  site: 'https://www.myreadinglist.online',
  output: 'server',
  integrations: [mdx(), sitemap(), ...(clerkEnabled ? [clerk()] : [])],

  fonts: [
      {
          provider: fontProviders.local(),
          name: 'Atkinson',
          cssVariable: '--font-atkinson',
          fallbacks: ['sans-serif'],
          options: {
              variants: [
                  {
                      src: ['./src/assets/fonts/atkinson-regular.woff'],
                      weight: 400,
                      style: 'normal',
                      display: 'swap',
                  },
                  {
                      src: ['./src/assets/fonts/atkinson-bold.woff'],
                      weight: 700,
                      style: 'normal',
                      display: 'swap',
                  },
              ],
          },
      },
    ],

  adapter: vercel(),
});