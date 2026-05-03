import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import NotFoundPage from "./pages/NotFoundPage";
import { LanguageProvider } from "./context/LanguageContext";

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<DashboardMainPage />} />
          <Route path="/simulations" element={<SimulationSelectionPage />} />
          <Route path="/simulations/:examId/:seriesId" element={<SeriesSimulationPage />} />
          <Route path="/simulations/:examId" element={<SeriesSelectionPage />} />
          <Route path="/simulation/:examId/:seriesId/:moduleId" element={<SimulationModulePage />} />
          <Route path="/simulation/:moduleId" element={<SimulationModulePage />} />
          <Route path="/topics/:topicId" element={<TopicPage />} />
          <Route path="/faq" element={<InfoPage type="faq" />} />
          <Route path="/privacy-policy" element={<InfoPage type="privacy" />} />
          <Route path="/refund-condition" element={<InfoPage type="refund" />} />
          <Route path="/offers" element={<OffersPage />} />
          <Route path="/checkout/:offerId" element={<CheckoutPage />} />
          <Route path="/start-preparation" element={<StartPreparationPage />} />
          <Route path="/free-test/:seriesId" element={<FreeTestPage />} />
          <Route path="/session-expired" element={<SessionExpiredPage />} />
          <Route path="/reading" element={<ReadingPage />} />
          <Route path="/listening" element={<ListeningPage />} />
          <Route path="/writing" element={<WritingPage />} />
          <Route path="/speaking" element={<SpeakingPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/recent-simulations" element={<AllRecentSimulationsPage />} />
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/actualites" element={<ActualitesPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
