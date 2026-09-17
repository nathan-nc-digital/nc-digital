import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({testDir:'.',testMatch:'admin-emd-finder.spec.ts',use:{baseURL:'http://127.0.0.1:4340'},webServer:{cwd:fileURLToPath(new URL('..',import.meta.url)),command:'node node_modules/astro/astro.js preview --host 127.0.0.1 --port 4340',url:'http://127.0.0.1:4340/admin/emd-finder/',reuseExistingServer:false,timeout:60000}});
