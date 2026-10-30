import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import WelcomePage from '../pages/WelcomePage';
import SignInPage from '../pages/SignInPage';
import SignUpPage from '../pages/SignUpPage';
import BoardsPage from '../pages/BoardsPage';
import MainCanvasPage from '../pages/MainCanvasPage';
import AIAssistPage from '../pages/AIAssistPage';
import MobileCanvasPage from '../pages/MobileCanvasPage';
import SettingsPage from '../pages/SettingsPage';
import LandingRedirect from '../features/settings/LandingRedirect';
import ProtectedRoute from '../components/auth/ProtectedRoute';

export const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />

      <Route
        path="/boards"
        element={
          <ProtectedRoute>
            <BoardsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/board/:id"
        element={
          <ProtectedRoute>
            <MainCanvasPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/canvas"
        element={
          <ProtectedRoute>
            <MainCanvasPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ai-assist"
        element={
          <ProtectedRoute>
            <AIAssistPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mobile"
        element={
          <ProtectedRoute>
            <MobileCanvasPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/start"
        element={
          <ProtectedRoute>
            <LandingRedirect />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/:categoryId?"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  );
};

export default AppRoutes;
