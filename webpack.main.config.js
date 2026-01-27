module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/server/main.js',
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
  // Native modules must be externalized - webpack can't bundle them
  externals: {
    keytar: 'commonjs keytar',
    sqlite3: 'commonjs sqlite3',
    tedious: 'commonjs tedious',
  },
};
