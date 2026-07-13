import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import CheckIn from './components/CheckIn.jsx'
import { StoreProvider } from './store.jsx'
import './index.css'

// Tiny hash router: #/checkin is the public page members open from the QR
// code; everything else is the admin app.
const isCheckIn = () => window.location.hash.startsWith('#/checkin')
window.addEventListener('hashchange', () => window.location.reload())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isCheckIn() ? (
      <CheckIn />
    ) : (
      <StoreProvider>
        <App />
      </StoreProvider>
    )}
  </React.StrictMode>,
)
