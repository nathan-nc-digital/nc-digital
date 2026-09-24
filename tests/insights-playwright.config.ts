import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
// Serves the built dist folder (run npm run build first); every API is mocked in the spec.
export default defineConfig({testDir:'.',testMatch:'admin-insights.spec.ts',use:{baseURL:'http://127.0.0.1:4351'},webServer:{cwd:fileURLToPath(new URL('../dist',import.meta.url)),command:'python -m http.server 4351 --bind 127.0.0.1',url:'http://127.0.0.1:4351/admin/',reuseExistingServer:false,timeout:60000}});
