import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted Inter (was a runtime Google Fonts fetch — an external dependency
// enterprise deploys shouldn't have; also fails behind strict proxies/offline).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles/global.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
