const amf = require('amf-client-js');

amf.plugins.document.WebApi.register();
amf.plugins.document.Vocabularies.register();
amf.plugins.features.AMFValidation.register();

let initialized = false;

/**
 * Performs document validation.
 * @param {String} type API type
 * @param {Object} doc A document to validate
 */
async function validateDoc(type, doc) {
  let validateProfile;
  switch (type) {
    case 'RAML 1.0': validateProfile = amf.ProfileNames.RAML; break;
    case 'RAML 0.8': validateProfile = amf.ProfileNames.RAML08; break;
    case 'OAS 1.0':
    case 'OAS 2.0':
    case 'OAS 3.0':
      validateProfile = amf.ProfileNames.OAS;
      break;
  }
  // @ts-ignore
  const result = await amf.AMF.validate(doc, validateProfile);
  process.send({ validation: result.toString() });
}
/**
 * AMF parser to be called in a child process.
 *
 * AMF can in extreme cases takes forever to parse API data if, for example,
 * RAML type us defined as a number of union types. It may sometimes cause
 * the process to crash. To protect the renderer process this is run as forked
 * process.
 *
 * @param {any} data
 * @return {Promise<string>} Processed document
 */
async function processData(data) {
  const sourceFile = data.source;
  const type = data.from.type;
  const contentType = data.from.contentType;
  const validate = data.validate;
  if (!initialized) {
    await amf.Core.init();
  }
  /* eslint-disable-next-line require-atomic-updates */
  initialized = true;
  const file = `file://${sourceFile}`;
  const parser = amf.Core.parser(type, contentType);
  const doc = await parser.parseFileAsync(file);
  if (validate) {
    await validateDoc(type, doc);
  }
  const generator = amf.Core.generator('AMF Graph', 'application/ld+json');
  return generator.generateString(doc);
}
/**
 * AMF parser to be called in a child process.
 *
 * AMF can in extreme cases takes forever to parse API data if, for example,
 * RAML type us defined as a number of union types. It may sometimes cause
 * the process to crash. To protect the renderer process this is run as forked
 * process.
 */
process.on('message', async (data) => {
  try {
    const api = await processData(data);
    process.send({
      api,
    });
  } catch (cause) {
    let m = `AMF parser: Unable to parse API ${data.source}.\n`;
    m += cause.s$1 || cause.message;
    process.send({ error: m });
  }
});
