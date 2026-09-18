import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './', // 打包后经 file:// 加载，必须用相对路径引用资源
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
})
