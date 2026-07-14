import { useState, useEffect } from 'react';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import ToastContainer from './components/Toast';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Import from './pages/Import';
import Tags from './pages/Tags';
import Reports from './pages/Reports';
import './styles.css';

function AppShell() {
  const [activePage, setActivePage] = useState('dashboard');
  const [theme, setTheme] = useState(() => localStorage.getItem('ledger_theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ledger_theme', theme);
  }, [theme]);

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }

  const pages = {
    dashboard:    <Dashboard theme={theme} />,
    transactions: <Transactions />,
    import:       <Import />,
    tags:         <Tags />,
    reports:      <Reports />,
  };

  return (
    <div id="app">
      <Sidebar activePage={activePage} onNavigate={setActivePage} theme={theme} onToggleTheme={toggleTheme} />
      <main id="main">
        {pages[activePage]}
      </main>
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
