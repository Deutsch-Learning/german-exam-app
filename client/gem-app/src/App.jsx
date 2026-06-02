import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Landing from "./pages/Landing";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import { LanguageProvider } from "./context/LanguageContext";
import { AdminRoute, ProtectedRoute, PublicOnlyRoute } from "./components/RouteGuards";
import MotionShell from "./components/motion/MotionShell";
import API from "./services/api";
import { clearAuthSession, hasAuthSessionHint, isLoggedIn, storeAuthSession } from "./utils/access";

const DashboardMainPage = lazy(() => import("./pages/DashboardMainPage"));
const SimulationSelectionPage = lazy(() => import("./pages/SimulationSelectionPage"));
const SimulationModulePage = lazy(() => import("./pages/SimulationModulePage"));
const ReadingPage = lazy(() => import("./pages/Reading"));
const ListeningPage = lazy(() => import("./pages/Listening"));
const WritingPage = lazy(() => import("./pages/Writing"));
const SpeakingPage = lazy(() => import("./pages/Speaking"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const ActualitesPage = lazy(() => import("./pages/ActualitesPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const ProgressPage = lazy(() => import("./pages/ProgressPage"));
const LessonsPage = lazy(() => import("./pages/LessonsPage"));
const AllRecentSimulationsPage = lazy(() => import("./pages/AllRecentSimulationsPage"));
const TopicPage = lazy(() => import("./pages/TopicPage"));
const InfoPage = lazy(() => import("./pages/InfoPage"));
const SeriesSelectionPage = lazy(() => import("./pages/SeriesSelectionPage"));
const SeriesSimulationPage = lazy(() => import("./pages/SeriesSimulationPage"));
const OffersPage = lazy(() => import("./pages/OffersPage"));
const StartPreparationPage = lazy(() => import("./pages/StartPreparationPage"));
const FreeTestPage = lazy(() => import("./pages/FreeTestPage"));
const SessionExpiredPage = lazy(() => import("./pages/SessionExpiredPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const ComingSoonPage = lazy(() => import("./pages/ComingSoonPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

const RouteFallback = () => (
  <div
    style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#fffdf4",
      color: "#111827",
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 800,
    }}
  >
    Chargement...
  </div>
);

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
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
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
