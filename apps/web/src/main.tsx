import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { registerSW } from 'virtual:pwa-register'

import { App } from './App'
import './index.css'

// Deja la aplicación disponible sin internet. Si hay una versión nueva se
// aplica sola: una caja no debería tener que pulsar «actualizar».
registerSW({ immediate: true })

const root = document.getElementById('root')
if (!root) throw new Error('Falta el nodo raíz.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
