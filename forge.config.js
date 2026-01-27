const path = require('node:path');
const fs = require('node:fs/promises');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

async function copyDependency(buildPath, moduleName, visited = new Set()) {
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
  await fs.rm(destination, { recursive: true, force: true });
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
    asarUnpack: ['**/node_modules/sqlite3/**', '**/node_modules/sequelize/**', '**/node_modules/keytar/**', '**/node_modules/tedious/**'],
    extraResource: ['.env'],
    // Register custom protocol for OAuth redirect
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
      // Ensure native ORM dependencies ship inside the packaged app
      console.log('Copying native modules to:', buildPath);
      await Promise.all([
        copyDependency(buildPath, 'sequelize'),
        copyDependency(buildPath, 'sqlite3'),
        copyDependency(buildPath, 'keytar'),
        copyDependency(buildPath, 'tedious'),
      ]);
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
        packagedModules: ['sqlite3', 'keytar'],
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
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
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
