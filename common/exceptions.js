'use strict';
/**
 * Central Collection of Errors / Exceptions which are being used
 * throughout the application
 */
// TODO

module.exports = {
  Unclear: new Error('Nonspecified Exception'),
  NotFound: {
    Default: new Error('model(s) not found'),
    TranscribaObject: new Error('trObject was not found'),
    Collection: new Error('Collection was not found'),
    User: new Error('User was not found'),
    Role: new Error('Role was not found'),
    Directory: new Error('directory does not exist'),
    Revision: new Error('revision(s) not found'),
    RelatedModel: new Error('cannot find related model'),
    Image: new Error('image file not found')
  },
  WrongFormat: new Error('Expected data format was different'),
  Duplicate: new Error('Cannot create a duplicate model'),
  Replay: new Error('Action was already done'),
  Occupied: new Error('Cannot access model because it is already occupied'),
  BusyUser: new Error('User is busy'),
  WrongInput: new Error('Lack of mandatory input parameters'),
  Unauthorized: new Error('User has not the required permissions'),
  Forbidden: new Error('This action is not allowed')
};
