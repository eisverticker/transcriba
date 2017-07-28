'use strict';

const app = require('../server/server.js');
const request = require('request');
const baseUrl = 'http://0.0.0.0:3001';
const transcribaConfig = require('../server/transcriba-config.json');
// const baseUrl = app.get('url').replace(/\/$/, ''); // somehow does not work

// Start server for later api testing
app.start();

describe('server', function() {
  it('should have ejs view engine', function() {
    expect(app.get('view engine')).toEqual('ejs');
  });

  it('should start the server', function(done) {
    request.get(baseUrl, function(error, response) {
      expect(response.statusCode).toBe(200);
      done();
    });
  });
});

describe('infoPage', function() {
  transcribaConfig.dummies.pages.forEach(function(value) {
    it('should load InfoPage ' + value, function(done) {
      request.get(baseUrl + '/api/InfoPages/parsed/' + value,
        function(error, response, body) {
          let bodyObj = JSON.parse(body);
          expect(response.statusCode).toBe(200);
          expect(bodyObj.page.name).toBe(value);
          done();
        }
      );
    });
  });
});

describe('user', function() {
  it('should login (admin, see config)', function(done) {
    request.post(
      {
        url: baseUrl + '/api/AppUsers/login',
        body: {
          email: transcribaConfig.admin.email,
          password: transcribaConfig.admin.password,
        },
        json: true,
        method: 'POST',
      },
      function(error, response, body) {
        // NOTE: body is already an parsed json object
        expect(response.statusCode).toBe(200);
        expect(body.userId !== undefined).toBe(true);
        done();
      }
    );
  });
});
