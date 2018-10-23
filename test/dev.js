const amf = require('amf-client-js');
const fs = require('fs-extra');

amf.plugins.document.WebApi.register();
amf.plugins.document.Vocabularies.register();
amf.plugins.features.AMFValidation.register();

amf.Core.init()
.then(() => fs.readFile('test/demo-api.json', 'utf8'))
.then((api) => {
  // const parser = amf.AMF.amfGraphParser();
  const parser = amf.Core.parser('AMF Graph', 'application/ld+json');
  return parser.parseStringAsync(api);
})
.then((doc) => {
  return amf.AMF.validate(doc, amf.ProfileNames.AMF)
  .then((r) => console.log(r.toString()))
  .then(() => doc);
})
.then((doc) => {
  const generator = amf.Core.generator('RAML 1.0', 'application/yaml');
  return generator.generateString(doc);
})
.then((result) => {
  console.log(result);
})
.catch((cause) => {
  console.error(cause.toString());
});
