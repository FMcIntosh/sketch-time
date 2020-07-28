const express = require('express');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 8000;
const { gameManagerMachine } = require('./machines/GameManagerMachine');
const { interpret } = require('xstate');

var http = require('http').createServer(app);
var io = require('socket.io')(http);
io.origins((origin, callback) => {
  const allowed = ['http://localhost:3000', 'https://fun.frasermcintosh.com'];
  console.log('Origin', allowed.includes(origin), origin);

  if (!allowed.includes(origin)) {
    return callback('origin not allowed', false);
  }
  callback(null, true);
});

const service = interpret(gameManagerMachine.withContext({ ...gameManagerMachine.context, io }))
  .onTransition((state) => {
    console.log('service', state.value);
  })
  .start();

http.listen(port, () => console.log(`Example app listening at http://localhost:${port}`));
