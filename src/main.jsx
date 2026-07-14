import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import CheckIn from './components/CheckIn.jsx'
import Login from './components/Login.jsx'
import { StoreProvider } from './store.jsx'
import { AuthProvider, useAuth } from './auth.jsx'
import './index.css'

// Tiny hash router: #/checkin is the public page members open from the QR
// code (no login); everything else is the logged-in app.
const isCheckIn = () => window.location.hash.startsWith('#/checkin')
window.addEventListener('hashchange', () => window.location.reload())

function Root() {
  const { loading, session } = useAuth()
  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    )
  }
  if (!session) return <Login />
  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isCheckIn() ? (
      <CheckIn />
    ) : (
      <AuthProvider>
        <Root />
      </AuthProvider>
    )}
  </React.StrictMode>,
)
