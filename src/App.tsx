/**
 * DonutSMP Bot - Landing Page
 * Shows the complete bot documentation and game list.
 */
function App() {
  const games = [
    { emoji: '🪙', name: 'Coinflip', desc: 'Pick heads or tails. 2x payout.', cmd: '/coinflip' },
    { emoji: '♠️', name: 'Blackjack', desc: 'Beat the dealer with Hit/Stand/Double.', cmd: '/blackjack' },
    { emoji: '🎡', name: 'Roulette', desc: 'Bet on red/black/green/number. 2x-36x.', cmd: '/roulette' },
    { emoji: '🎰', name: 'Slots', desc: 'Match symbols for big payouts.', cmd: '/slots' },
    { emoji: '🎲', name: 'Dice', desc: 'Pick a number 1-6. 6x payout.', cmd: '/dice' },
    { emoji: '🐔', name: 'Chicken', desc: 'Cross the road. Cash out before hit!', cmd: '/chicken' },
    { emoji: '🎯', name: 'Keno', desc: 'Pick up to 10 numbers. Big payouts.', cmd: '/keno' },
    { emoji: '🚀', name: 'Limbo', desc: 'Set target multiplier. Beat it!', cmd: '/limbo' },
    { emoji: '💣', name: 'Mines', desc: 'Reveal tiles, avoid mines. Cash out!', cmd: '/mines' },
    { emoji: '🏗️', name: 'Tower', desc: 'Climb floor by floor. Cash out safe!', cmd: '/tower' },
  ];

  const commands = {
    '💰 Economy': ['/balance', '/wallet', '/deposit', '/withdraw', '/pay', '/history', '/info'],
    '🎰 Games': ['/coinflip', '/blackjack', '/roulette', '/slots', '/dice', '/chicken', '/keno', '/limbo', '/mines', '/tower'],
    '👤 Account': ['/link', '/unlink', '/profile', '/account'],
    '🏆 Rewards': ['/baltop', '/games', '/redeem', '/rakeback', '/invites', '/advertisement'],
    '🔐 Fairness': ['/provablyfair', '/verify'],
    '⚙️ Utility': ['/status', '/help', '/refreshroles'],
    '🛡️ Admin': ['/giveaway', '/setchannel', '/setconfig', '/maintenance', '/addbalance', '/removebalance', '/database-status'],
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
      {/* Header */}
      <div className="text-center py-12 px-4">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
          🍩 DonutSMP Bot
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto">
          A complete Discord economy & gambling bot for Minecraft servers.
          Featuring 10 games, provably fair system, and 15% profit-based tax.
        </p>
      </div>

      {/* Games Grid */}
      <div className="max-w-6xl mx-auto px-4 pb-12">
        <h2 className="text-3xl font-bold text-center mb-8">🎰 Games</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {games.map((game) => (
            <div key={game.name} className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700 hover:border-purple-500 transition-all hover:scale-105">
              <div className="text-4xl mb-2">{game.emoji}</div>
              <h3 className="font-bold text-lg">{game.name}</h3>
              <p className="text-sm text-gray-400 mt-1">{game.desc}</p>
              <code className="text-xs text-purple-400 mt-2 block">{game.cmd}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Commands */}
      <div className="max-w-4xl mx-auto px-4 pb-12">
        <h2 className="text-3xl font-bold text-center mb-8">📋 Commands</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(commands).map(([category, cmds]) => (
            <div key={category} className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700">
              <h3 className="font-bold text-lg mb-2">{category}</h3>
              <div className="flex flex-wrap gap-2">
                {cmds.map((cmd) => (
                  <code key={cmd} className="text-xs bg-gray-700 px-2 py-1 rounded text-green-400">
                    {cmd}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="max-w-4xl mx-auto px-4 pb-12">
        <h2 className="text-3xl font-bold text-center mb-8">✨ Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: '🔐 Provably Fair', desc: 'HMAC-SHA256 with verifiable server seeds' },
            { title: '💰 15% Tax on Profit', desc: 'Fair tax applied only to winnings' },
            { title: '🛡️ Transaction Safety', desc: 'Atomic operations, no double-spending' },
            { title: '🎮 Interactive Games', desc: 'Blackjack, Mines, Tower with buttons' },
            { title: '🏆 Leaderboards', desc: 'Balance rankings and game stats' },
            { title: '🎁 Rewards', desc: 'Rakeback, invites, promo codes' },
          ].map((feature) => (
            <div key={feature.title} className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700">
              <h3 className="font-bold text-lg mb-1">{feature.title}</h3>
              <p className="text-sm text-gray-400">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Start */}
      <div className="max-w-2xl mx-auto px-4 pb-12">
        <h2 className="text-3xl font-bold text-center mb-8">🚀 Quick Start</h2>
        <div className="bg-gray-800/80 backdrop-blur-sm rounded-xl p-6 border border-gray-700">
          <pre className="text-sm text-green-400 overflow-x-auto">
{`# Install
bash install.sh

# Configure
nano .env

# Register commands
node src/index.js --register-commands

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup`}
          </pre>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-8 text-gray-500 text-sm border-t border-gray-800">
        <p>DonutSMP Bot v1.0.0 — Virtual economy only. No real money.</p>
        <p className="mt-1">All games use provably fair HMAC-SHA256 randomness.</p>
      </div>
    </div>
  );
}

export default App;
