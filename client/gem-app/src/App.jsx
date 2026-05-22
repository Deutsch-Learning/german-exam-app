import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Landing from "./pages/Landing";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import DashboardMainPage from "./pages/DashboardMainPage";
import SimulationSelectionPage from "./pages/SimulationSelectionPage";
import SimulationModulePage from "./pages/SimulationModulePage";
import ReadingPage from "./pages/Reading";
import ListeningPage from "./pages/Listening";
import WritingPage from "./pages/Writing";
import SpeakingPage from "./pages/Speaking";
import ProfilePage from "./pages/ProfilePage";
import AboutPage from "./pages/AboutPage";
import ActualitesPage from "./pages/ActualitesPage";
import ContactPage from "./pages/ContactPage";
import ProgressPage from "./pages/ProgressPage";
import LessonsPage from "./pages/LessonsPage";
import AllRecentSimulationsPage from "./pages/AllRecentSimulationsPage";
import TopicPage from "./pages/TopicPage";
import InfoPage from "./pages/InfoPage";
import SeriesSelectionPage from "./pages/SeriesSelectionPage";
import SeriesSimulationPage from "./pages/SeriesSimulationPage";
import OffersPage from "./pages/OffersPage";
import StartPreparationPage from "./pages/StartPreparationPage";
import FreeTestPage from "./pages/FreeTestPage";
import SessionExpiredPage from "./pages/SessionExpiredPage";
import CheckoutPage from "./pages/CheckoutPage";
import ComingSoonPage from "./pages/ComingSoonPage";
import NotFoundPage from "./pages/NotFoundPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AdminPanel from "./pages/AdminPanel";
import { LanguageProvider } from "./context/LanguageContext";
import { AdminRoute, ProtectedRoute, PublicOnlyRoute } from "./components/RouteGuards";
import MotionShell from "./components/motion/MotionShell";
import API from "./services/api";
import { clearAuthSession, hasAuthSessionHint, isLoggedIn, storeAuthSession } from "./utils/access";

function AppRoutes() {
  const location = useLocation();
  const [authReady, setAuthReady] = useState(() => isLoggedIn() || !hasAuthSessionHint());

  useEffect(() => {
    if (isLoggedIn() || !hasAuthSessionHint()) return undefined;

    let cancelled = false;
    API.post("/api/auth/refresh", null, { _retry: true })
      .then((response) => {
        const token = response.data?.accessToken ?? response.data?.token;
        const user = response.data?.user;
        if (token && user) {
          storeAuthSession(
            { user, token, expiresIn: response.data?.expiresIn ?? "15m" },
            false
          );
        } else {
          clearAuthSession();
        }
      })
      .catch(() => {
        clearAuthSession();
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!authReady) {
    return <div style={{ minHeight: "100vh", background: "#fff" }} aria-label="Loading session" />;
  }

  return (
    <MotionShell>
      <Routes location={location}>
        <Route path="/" element={<PublicOnlyRoute><Landing /></PublicOnlyRoute>} />
        <Route path="/landing" element={<PublicOnlyRoute><Landing /></PublicOnlyRoute>} />
        <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardMainPage /></ProtectedRoute>} />
        <Route path="/admin/*" element={<AdminRoute><AdminPanel /></AdminRoute>} />
        <Route path="/simulations" element={<ProtectedRoute><SimulationSelectionPage /></ProtectedRoute>} />
        <Route path="/simulations/:examId/:seriesId" element={<SeriesSimulationPage />} />
        <Route path="/simulations/:examId" element={<SeriesSelectionPage />} />
        <Route path="/simulation/:examId/:seriesId/:moduleId" element={<SimulationModulePage />} />
        <Route path="/simulation/:moduleId" element={<ProtectedRoute><SimulationModulePage /></ProtectedRoute>} />
        <Route path="/topics/:topicId" element={<TopicPage />} />
        <Route path="/faq" element={<InfoPage type="faq" />} />
        <Route path="/privacy-policy" element={<InfoPage type="privacy" />} />
        <Route path="/refund-condition" element={<InfoPage type="refund" />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/checkout/:offerId" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
        <Route path="/coming-soon/:examId" element={<ComingSoonPage />} />
        <Route path="/coming-soon" element={<ComingSoonPage />} />
        <Route path="/start-preparation" element={<StartPreparationPage />} />
        <Route path="/free-test/:seriesId" element={<FreeTestPage />} />
        <Route path="/session-expired" element={<SessionExpiredPage />} />
        <Route path="/reading" element={<ProtectedRoute><ReadingPage /></ProtectedRoute>} />
        <Route path="/listening" element={<ProtectedRoute><ListeningPage /></ProtectedRoute>} />
        <Route path="/writing" element={<ProtectedRoute><WritingPage /></ProtectedRoute>} />
        <Route path="/speaking" element={<ProtectedRoute><SpeakingPage /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/progress" element={<ProtectedRoute><ProgressPage /></ProtectedRoute>} />
        <Route path="/recent-simulations" element={<ProtectedRoute><AllRecentSimulationsPage /></ProtectedRoute>} />
        <Route path="/lessons" element={<LessonsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/actualites" element={<ActualitesPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MotionShell>
  );
}

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
