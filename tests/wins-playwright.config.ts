import { defineConfig } from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({testDir:'.',testMatch:'admin-seo-quick-wins.spec.ts',use:{baseURL:'http://127.0.0.1:4342'},webServer:{cwd:fileURLToPath(new URL('..',import.meta.url)),command:'node node_modules/astro/astro.js preview --host 127.0.0.1 --port 4342',url:'http://127.0.0.1:4342/admin/seo-quick-wins/',reuseExistingServer:false,timeout:60000}});
