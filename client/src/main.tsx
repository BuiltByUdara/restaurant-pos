import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './app';
import './styles.css';
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true } },
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <App />
    <Toaster richColors position="bottom-right" />
  </QueryClientProvider>,
);
