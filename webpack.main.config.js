const webpack = require('webpack');

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
  plugins: [
    // Ignore optional Sequelize dialect dependencies we don't use
    new webpack.IgnorePlugin({
      resourceRegExp: /^(pg|pg-hstore|pg-native|mysql2|mariadb|oracledb|ibm_db|odbc|better-sqlite3|@vscode\/sqlite3)$/,
    }),
  ],
  resolve: {
    fallback: {
      // Provide empty modules for optional Sequelize dependencies
      'pg-hstore': false,
      'pg': false,
      'pg-native': false,
      'mysql2': false,
      'mariadb': false,
      'oracledb': false,
      'ibm_db': false,
      'odbc': false,
      'better-sqlite3': false,
      '@vscode/sqlite3': false,
    },
  },
};
