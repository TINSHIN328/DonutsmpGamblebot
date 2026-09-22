/**
 * Minimal placeholder for the Vite build system.
 * The actual bot runs with Node.js directly (node src/index.js).
 * This React component exists only to satisfy the build requirement.
 */
function App() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">🍩 DonutSMP Bot</h1>
        <p className="text-gray-400 text-lg">
          This is a Node.js Discord bot. Run it with: <code className="bg-gray-800 px-2 py-1 rounded text-green-400">node src/index.js</code>
        </p>
        <div className="mt-8 space-y-2">
          <p className="text-gray-500">Quick Start:</p>
          <div className="bg-gray-800 rounded-lg p-4 text-left max-w-md mx-auto">
            <code className="text-sm text-gray-300 block">
              <span className="text-green-400">$</span> bash install.sh<br/>
              <span className="text-green-400">$</span> nano .env<br/>
              <span className="text-green-400">$</span> node src/index.js --register-commands<br/>
              <span className="text-green-400">$</span> pm2 start ecosystem.config.cjs
            </code>
          </div>
        </div>
        <div className="mt-8">
          <a href="README.md" className="text-blue-400 hover:text-blue-300 underline">
            📖 Read the full documentation
          </a>
        </div>
      </div>
    </div>
  );
}

export default App;
