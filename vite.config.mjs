import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    // 关掉构建前清空：某些环境（含本项目所在的沙箱）会拦截批量删除导致构建失败。
    // 需要干净产物时先手动删一次 dist 目录再跑 npm run build。
    emptyOutDir: false
  },
  server: {
    port: 5178
  }
})
