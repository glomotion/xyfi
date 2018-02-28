/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * This server takes care of relaying rotation in formation from phone's gyro
 * to the larger screen.
 */
const path = require('path');
const express = require('express');
const webpack = require('webpack');
const webpackMiddleware = require('webpack-dev-middleware');
const webpackHotMiddleware = require('webpack-hot-middleware');
const config = require('./webpack.config.js');
const isProd = process.env.NODE_ENV === 'production';
const port = 8090;
const ip = require('ip');

const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);

if (isProd) {
  app.use(express.static(__dirname + '/dist'));
  app.get('/screen', function(req, res) {
    res.sendFile(path.join(__dirname, 'dist/screen.html'));
  });
  app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, 'dist/remote.html'));
  });
} else {
  const compiler = webpack(config);
  const middleware = webpackMiddleware(compiler, {
    publicPath: config.output.publicPath,
    watchOptions: {
      aggregateTimeout: 300,
      poll: true
    },
  });
  app.use(middleware);
  app.use(webpackHotMiddleware(compiler));

  // The screen that shows "cursors" (circles) that are being controlled by
  // a smartphone.
  // This is usually where the main content of xyfi lives.
  app.get('/screen', function(req, res) {
    res.write(middleware.fileSystem.readFileSync(path.join(__dirname,
      'dist/screen.html')));
    res.end();
  });

  // The remote interface that shows on people's phones in a browser or captive
  // portal.
  app.get('*', function(req, res) {
    res.write(middleware.fileSystem.readFileSync(path.join(__dirname,
        'dist/remote.html')));
    res.end();
  });
}

server.listen(port, '0.0.0.0', function(err) {
  if (err) console.log(err);
  console.info(
    '==> 🌎 Listening on port %s. Open up http://0.0.0.0:%s/ in your browser.',
    port,
    port
  );
});

const screens = io.of('/screens');
const remotes = io.of('/remotes');

// Some state vars to keep track of pointers and update loops:
const activePointers = {};
let positionBatchEmitTimer = null;
const BATCH_INTERVAL_DURATION = 15;

// A small batching function which broadcasts at just under 60fps
const batchUpdate = () => {
  if (Object.keys(activePointers).length === 0) {
    clearTimeout(positionBatchEmitTimer);
    positionBatchEmitTimer = null;
  } else {

    // Send off a snapshot of all remotes
    console.log('batch pos emiting:', activePointers);
    screens.emit('positions', activePointers);
  }

  positionBatchEmitTimer = setTimeout(() => batchUpdate(), BATCH_INTERVAL_DURATION);
};

remotes.on('connection', (remote) => {
  screens.emit('push', remote.id);
  if (!positionBatchEmitTimer) batchUpdate();
  console.log('remote connected');

  remote.once('disconnect', () => {
    screens.emit('pop', remote.id);
    delete activePointers[remote.id];
    if (Object.keys(activePointers).length === 0) {
      clearTimeout(positionBatchEmitTimer);
      positionBatchEmitTimer = null;
    }
  });

  remote.on('position', (position) => {
    // screens.emit('position', remote.id, position);
    activePointers[remote.id] = position;
  });
});

screens.on('connection', (socket) => {
  socket.emit('initialize', {
    remoteIDs: Object.keys(remotes.sockets),
    address: `${ip.address()}:${port}`
  });
});
