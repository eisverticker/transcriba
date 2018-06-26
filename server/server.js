'use strict';

const loopback = require('loopback');
const boot = require('loopback-boot');
const path = require('path');
const bodyParser = require('body-parser');
const engine = require('ejs-mate');
const transcribaConfig = require('./transcriba-config.json');

const app = loopback();

// use ejs-locals for all ejs templates:
app.engine('ejs', engine);

// configure view handler
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.appName = transcribaConfig.appName;// make appName available in templates

// configure body parser
app.use(bodyParser.urlencoded({extended: true}));

app.use(loopback.token());

app.start = function(callback) {
  // start the web server
  return app.listen(function() {
    app.emit('started');
    const baseUrl = app.get('url').replace(/\/$/, '');
    console.log('Web server listening at: %s', baseUrl);
    if (app.get('loopback-component-explorer')) {
      const explorerPath = app.get('loopback-component-explorer').mountPath;
      console.log('Browse your REST API at %s%s', baseUrl, explorerPath);
    }
    if (callback) callback(baseUrl);
  });
};

module.exports = app;

// Bootstrap the application, configure models, datasources and middleware.
// Sub-apps like REST API are mounted via boot scripts.
boot(app, __dirname, function(err) {
  if (err) throw err;

  // start the server if `$ node server.js`
  if (require.main === module)
    app.start();
});
