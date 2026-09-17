import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({testDir:'.',testMatch:'admin-analytics-reports.spec.ts',use:{baseURL:'http://127.0.0.1:4343'},webServer:{cwd:fileURLToPath(new URL('..',import.meta.url)),command:'node node_modules/astro/astro.js preview --host 127.0.0.1 --port 4343',url:'http://127.0.0.1:4343/admin/analytics-reports/',reuseExistingServer:false,timeout:60000}});
