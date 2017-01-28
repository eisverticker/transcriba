'use strict';

module.exports = function() {
  return function example(req, res, next) {
    console.log('example middleware is running');
    next();
  };
};
