const { ElectronAmfService } = require('../');
const { assert } = require('chai');
const path = require('path');
const fs = require('fs-extra');

describe('File data processing', () => {
  describe('Blob data - parses to AMF', () => {
    [
      ['Single RAML file', 'single-file-api.raml'],
      ['OAS 2.0', 'oas-2.0-json.zip'],
      ['Single RAML file in zip', 'single-file-api.zip'],
      // ['Multiple RAML files in zip', 'multiple-raml-files.zip'],
      ['Folder in the zip', 'inception.zip'],
    ].forEach((item) => {
      it(item[0], async () => {
        const file = path.join('test', item[1]);
        const data = await fs.readFile(file);
        const buff = new Blob([new Uint8Array(data)]);
        const service = new ElectronAmfService();
        const result = await service.processApiFile(buff);
        await service.cleanup();
        assert.typeOf(result, 'object', 'Returns an object');
        assert.typeOf(result.model, 'string', 'Returns the model');
        assert.typeOf(result.type, 'object', 'Returns type info');
        assert.typeOf(result.type.type, 'string', 'API type is set');
        assert.typeOf(result.type.contentType, 'string', 'API content-type is set');
      });
    });
  });

  describe('Buffer data - parses to AMF', () => {
    [
      ['Single RAML file', 'single-file-api.raml'],
      ['OAS 2.0', 'oas-2.0-json.zip'],
      ['Single RAML file in zip', 'single-file-api.zip'],
      // ['Multiple RAML files in zip', 'multiple-raml-files.zip'],
      ['Folder in the zip', 'inception.zip'],
    ].forEach((item) => {
      it(item[0], async () => {
        const file = path.join('test', item[1]);
        const data = await fs.readFile(file);
        const service = new ElectronAmfService();
        const result = await service.processBuffer(data);
        await service.cleanup();
        assert.typeOf(result, 'object', 'Returns an object');
        assert.typeOf(result.model, 'string', 'Returns the model');
        assert.typeOf(result.type, 'object', 'Returns type info');
        assert.typeOf(result.type.type, 'string', 'API type is set');
        assert.typeOf(result.type.contentType, 'string', 'API content-type is set');
      });
    });
  });

  describe.skip('selecting the entry point', () => {
    it('dialog result processes the API', async () => {
      const file = path.join('test', 'multiple-raml-files.zip');
      const data = await fs.readFile(file);
      const service = new ElectronAmfService();
      await service.processBuffer(data);
    });
  });
});
