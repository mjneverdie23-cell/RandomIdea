import { Navigate, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/layout/NavBar.tsx';
import { DatasetProvider, useDataset } from './state/DatasetContext.tsx';
import { QuizProvider } from './state/QuizContext.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { QuizPage } from './pages/QuizPage.tsx';
import { ResultsPage } from './pages/ResultsPage.tsx';
import { LeaderboardPage } from './pages/LeaderboardPage.tsx';
import { DataPage } from './pages/DataPage.tsx';

export default function App() {
  return (
    <DatasetProvider>
      <QuizProvider>
        <NavBar />
        <main className="app-main">
          <DatasetGate>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/quiz" element={<QuizPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/data" element={<DataPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </DatasetGate>
        </main>
        <footer className="app-footer">
          <span>
            DraftCall · built for Oracle’s Elixir exports · champion art © Riot Games via Data
            Dragon
          </span>
          <span className="dim">
            Not endorsed by Riot Games. Team and player names belong to their organizations.
          </span>
        </footer>
      </QuizProvider>
    </DatasetProvider>
  );
}

/** Holds every route until the dataset (stored or demo) has resolved. */
function DatasetGate({ children }: { children: React.ReactNode }) {
  const { status } = useDataset();
  if (status === 'loading') {
    return (
      <div className="empty-state">
        <span className="spinner" aria-hidden="true" />
        <p>Loading game data…</p>
      </div>
    );
  }
  return <>{children}</>;
}
