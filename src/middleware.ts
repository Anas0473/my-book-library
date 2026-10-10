import { clerkMiddleware } from '@clerk/astro/server';
import { defineMiddleware } from 'astro:middleware';
import { websiteAuthConfigured } from './lib/website-auth';

const authenticate = clerkMiddleware();

export const onRequest = defineMiddleware((context, next) =>
  websiteAuthConfigured() ? authenticate(context, next) : next(),
);
