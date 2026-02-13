const path = require('node:path');
const fs = require('node:fs/promises');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

// Shared visited set to prevent race conditions when copying shared dependencies
const globalVisited = new Set();

async function copyDependency(buildPath, moduleName, visited = globalVisited) {
  if (visited.has(moduleName)) return;
  visited.add(moduleName);

  const source = path.resolve(__dirname, 'node_modules', moduleName);
  try {
    await fs.access(source);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const destination = path.resolve(buildPath, 'node_modules', moduleName);

  // Retry logic for race conditions
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.rm(destination, { recursive: true, force: true });
      break;
    } catch (error) {
      if (error?.code === 'ENOTEMPTY' && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });

  try {
    const pkgJson = await fs.readFile(path.join(source, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgJson);
    const deps = Object.keys(pkg.dependencies || {});
    for (const dep of deps) {
      await copyDependency(buildPath, dep, visited);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  packagerConfig: {
    asar: true,
    asarUnpack: [
      '**/node_modules/sqlite3/**',
      '**/node_modules/sequelize/**',
      '**/node_modules/keytar/**',
      '**/node_modules/tedious/**',
      '**/node_modules/sqlcipher/**',
      '**/node_modules/@journeyapps/sqlcipher/**',
      '**/node_modules/@mapbox/node-pre-gyp/**',
    ],
    extraResource: ['.env'],
    protocols: [
      {
        name: 'MSAL Auth Protocol',
        schemes: ['msal-electron-poc'],
      },
    ],
  },
  rebuildConfig: {},
  hooks: {
    async packageAfterCopy(_, buildPath) {
      // Reset visited set for each build
      globalVisited.clear();

      console.log('Copying native modules to:', buildPath);

      // Copy sequentially to avoid race conditions with shared dependencies
      await copyDependency(buildPath, 'sequelize');
      await copyDependency(buildPath, 'sqlite3');
      await copyDependency(buildPath, 'keytar');
      await copyDependency(buildPath, 'tedious');
      await copyDependency(buildPath, 'sqlcipher');
      await copyDependency(buildPath, '@journeyapps/sqlcipher');
      await copyDependency(buildPath, '@mapbox/node-pre-gyp');

      console.log('Native modules copied successfully');
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'venkat-3010',
          name: 'electron-new',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {
        packagedModules: ['sqlite3', 'keytar', 'tedious', '@journeyapps/sqlcipher'],
      },
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/client/index.html',
              js: './src/client/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/server/preload.js',
              },
            },
          ],
        },
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};
