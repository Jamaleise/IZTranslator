import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: { exclude: ['rt-client'] },
  
})
build: {

  /** If you set esmExternals to true, this plugins assumes that 
    all external dependencies are ES modules */

  commonjsOptions: {
     esmExternals: true 
  }
  optimizeDeps: { exclude: ['node_modules/rt-client'] }
}