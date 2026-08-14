const { resolve } = require('path');
var glob = require('glob');
var path = require('path');

const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ESBuildMinifyPlugin } = require('esbuild-loader');
const { ProvidePlugin, BannerPlugin } = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');

const CopyPlugin = require('copy-webpack-plugin');

const isProd = process.env.NODE_ENV === 'production';
const isDevelopment = !isProd;

const fastRefresh = isDevelopment ? new ReactRefreshWebpackPlugin() : null;

const SANDBOX_SUFFIX = '-sandbox';

/**
 * FORK (2026-08-14, bug-hunt #26): don't bundle widgets the fork gates deny.
 *
 * Entries are globbed from every src/widgets/*.tsx, so a widget whose ONLY
 * registration id sits on the deny-list in src/lib/fork_gates.ts still shipped a
 * full bundle (plus a -sandbox twin) — 23 widgets, ~22 MB, over 40% of dist/.
 *
 * The list is PARSED FROM fork_gates.ts rather than restated here, so flipping a
 * FORK_FEATURES boolean automatically restores that widget's bundle and the two
 * can never disagree. If the parse finds nothing — an upstream restructure, a
 * renamed const — it returns an empty set and everything is built, which is the
 * safe direction to fail in.
 *
 * Excluding an entry does NOT remove the file: `history_sidebar` imports the
 * three history components, and `practiced_queues` is imported for its types.
 * Module resolution is unaffected; only the standalone bundle goes away.
 */
function deniedWidgetIds() {
  try {
    const src = require('fs').readFileSync(
      path.resolve(__dirname, 'src/lib/fork_gates.ts'),
      'utf8'
    );
    // FORK (2026-08-15, review §2.9): scope the flag scan to the FORK_FEATURES
    // literal. A bare /^ {2}(\w+): (true|false),/ over the whole file also matched
    // any other two-space boolean property, so an unrelated edit could inject a
    // phantom flag.
    const flagBlock = src.match(/FORK_FEATURES[^=]*=\s*\{([\s\S]*?)\n\};/);
    const flags = {};
    if (flagBlock) {
      for (const m of flagBlock[1].matchAll(/^ {2}(\w+): (true|false),/gm)) {
        flags[m[1]] = m[2] === 'true';
      }
    }
    const denied = new Set();
    for (const g of src.matchAll(/enabled:\s*FORK_FEATURES\.(\w+),([\s\S]*?)\n {2}\}/g)) {
      if (flags[g[1]] !== false) continue;
      const w = g[2].match(/widgets:\s*\[([\s\S]*?)\]/);
      if (!w) continue;
      for (const id of w[1].matchAll(/'([^']+)'/g)) denied.add(id[1]);
    }

    // §2.9: the "fail safe = build everything" claim only holds for a rename or a
    // missing file. A FORMATTING change is different: the lazy body regex above
    // terminates at the first 2-space `}` line, so a group whose closing brace moves
    // (a Prettier run is enough) can spill into the NEXT group and deny ITS widgets —
    // producing a registered widget with no bundle, i.e. a blank iframe and nothing in
    // the logs. Assert every denied id still has a source file; if one does not, the
    // parse has drifted, so build everything rather than silently dropping entries.
    const fs = require('fs');
    for (const id of denied) {
      const f = path.resolve(__dirname, 'src/widgets/' + id + '.tsx');
      if (!fs.existsSync(f)) {
        console.warn(
          '[fork] deny-list parse looks wrong — no src/widgets/' + id + '.tsx. ' +
            'Building ALL widgets.'
        );
        return new Set();
      }
    }
    return denied;
  } catch (e) {
    console.warn('[fork] could not parse fork_gates.ts — building all widgets:', e.message);
    return new Set();
  }
}

const DENIED_WIDGETS = deniedWidgetIds();
if (DENIED_WIDGETS.size) {
  // §2.9: log the full list, not a count — a count cannot reveal that the WRONG
  // widget was excluded, which is the failure mode that produces a blank iframe.
  console.log(
    `[fork] skipping ${DENIED_WIDGETS.size} denied widget bundles: ` +
      [...DENIED_WIDGETS].sort().join(', ')
  );
}

const config = {
  mode: isProd ? 'production' : 'development',
  entry: glob.sync('./src/widgets/**.tsx').reduce(function (obj, el) {
    const name = path.parse(el).name;
    if (DENIED_WIDGETS.has(name)) return obj; // FORK (#26)
    obj[name] = el;
    obj[name + SANDBOX_SUFFIX] = el;
    return obj;
  }, {}),

  output: {
    path: resolve(__dirname, 'dist'),
    filename: `[name].js`,
    publicPath: '',
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx|jsx|js)?$/,
        loader: 'esbuild-loader',
        options: {
          loader: 'tsx',
          target: 'es2020',
          minify: false,
        },
      },
      {
        test: /\.css$/i,
        use: [
          // Always use style-loader (inject as <style> tags at runtime).
          // MiniCssExtractPlugin would write separate .css files that RemNote never loads,
          // causing Tailwind classes to have no effect in production builds.
          "style-loader",
          { loader: 'css-loader', options: { url: false } },
          'postcss-loader',
        ],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      templateContent: `
      <body></body>
      <script type="text/javascript">
      const urlSearchParams = new URLSearchParams(window.location.search);
      const queryParams = Object.fromEntries(urlSearchParams.entries());
      const widgetName = queryParams["widgetName"];
      if (widgetName == undefined) {document.body.innerHTML+="Widget ID not specified."}

      const s = document.createElement('script');
      s.type = "module";
      s.src = widgetName+"${SANDBOX_SUFFIX}.js";
      document.body.appendChild(s);
      </script>
    `,
      filename: 'index.html',
      inject: false,
    }),
    new ProvidePlugin({
      React: 'react',
      reactDOM: 'react-dom',
    }),
    new BannerPlugin({
      banner: (file) => {
        return !file.chunk?.name?.includes(SANDBOX_SUFFIX) ? 'const IMPORT_META=import.meta;' : '';
      },
      raw: true,
    }),
    new CopyPlugin({
      patterns: [
        { from: 'public', to: '' },
        { from: 'README.md', to: '' },
        {
          from: 'src/style.css',
          to: 'snippet.css',
          noErrorOnMissing: true,
        },
        {
          from: 'src/style.css',
          to: 'App.css',
          noErrorOnMissing: true, // Don't fail if style.css doesn't exist
        },
      ]
    }),
    fastRefresh,
  ].filter(Boolean),
};

if (isProd) {
  config.optimization = {
    minimize: isProd,
    minimizer: [new ESBuildMinifyPlugin()],
  };
} else {
  // for more information, see https://webpack.js.org/configuration/dev-server
  config.devServer = {
    port: 8080,
    open: true,
    hot: true,
    compress: true,
    watchFiles: ['src/*'],
    static: {  // Add this section
      directory: resolve(__dirname, 'src'),
      publicPath: '/',
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',  // Add this
      'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',  // Add this
    },
  };
}

module.exports = config;