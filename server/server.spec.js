'use strict';

/**
 * E2E and Server Configuration Tests
 */

/* eslint-disable no-undef, no-unused-vars */

const app = require('./server.js');
const request = require('request-promise');
const Promise = require('bluebird');
const transcribaConfig = require('./transcriba-config.json');

// Start server for later api testing

describe('server', () => {
  let baseUrl, apiUrl;

  beforeAll((done) => {
    app.start((baseUrlParam) => {
      baseUrl = baseUrlParam;
      apiUrl = baseUrl + '/api';
      done();
    });
  });

  /**
   * Check whether the server is configurated like expected
   */
  describe('app', () => {
    it('should have ejs view engine', () => {
      expect(app.get('view engine')).toBe('ejs');
    });

    it('should start the server', async(done) => {
      const response = await request.get(baseUrl, {json: true});
      expect(response.started).toBeDefined();
      done();
    });
  });

  /**
   * Check whether the infoPage module is working
   */
  describe('infoPage', () => {
    transcribaConfig.dummies.pages.forEach((value) => {
      it('should load InfoPage ' + value, (done) => {
        request.get(apiUrl + '/InfoPages/' + value + '/parsed',
          (error, response, body) => {
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
  describe('logged in user', () => {
    let userId, token, loginStatusCode;

    beforeAll(async(done) => {
      try {
        const user = await request.post(
          {
            url: baseUrl + '/api/AppUsers/login',
            body: {
              email: transcribaConfig.admin.email,
              password: transcribaConfig.admin.password,
            },
            json: true,
            method: 'POST',
          });

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

        // make sure admin is not busy in order that we can do some transcription tests
        await request.post(
          apiUrl +
           '/TranscribaObjects/free' +
           '?access_token=' + token
        );
        done();
      } catch (error) {
        done.fail('login request: error occured during initialisation');
      }
    });

    it('should have admin role', async(done) => {
      const roles = await request.get(
        apiUrl + '/AppUsers/' + userId + '/roles?access_token=' + token,
        {json: true}
      );
      const roleNames = roles.map((roleEntity) => roleEntity.name);
      expect(roleNames).toContain('administrator');
      done();
    });

    it('should run a transcription', async(done) => {
      try {
        // stage 1: is a manuscript source configured?
        const numOfSources = await request.get(
          apiUrl + '/Sources/count?access_token=' + token
        );
        if (numOfSources === 0) throw new Error('no source available');
        const trObject = await request.get(
          apiUrl +
         '/TranscribaObjects/findOne' +
         '?filter[where][status]=free' +
         '&access_token=' + token,
          {json: true}
        );

        // stage 2: do we find a free object which we may edit?
        if (!trObject) throw new Error('no free object available');
        expect(trObject.id).toBeDefined();
        expect(trObject.title).toBeDefined();
        expect(trObject.externalID).toBeDefined();
        expect(trObject.sourceId).toBeDefined();
        const newRevision = await request.post(
          apiUrl +
         '/TranscribaObjects/' + trObject.id + '/occupy' +
         '?access_token=' + token,
          {json: true}
        );

        // check revision
        expect(newRevision.id).toBeDefined();
        expect(newRevision.published).toBe(false);
        expect(newRevision.approved).toBe(false);
        const trObjectFromOccupied = await request.get(
          apiUrl +
         '/TranscribaObjects/occupied' +
         '?access_token=' + token,
          {json: true}
        );

        expect(trObjectFromOccupied.status).toBe('occupied');
        expect(trObjectFromOccupied.id).toBe(trObject.id);
        await request.post(
          apiUrl +
         '/TranscribaObjects/free' +
         '?access_token=' + token
        );
        done();
      } catch (error) {
        done.fail('error occured');
      }
    });
  });
});
