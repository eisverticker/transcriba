'use strict';
/**
 * E2E and Server Configuration Tests
 */

/* eslint-disable no-undef, no-unused-vars */

const app = require('./server.js');
const request = require('request-promise');
const Promise = require('bluebird');
const baseUrl = 'http://localhost:3002';
const apiUrl = baseUrl + '/api';
const transcribaConfig = require('./transcriba-config.json');
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

  it('should start the server', async (done) => {
    const response = await request.get(app.get('url'));
    console.info("response",response);
    expect(response.started).toBeDefined(200);
    return;
  });
});

/**
 * Check whether the infoPage module is working
 */
describe('infoPage', function() {
  transcribaConfig.dummies.pages.forEach(function(value) {
    it('should load InfoPage ' + value, function(done) {
      request.get(apiUrl + '/InfoPages/' + value + '/parsed',
        function(error, response, body) {
          let bodyObj = JSON.parse(body);
          expect(response.statusCode).toBe(200);
          expect(bodyObj.name).toBe(value);
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
  let userId, token, loginStatusCode;

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
      }).then(
      (user) => {
      // NOTE: body is already an parsed json object
        if (
          user === undefined ||
          user.userId === undefined ||
          user.id === undefined
        ) {
          done.fail('login request: admin login has failed');
        } else {
          userId = user.userId;
          token = user.id;
        }
      },
      (error) => done.fail('login request: error occured during initialisation')
    ).then(
      // make sure admin is not busy in order that we can do some transcription tests
      () => request.post(
        apiUrl +
       '/TranscribaObjects/free' +
       '?access_token=' + token
      )
    ).then(
      () => done()
    );
  });

  it('should have admin role', function(done) {
    request.get(
      apiUrl + '/AppUsers/' + userId + '/roles?access_token=' + token,
      {json: true}
    ).then(
      (roles) => {
        const roleNames = roles.map((roleEntity) => roleEntity.name);
        // expect(response.statusCode).toBe(200);
        expect(roleNames).toContain('administrator');
        done();
      }
    );
  });

  it('should run a transcription', function(done) {
    let originalTrObject;
    request.get(apiUrl + '/Sources/count?access_token=' + token)
      .then(
        (numOfSources) => {
          // stage 1: is a manuscript source configured?
          if (numOfSources === 0) throw new Error('no source available');
          return request.get(
            apiUrl +
           '/TranscribaObjects/findOne' +
           '?filter[where][status]=free' +
           '&access_token=' + token,
            {json: true}
          );
        }
      ).then(
        (trObject) => {
          // stage 2: do we find a free object which we may edit?
          if (!trObject) throw new Error('no free object available');
          originalTrObject = trObject;
          expect(trObject.id).toBeDefined();
          expect(trObject.title).toBeDefined();
          expect(trObject.externalID).toBeDefined();
          expect(trObject.sourceId).toBeDefined();
          return request.post(
            apiUrl +
           '/TranscribaObjects/' + trObject.id + '/occupy' +
           '?access_token=' + token,
            {json: true}
          );
        }
      ).then(
        (newRevision) => {
          // check revision
          expect(newRevision.id).toBeDefined();
          expect(newRevision.published).toBe(false);
          expect(newRevision.approved).toBe(false);
          return request.get(
            apiUrl +
           '/TranscribaObjects/occupied' +
           '?access_token=' + token,
            {json: true}
          );
        }
      ).then(
        (trObject) => {
          expect(trObject.status).toBe('occupied');
          expect(trObject.id).toBe(originalTrObject.id);
          return request.post(
            apiUrl +
           '/TranscribaObjects/free' +
           '?access_token=' + token
          );
        }
      ).then(
        () => done()
      ).catch(
        () => done.fail('error occured')
      );
  });
});
