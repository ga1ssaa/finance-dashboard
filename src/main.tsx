import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { FinanceProvider } from './state/FinanceProvider'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <FinanceProvider><App /></FinanceProvider>
    </BrowserRouter>
  </React.StrictMode>,
)