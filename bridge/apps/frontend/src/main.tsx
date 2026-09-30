import '@gravity-ui/uikit/styles/styles.css';
import '@gravity-ui/aikit/themes/common';
import '@gravity-ui/aikit/themes/light';
import '@gravity-ui/aikit/themes/dark';
// Syntax highlighting for markdown code blocks in chat messages — a single
// static theme (not swapped with light/dark) is an acceptable v1 trade-off,
// matches reasonably in both.
import 'highlight.js/styles/github-dark-dimmed.css';
import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import { App } from './App';
import { store } from './store';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
);
