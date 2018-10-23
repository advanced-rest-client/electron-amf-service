const amf = require('amf-client-js');
amf.plugins.document.WebApi.register();
amf.plugins.document.Vocabularies.register();
amf.plugins.features.AMFValidation.register();
/**
 * Converts API data from one supported spec to another.
 *
 * Supported specs are:
 * - raml10
 * - raml08
 * - raml (?)
 * - oas (2.0)
 * - amf (graph)
 */
class AmfConventer {
  /**
   * Converts an API to a spec data
   * @param {String} from API source specification type
   * @param {String} to API target specification type
   * @param {String} api The API model (RAML/OAS/AMF)
   * @return {Promise}
   */
  convert(from, to, api) {
    return amf.Core.init()
    .then(() => {
      const parser = this.getParser(from);
      return parser.parseStringAsync(api);
    })
    .then((doc) => {
      const generator = this.getGenerator(to);
      return generator.generateString(doc);
    });
  }

  getParser(from) {
    return new amf.AmfGraphParser();
    // AMF Graph -> application/ld+json
    let parser;
    if (from === 'raml10') {
      parser = amf.AMF.raml10Parser();
    } else if (from === 'raml08') {
      parser = amf.AMF.raml08Parser();
    } else if (from === 'raml') {
      parser = amf.AMF.ramlParser();
    } else if (from === 'oas') {
      parser = amf.AMF.oas20Parser();
    } else {
      parser = amf.AMF.amfGraphParser();
    }
    return parser;
  }

  getGenerator(to) {
    debugger
    let generator;
    if (to === 'raml10') {
      generator = amf.AMF.raml10Generator();
    } else if (to === 'raml08') {
      generator = amf.AMF.raml08Generator();
    } else if (to === 'oas') {
      generator = amf.AMF.oas20Generator();
    } else {
      generator = amf.AMF.amfGraphGenerator();
    }
    return generator;
  }
}

let instance;
process.on('message', (data) => {
  if (!instance) {
    instance = new AmfConventer();
  }
  instance.convert(data.from, data.to, data.api)
  .then((result) => {
    process.send({
      result
    });
  })
  .catch((cause) => {
    process.send({
      error: cause.toString()
    });
  });
});

module.exports.AmfConventer = AmfConventer;
