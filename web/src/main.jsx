import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

if (new URLSearchParams(location.search).has('admin')) {
  location.replace(new URL('admin.html', location.href))
} else createRoot(document.getElementById('root')).render(<App />)
