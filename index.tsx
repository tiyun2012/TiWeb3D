
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { EngineProvider } from '@/engine/api/EngineProvider';
import { registerBuiltInAssetTypes } from '@/engine/BuiltInAssetTypes';
import { registerBuiltInAssetEditors } from '@/editor/BuiltInAssetEditors';
import { installStaticMeshTestConsoleCommand } from '@/editor/StaticMeshTestConsole';

registerBuiltInAssetTypes();
registerBuiltInAssetEditors();
installStaticMeshTestConsoleCommand();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <EngineProvider>
      <App />
    </EngineProvider>
  </React.StrictMode>
);
