import AuthGate from './components/AuthGate'
import Dashboard from './components/Dashboard'
import './index.css'

export default function App() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  )
}
