import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AuthenticatedApp from './components/AuthenticatedApp'
import { AuthProvider } from './state/AuthProvider'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider><AuthenticatedApp /></AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)