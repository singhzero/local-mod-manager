import { createApp } from 'vue'
import App from './App.vue'
import { bootstrap } from './store'
import './styles/global.css'

bootstrap().finally(() => {
  createApp(App).mount('#app')
})
