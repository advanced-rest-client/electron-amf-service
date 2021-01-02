const amf = require('amf-client-js');

amf.plugins.document.WebApi.register();
amf.plugins.document.Vocabularies.register();
amf.plugins.features.AMFValidation.register();

/**
 * Parses AMF ld+json model to AMF document.
 * The model has to be unresolved.
 *
 * @param {string} model
 * @return {Promise<Object>} AMF document.
 */
async function modelToDoc(model) {
  const parser = amf.Core.parser('AMF Graph', 'application/ld+json');
  return parser.parseStringAsync(model);
}

/**
 * Generates resolved AMF model using editing pipeline
 * (required by API console).
 * @param {any} doc Parsed API document to AMF object.
 * @param {string} type API original type (RAML 1.0, OAS 2.0, etc)
 * @return {Promise<string>} A promise resolved to AMF object.
 */
async function generateEditingResolvedModel(doc, type) {
  const resolver = amf.Core.resolver(type);
  doc = resolver.resolve(doc, 'editing');
  const generator = amf.Core.generator('AMF Graph', 'application/ld+json');
  // @ts-ignore
  const opts = amf.render.RenderOptions().withSourceMaps.withCompactUris;
  // @ts-ignore
  return generator.generateString(doc, opts);
}

/**
 * Processes API data.
 * @param {any} data Call data
 * @return {Promise<string>}
 */
async function processData(data) {
  const { model, type } = data;
  await amf.Core.init();
  const doc = await modelToDoc(model);
  return generateEditingResolvedModel(doc, type);
}

/**
 * AMF parser to be called in a child process.
 *
 * This process is responsible for parsing unresolved AMF model to API console's
 * resolved model.
 */
process.on('message', async (data) => {
  try {
    const api = await processData(data);
    process.send({ api });
  } catch (cause) {
    let m = `AMF parser: Unable to resolve AMF ld+json model.\n`;
    if (cause.message) {
      m += cause.message;
    } else if (cause.toString) {
      m += cause.toString();
    }
    process.send({ error: m });
  }
});
