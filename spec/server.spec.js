'use strict';
/* eslint-disable no-undef, no-unused-vars */

const app = require('../server/server.js');
const request = require('request-promise');
const baseUrl = 'http://0.0.0.0:3002';
const apiUrl = baseUrl + '/api';
const transcribaConfig = require('../server/transcriba-config.json');
// const baseUrl = app.get('url').replace(/\/$/, ''); // somehow does not work

// Start server for later api testing
app.start();

/**
 * Check whether the server is configurated like expected
 * TODO: identify more critical configurations and add tests here
 */
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

/**
 * Check whether the infoPage module is working
 */
describe('infoPage', function() {
  transcribaConfig.dummies.pages.forEach(function(value) {
    it('should load InfoPage ' + value, function(done) {
      request.get(apiUrl + '/InfoPages/parsed/' + value,
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

/**
 * The following test cases are used to check whether the api works
 * as expected on actions which require a logged in user
 * NOTE: in beforeAll we try to get the login data and in the actual test
 *  cases we build upon that. Indeed this is a problem because the login
 *  might fail and the login itself should also be a test cases
 * TODO: provide a better testing solution here (see note)
 */
describe('logged in user', function() {
  var userId, token, loginStatusCode;

  beforeAll(function(done) {
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
        if (error) {
          done.fail('login request: error occured during initialisation');
        } else {
          loginStatusCode = response.statusCode;
          if (
            body === undefined ||
            body.userId === undefined ||
            body.id === undefined
          ) {
            done.fail('login request: admin login has failed');
          } else {
            userId = body.userId;
            token = body.id;
            done();
          }
        }
      }
    );
  });

  //
  // NOTE: this was disabled due to testing architectue (see todo above)
  //  this might be useful later, but if not just remove it
  //
  // it('should login the user', function(done) {
  //   expect(loginStatusCode).toBe(300);
  //   expect(userId !== undefined).toBe(true);
  // });

  it('should have admin role', function(done) {
    request.get(apiUrl + '/AppUsers/' + userId + '/roles?access_token=' + token,
      function(error, response, body) {
        let roles = JSON.parse(body).map(
          (roleEntity) => roleEntity.name
        );
        expect(response.statusCode).toBe(200);
        expect(roles).toContain('administrator');
        done();
      }
    );
  });
});
