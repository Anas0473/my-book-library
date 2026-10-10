// @ts-check

import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';
import clerk from '@clerk/astro';
import { loadEnv } from 'vite';

const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
const clerkEnabled = Boolean(env.PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);

// https://astro.build/config
export default defineConfig({
  site: 'https://www.myreadinglist.online',
  output: 'server',
  integrations: [sitemap(), ...(clerkEnabled ? [clerk()] : [])],
  adapter: vercel(),
});