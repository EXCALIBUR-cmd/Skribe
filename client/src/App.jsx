import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { PreferencesProvider } from './context/PreferencesContext';
import AppLayout from './components/layout/AppLayout';
import AppRoutes from './routes/AppRoutes';
import QuickDictation from './features/voice/QuickDictation.jsx';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PreferencesProvider>
          <AppLayout>
            <AppRoutes />
          </AppLayout>
          <QuickDictation />
        </PreferencesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
