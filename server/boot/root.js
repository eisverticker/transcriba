'use strict';

module.exports = function(server) {
  // Install a `/` route that returns server status
  var router = server.loopback.Router();
  router.get('/', server.loopback.status());

  server.use(router);

  //home route which is welcoming the user
  router.get('/home', function(req, res, next) {
    res.render('home', {
      'title': 'Hallo',
    });
  });

  router.get('/verified', function(req, res, next) {
    res.render('verified', {
      'title': 'Verifizierung erfolgreich!',
    });
  });

  //show password reset form (loopback-example-user-management-code [MIT])
  router.get('/reset-password', function(req, res, next) {
    if (!req.accessToken) return res.sendStatus(401);
    res.render('password-reset', {
      accessToken: req.accessToken.id,
      title: 'Password reset',
    });
  });

  //reset the user's pasword (loopback-example-user-management-code [MIT])
  router.post('/reset-password', function(req, res, next) {
    if (!req.accessToken) return res.sendStatus(401);

    //verify passwords match
    if (!req.body.password ||
        !req.body.confirmation ||
        req.body.password !== req.body.confirmation) {
      return res.sendStatus(400, new Error('Passwords do not match'));
    }

    server.models.AppUser.findById(req.accessToken.userId, function(err, user) {
      if (err) return res.sendStatus(404);

      user.updateAttribute('password', req.body.password, function(err, user) {
        if (err) return res.sendStatus(404);
        console.log('> password reset processed successfully');
        res.render('response', {
          title: 'Password reset success',
          content: 'Your password has been reset successfully',
          redirectTo: '/',
          redirectToLinkText: 'Log in',
        });
      });
    });
  });
};
