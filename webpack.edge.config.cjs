/**
 * Webpack Configuration for Edge Device Production Build
 * 
 * This config creates a highly obfuscated, minified production bundle
 * suitable for deployment on edge devices (Symcod W101M).
 * 
 * Features:
 * - Code obfuscation with javascript-obfuscator
 * - Minification with Terser
 * - Source map removal
 * - Console.log removal
 * - Single bundle output
 * - Environment variable injection
 */

const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const JavaScriptObfuscator = require('webpack-obfuscator');

module.exports = {
  mode: 'production',
  
  // Entry point - main server file
  entry: './server-foxtrot.js',
  
  // Output configuration
  output: {
    filename: 'server.bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true, // Clean dist folder before build
  },
  
  // Target Node.js environment
  target: 'node',
  
  // Node.js compatibility
  node: {
    __dirname: false,
    __filename: false,
  },
  
  // Resolve modules
  resolve: {
    extensions: ['.js', '.json'],
    modules: ['node_modules'],
  },
  
  // Externals - don't bundle native modules
  externals: {
    // Add any native modules that shouldn't be bundled
    'sqlite3': 'commonjs sqlite3',
    'pg-native': 'commonjs pg-native',
    'canvas': 'commonjs canvas',
    'bufferutil': 'commonjs bufferutil',
    'utf-8-validate': 'commonjs utf-8-validate',
  },
  
  // Optimization
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,      // Remove console.log
            drop_debugger: true,     // Remove debugger statements
            pure_funcs: ['console.info', 'console.debug', 'console.warn'], // Remove specific console methods
            passes: 2,               // Multiple optimization passes
          },
          mangle: {
            safari10: true,          // Safari 10 compatibility
          },
          format: {
            comments: false,         // Remove all comments
          },
        },
        extractComments: false,      // Don't create separate LICENSE file
      }),
    ],
  },
  
  // Plugins
  plugins: [
    // Note: JavaScript obfuscation disabled due to memory constraints
    // For edge devices, we rely on:
    // 1. Minification via Terser (identifier mangling, dead code removal)
    // 2. License validation system (hardware fingerprinting)
    // 3. Feature flags (proprietary algorithms stay in cloud APIs)
    // 4. Binary compilation via pkg (makes reverse engineering harder)
  ],
  
  // Module rules
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  node: '18', // Target Node.js 18+
                },
              }],
            ],
          },
        },
      },
    ],
  },
  
  // Performance hints
  performance: {
    hints: false, // Disable bundle size warnings for edge deployment
  },
  
  // Stats configuration
  stats: {
    colors: true,
    modules: false,
    children: false,
  },
};
