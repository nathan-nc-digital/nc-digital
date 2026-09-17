import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({testDir:'.',testMatch:'admin-competitor-gaps.spec.ts',use:{baseURL:'http://127.0.0.1:4344'},...(process.env.GAPS_MANUAL_SERVER?{}:{webServer:{cwd:fileURLToPath(new URL('..',import.meta.url)),command:'node node_modules/astro/astro.js preview --host 127.0.0.1 --port 4344',url:'http://127.0.0.1:4344/admin/competitor-gaps/',reuseExistingServer:false,timeout:60000}})});
