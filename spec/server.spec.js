'use strict';

const app = require('../server/server.js');
const request = require('request');
const baseUrl = 'http://0.0.0.0:3001';
// const baseUrl = app.get('url').replace(/\/$/, ''); // somehow does not work

app.start();

describe('App', function() {
  it('should have ejs view engine', function() {
    expect(app.get('view engine')).toEqual('ejs');
  });

  it('should start the server', function(done) {
    request.get(baseUrl, function(error, response, body) {
      expect(response.statusCode).toBe(200);
      done();
    });
  });

  it('should load InfoPage impressum ', function(done) {
    request.get(baseUrl + '/api/InfoPages/parsed/impressum',
      function(error, response, body) {
        let bodyObj = JSON.parse(body);
        expect(bodyObj.page.name).toBe('impressum');
        done();
      }
    );
  });
});
