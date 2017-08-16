'use strict';

const xmlBuilder = require('xmlbuilder');

/**
 * Convert TeiObjects into xml data
 */
class TeiBuilder {
  /**
   * Builds inline element text data
   * @private
   */
  static buildTextPart(section) {
    return section.children.reduce(
      (acc, child) => {
        switch (child.type) {
          case 'textPartOrdinary':
            acc += child.properties.value;
            break;
        }
        return acc;
      },
      ''
    );
  }

  /**
   * Converts TeiObjects into xml data
   */
  static objectToXml(content, title, sourceName) {
    // # using xml builder
    // ## document specific stuff (namespace etc.)
    let xml = xmlBuilder.create('TEI', {
      encoding: 'utf-8',
    });
    xml.att('xmlns', 'http://www.tei-c.org/ns/1.0');

    // ## tei header
    /* eslint-disable indent */
    xml.ele('teiHeader')
      .ele('fileDesc')
        .ele('titleStmt')
          .ele('title', title).up()
        .up()
        .ele('publicationStmt')
          .ele('p', 'Not for distribution').up()
        .up()
        .ele('sourceDesc')
          .ele('p',
            'Transcribed by users from the crowdsourcing platform ' +
            'transcriba.de. The original image was imported from ' +
            sourceName
          ).up()
        .up()
      .up()
    .up();
    /* eslint-enable indent */

    // ## text body
    let textTei = xml.ele('text');
    let bodyTei = textTei.ele('body');
    content.children.forEach(
      (child) => {
        switch (child.type) {
          case 'page':
            bodyTei.ele('pb').up();
            child.children.forEach(
              (child) => {
                switch (child.type) {
                  case 'heading':
                    let value = TeiBuilder.buildTextPart(child);
                    bodyTei.ele('head', value).up();
                    break;
                  case 'paragraph':
                    let parTei = bodyTei.ele('p');
                    child.children.forEach(
                      (child) => {
                        switch (child.type) {
                          case 'line':
                            let value = TeiBuilder.buildTextPart(child);
                            parTei.ele('l', value).up();
                            break;
                        }
                      }
                    );
                    break;
                }
              }
            );
            break;
        }
      }
    );

    textTei.up(); // body end
    bodyTei.up(); // text end
    return xml.end({pretty: true});
  }
}

module.exports = TeiBuilder;
