'use strict';

const marked     = require('marked');
const toMarkdown = marked;
const Exceptions = require('../exceptions.js');
const customRenderer = new marked.Renderer();

// alter the image rendering function to render image with
// responsive bootstrap class
customRenderer.image = function(href, title, text) {
  const out =
    '<img class="img-responsive" src="' + href + '" alt="' + text + '"';
  if (title) {
    out += ' title="' + title + '"';
  }
  out += this.options.xhtml ? '/>' : '>';
  return out;
};

// alter the table rendering function to render table with
// responsive bootstrap class
customRenderer.table = function(header, body) {
  return '<div class="table-responsive"><table>\n' +
    '<thead>\n' +
    header +
    '</thead>\n' +
    '<tbody>\n' +
    body +
    '</tbody>\n' +
    '</table></div>\n';
};

module.exports = function(InfoPage) {
  InfoPage.validatesUniquenessOf('name');

  InfoPage.findByName = function(name) {
    if (typeof name !== 'string') throw Exceptions.WrongInput;
    return InfoPage.findOne({where: {'name': name}}).then(
      (page) => {
        if (!page) throw Exceptions.NotFound.InfoPage;
        page.content = toMarkdown(page.content, {renderer: customRenderer});
        return page;
      }
    );
  };

  InfoPage.remoteMethod(
    'findByName',
    {
      description: 'Find InfoPage by name and return page with parsed content',
      accessType: 'READ',
      accepts: [
        {arg: 'name', type: 'string', required: true},
      ],
      http: {path: '/:name/parsed', verb: 'get'},
      returns: {arg: 'page', type: 'object', root: true},
    }
  );

  InfoPage.observe('after save', function filterProperties(ctx, next) {
    // create discussion automatically if none was given
    if (ctx.instance.discussionId == undefined) {
      ctx.instance.discussion.create({}, function(err) {
        if (err) return next(err);

        next();
      });
    } else {
      next();
    }
  });
};
